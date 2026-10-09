// libraryBatch.js — process the whole Feed library with a local model (Ollama) in small batches.
//
// Why batches: a local model that gets 300 headlines at once loses the middle ("diluted"); 20 at a time stays
// sharp. It can take hours, but it costs nothing but the user's own machine, so it is only offered for Ollama.
//
// The plan is always derived from what is stored (items without rating/category, days without a complete recap),
// so stopping and starting again simply continues where it left off. Nothing here talks to the UI or the AI:
// the caller passes the work functions in (rateChunk, recapDay), which keeps this testable.

export const BATCH_SIZES = [10, 20, 40];
export const DEFAULT_BATCH = 20;

const needsRating = (i) => !i.ai || !i.cat;

export const cleanBatchSize = (n) => BATCH_SIZES.includes(Number(n)) ? Number(n) : DEFAULT_BATCH;

/**
 * What is left to do.
 * ctx = { items, recaps, source, inSource(item), startOfDay(ts), itemSig(item), today, includeToday? }
 * rate: items without AI score or category (newest first)
 * days: days with items the recap has not covered yet (today is skipped unless includeToday is true),
 *       oldest first, each { day, total, todo } where todo = items still to be covered (newest first).
 */
export function planLibrary(ctx) {
    const { items, recaps, source, inSource, startOfDay, itemSig } = ctx;
    const today = ctx.today != null ? ctx.today : startOfDay(Date.now());
    const scoped = items.filter((i) => inSource(i));
    const rate = scoped.filter(needsRating).sort((a, b) => b.published - a.published);
    const byDay = new Map();
    scoped.forEach((i) => {
        const d = startOfDay(i.published);
        if (d > today || (d === today && !ctx.includeToday)) return;
        if (!byDay.has(d)) byDay.set(d, []);
        byDay.get(d).push(i);
    });
    const days = [];
    [...byDay.keys()].sort((a, b) => a - b).forEach((day) => {
        const all = byDay.get(day).sort((a, b) => b.published - a.published);
        const rc = recaps[`${day}|${source}`];
        const todo = rc ? (rc.covered ? all.filter((x) => rc.covered[x.id] !== itemSig(x)) : []) : all;
        if (todo.length) days.push({ day, total: all.length, todo, hasRecap: !!rc });
    });
    return { rate, days };
}

export const chunksOf = (list, n) => { const out = []; for (let k = 0; k < list.length; k += n) out.push(list.slice(k, k + n)); return out; };

/** Number of AI requests the plan needs at this batch size (one per rating batch, one per recap batch). */
export function countRequests(plan, batchSize) {
    return Math.ceil(plan.rate.length / batchSize) + plan.days.reduce((s, d) => s + Math.ceil(d.todo.length / batchSize), 0);
}

/** "about 2 h 10 min" style text from milliseconds (null when unknown). */
export function formatEta(ms, T) {
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const min = Math.max(1, Math.round(ms / 60000));
    if (min < 60) return T('about {m} min', { m: min });
    return T('about {h} h {m} min', { h: Math.floor(min / 60), m: min % 60 });
}

/**
 * Run the plan. Hooks:
 *   rateChunk(chunk, signal, ctx)               rate + categorize one batch (throws on failure)
 *   recapDay(entry, batchSize, signal, ctx)     write/extend the recap of one day, batch by batch, saving as it goes (throws on failure)
 *                                               ctx.step({ batch, batches, count }) before each batch, ctx.tick() after each batch
 *   ctx.onStage(stage)                          pass on to the AI call: 'send' | 'wait' | 'write' | 'parse'
 *   onProgress(info)                            every change; info = { phase, doneRequests, totalRequests, rated, recaps, failed, etaMs, elapsedMs, step }
 *                                               step = what is happening now: { phase: 'rate', batch, batches, from, to, items }
 *                                                                          or { phase: 'recap', day, dayIndex, days, batch, batches, count }
 *   onStage(stage)                              the stage of the request in flight
 *   signal                                      AbortSignal: stops between and during requests; the work done so far stays saved
 * A failed batch is counted and skipped, so one unreadable reply does not end an overnight run.
 */
export async function runLibrary(plan, batchSize, { rateChunk, recapDay, onProgress = () => {}, onStage = () => {}, signal } = {}) {
    const total = countRequests(plan, batchSize);
    let done = 0, rated = 0, recapDays = 0, failed = 0, step = null;
    const started = Date.now();
    const report = (phase) => {
        const per = done ? (Date.now() - started) / done : 0;
        onProgress({ phase, doneRequests: done, totalRequests: total, rated, recaps: recapDays, failed, etaMs: per ? per * (total - done) : NaN, elapsedMs: Date.now() - started, step });
    };
    const stopped = () => !!(signal && signal.aborted);
    const ctx = { onStage };
    report('rate');
    const rateChunks = chunksOf(plan.rate, batchSize);
    for (let k = 0; k < rateChunks.length; k++) {
        if (stopped()) break;
        const chunk = rateChunks[k];
        step = { phase: 'rate', batch: k + 1, batches: rateChunks.length, from: k * batchSize + 1, to: k * batchSize + chunk.length, items: plan.rate.length };
        report('rate');
        try { await rateChunk(chunk, signal, ctx); rated += chunk.length; }
        catch (e) { if (stopped() || (e && e.cancelled)) break; failed += chunk.length; }
        done++; report('rate');
    }
    for (let d = 0; d < plan.days.length; d++) {
        const entry = plan.days[d];
        if (stopped()) break;
        const batches = Math.ceil(entry.todo.length / batchSize), base = done;
        step = { phase: 'recap', day: entry.day, dayIndex: d + 1, days: plan.days.length, batch: 1, batches, count: Math.min(batchSize, entry.todo.length) };
        report('recap');
        const dayCtx = {
            onStage,
            step: (b) => { step = { ...step, ...b }; report('recap'); },
            tick: () => { done = Math.min(base + batches, done + 1); report('recap'); }
        };
        try { await recapDay(entry, batchSize, signal, dayCtx); recapDays++; }
        catch (e) { if (stopped() || (e && e.cancelled)) break; failed++; }
        done = base + batches;
        report('recap');
    }
    step = null;
    return { rated, recaps: recapDays, failed, stopped: stopped(), doneRequests: done, totalRequests: total, elapsedMs: Date.now() - started };
}
