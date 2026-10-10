// feedRollup.js — week and month recaps (UI + planning).
//
// Recaps roll up: items → day recap → week recap → month recap. A week recap is written ONLY from its day
// recaps, a month recap from its week recaps (day recaps for weeks that are incomplete or cross a month edge).
// No headline is ever sent to the AI twice. Mood and categories are counted locally from the item ratings.
//
// Storage: recaps['w:<mondayTs>|<source>'] / recaps['m:<firstOfMonthTs>|<source>'] =
//   { overview, themes, mood, at, n, covered: { 'd:<dayTs>' | 'w:<weekTs>': recapSig(child) } }
// covered lets us see cheaply whether a child recap changed after the roll-up was written (→ stale → Refresh).

import { generateRollup, recapSig } from './feedAi.js';
import { renderAnswer, renderInline } from './qaView.js';
import { createRecapStatus } from './recapStatus.js';
import { runningJob, trackJob, notifyReady } from './recapJobs.js';
import { T, TN, locale, uiLocale } from './feedI18n.js';
import { groupedLabels } from './topicConcepts.js';

import { addDays, weekStart, monthStart, isoWeek } from './dateUtils.js';
export { addDays, weekStart, monthStart, isoWeek };
const monthEnd = (ts) => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime(); };
/** Exclusive end of the period that starts at `start`. */
export const periodEnd = (scope, start) => scope === 'week' ? addDays(start, 7) : scope === 'month' ? new Date(new Date(start).getFullYear(), new Date(start).getMonth() + 1, 1).getTime() : addDays(start, 1);
export const rollKey = (scope, start, source) => scope === 'day' ? `${start}|${source}` : `${scope === 'week' ? 'w' : 'm'}:${start}|${source}`;
/** Timestamp a recap key belongs to (null for anything unknown) — used for retention and the calendar marker. */
export function recapKeyTs(k) { const m = String(k).match(/^(?:[wm]:)?(\d+)\|/); return m ? Number(m[1]) : null; }
export const isDayRecapKey = (k) => /^\d+\|/.test(String(k));

const dayText = (ts) => new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const dayTextLocal = (ts) => new Date(ts).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });
export const rangeText = (a, b) => `${new Date(a).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })} – ${new Date(b).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}`;

/**
 * Everything the plan needs: which days/weeks are reused, empty or missing, and the recaps the AI will read.
 * ctx = { getItems, getRecaps, inSource(item), startOfDay, source }
 */
export function buildParts(scope, start, ctx, today = ctx.startOfDay(Date.now())) {
    const recaps = ctx.getRecaps(), source = ctx.source;
    const from = start;
    const to = scope === 'week' ? addDays(start, 6) : monthEnd(start);
    const last = Math.min(to, today);
    const counts = new Map();
    ctx.getItems().forEach(i => {
        if (!ctx.inSource(i)) return;
        const d = ctx.startOfDay(i.published);
        if (d >= from && d <= last) counts.set(d, (counts.get(d) || 0) + 1);
    });
    const dayPart = (d) => {
        const n = counts.get(d) || 0;
        const recap = recaps[rollKey('day', d, source)] || null;
        return { key: 'd:' + d, day: d, n, recap, status: recap ? 'reused' : n ? 'missing' : 'none' };
    };
    const rows = [], parts = [];
    if (scope === 'week') {
        for (let d = from; d <= last; d = addDays(d, 1)) {
            const p = dayPart(d);
            rows.push({ kind: 'day', ...p });
            if (p.recap) parts.push({ key: p.key, label: dayText(d), recap: p.recap });
        }
    } else {
        for (let w = weekStart(from); w <= last; w = addDays(w, 7)) {
            const wEnd = addDays(w, 6);
            const inside = w >= from && wEnd <= to && wEnd <= today;
            const wr = inside ? recaps[rollKey('week', w, source)] : null;
            const dayRows = [];
            for (let d = Math.max(w, from); d <= Math.min(wEnd, last); d = addDays(d, 1)) dayRows.push(dayPart(d));
            const n = dayRows.reduce((a, p) => a + p.n, 0);
            if (wr) {
                rows.push({ kind: 'week', week: w, n, status: 'reused', edge: false, recap: wr });
                parts.push({ key: 'w:' + w, label: `Week ${isoWeek(w)}`, recap: wr });
            } else {
                rows.push({ kind: 'days', week: w, n, days: dayRows, edge: !inside, status: dayRows.some(p => p.status === 'missing') ? 'missing' : dayRows.some(p => p.recap) ? 'reused' : 'none' });
                dayRows.forEach(p => { if (p.recap) parts.push({ key: p.key, label: dayText(p.day), recap: p.recap }); });
            }
        }
    }
    const missing = rows.flatMap(r => r.kind === 'day' ? (r.status === 'missing' ? [r] : []) : r.kind === 'days' ? r.days.filter(p => p.status === 'missing') : []);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    return { from, to, last, counts, rows, parts, missing, total };
}

/** { have, of } — days with items that already have a day recap, for the coverage line. */
export function coverage(scope, anchor, ctx) {
    const P = buildParts(scope, scope === 'week' ? weekStart(anchor) : monthStart(anchor), ctx);
    const days = [];
    P.rows.forEach(r => { if (r.kind === 'day') days.push(r); else if (r.kind === 'days') days.push(...r.days); });
    const of = days.filter(d => d.n || d.recap).length;
    return { have: days.filter(d => d.recap).length, of };
}

/** Mood split and top categories from the ratings the items already carry (no AI call). */
export function tally(items, ctx, from, to, itemMood) {
    const m = { pos: 0, neu: 0, neg: 0 }, cats = new Map();
    items.forEach(i => {
        if (!ctx.inSource(i)) return;
        const d = ctx.startOfDay(i.published);
        if (d < from || d > to) return;
        const k = itemMood(i); if (k) m[k]++;
        if (i.cat) cats.set(i.cat, (cats.get(i.cat) || 0) + 1);
    });
    const rated = m.pos + m.neu + m.neg;
    const pct = (v) => rated ? Math.round(v * 100 / rated) : 0;
    return { rated, pos: pct(m.pos), neu: pct(m.neu), neg: pct(m.neg), cats: [...cats].sort((a, b) => b[1] - a[1]).slice(0, 3) };
}

export function openRollup(scope, anchor, ctx) {
    const { el, btn } = ctx;
    const today = ctx.startOfDay(Date.now());
    const start = scope === 'week' ? weekStart(anchor) : monthStart(anchor);
    const key = rollKey(scope, start, ctx.source);
    const label = scope === 'week'
        ? T('Week {n}', { n: isoWeek(start) })
        : new Date(start).toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
    const running = runningJob(key);
    if (running) return ctx.openSheet(T('{label} recap', { label }), running);
    const body = el('div', 'feed-picker feed-recap feed-rollup');
    ctx.openSheet(T('{label} recap', { label }), body);

    const parts = () => buildParts(scope, start, ctx, today);
    const sigsOf = (arr) => Object.fromEntries(arr.map(p => [p.key, recapSig(p.recap)]));
    const changedOf = (cached, P) => P.parts.filter(p => cached.covered[p.key] !== recapSig(p.recap));
    const fail = (e, retry) => body.replaceChildren(el('p', 'feed-error', e.message || T('Recap failed')), btn('btn-sm', T('Try again'), retry));

    const rowText = (r) => {
        if (r.kind === 'day') return r.status === 'reused' ? '✨ ' + TN(r.n, '{n} item', '{n} items') : r.status === 'missing' ? TN(r.n, '{n} item', '{n} items') + ' · ' + T('no recap yet') : T('No items');
        if (r.kind === 'week') return '✨ ' + T('Week recap');
        const have = r.days.filter(p => p.recap).length;
        return r.n || have ? TN(have, '{n} day recap', '{n} day recaps') + (r.status === 'missing' ? ' · ' + T('{n} without recap', { n: r.days.filter(p => p.status === 'missing').length }) : '') : T('No items');
    };
    const rowLabel = (r) => r.kind === 'day' ? dayTextLocal(r.day) : `${T('Week {n}', { n: isoWeek(r.week) })} · ${rangeText(Math.max(r.week, start), Math.min(addDays(r.week, 6), P0().last))}`;
    const P0 = () => parts();

    const drawPlan = (P, cached) => {
        let createMissing = true;
        body.replaceChildren();
        body.append(el('p', 'feed-muted', T('Built from your day recaps. Items that already have a day recap are not sent again.')));
        const list = el('div', 'feed-roll-rows');
        P.rows.forEach(r => {
            const row = el('div', 'feed-roll-row');
            row.append(el('span', 'feed-roll-day', rowLabel(r)), el('span', 'feed-roll-text', rowText(r)));
            if (r.status === 'reused' || r.status === 'missing') row.append(el('span', 'feed-roll-tag ' + r.status, r.status === 'reused' ? T('reused') : T('missing')));
            list.append(row);
        });
        body.append(list);
        const go = btn('button-primary feed-wide-btn', cached ? T('↻ Refresh') : T('✨ Create recap'), () => run(createMissing));
        const sync = () => { go.disabled = !(P.parts.length || (createMissing && P.missing.length)); };
        if (P.missing.length) {
            const opts = el('div', 'feed-roll-opts');
            const mk = (text, val) => {
                const b = el('button', 'feed-pick-row' + (createMissing === val ? ' selected' : ''));
                b.type = 'button';
                b.append(el('span', 'feed-pick-radio'), el('span', 'feed-pick-text', text));
                b.addEventListener('click', () => { createMissing = val; opts.querySelectorAll('.feed-pick-row').forEach((x, k) => x.classList.toggle('selected', (k === 0) === val)); sync(); });
                return b;
            };
            opts.append(mk(TN(P.missing.length, 'Create {n} missing day recap first', 'Create {n} missing day recaps first'), true), mk(T('Skip the days without a recap'), false));
            body.append(opts);
        }
        if (P.parts.length) body.append(el('p', 'feed-roll-save', T('Sends {n} short recaps, not {m} headlines', { n: P.parts.length, m: P.total })));
        sync();
        body.append(go, btn('feed-manage-link', T('Cancel'), ctx.closeSheet));
    };

    const drawResult = (r, P) => {
        const stale = changedOf(r, P).length > 0;
        body.replaceChildren();
        const chip = { pos: T('😊 Mostly positive'), neu: T('😐 Mixed'), neg: T('😟 Mostly heavy') }[r.mood] || T('😐 Mixed');
        body.append(el('span', 'feed-recap-mood', chip));
        if (r.overview) { const ov = el('div', 'feed-recap-overview md-body'); renderAnswer(ov, r.overview); body.append(ov); }
        if (r.themes.length) { const ul = el('ul', 'feed-recap-themes'); r.themes.forEach(t => { const li = el('li'); renderInline(li, t); ul.append(li); }); body.append(ul); }
        const tl = tally(ctx.getItems(), ctx, P.from, P.last, ctx.itemMood);
        if (tl.rated) {
            body.append(moodBar(el, tl));
            if (tl.cats.length) body.append(el('p', 'feed-roll-mood', groupedLabels(tl.cats, uiLocale()).map(([c, n]) => `${c} ${n}`).join(' · ')));
        }
        if (stale) body.append(el('p', 'feed-recap-stale', T('A source recap changed since this one was written — Refresh to include it.')));
        const row = el('div', 'feed-recap-actions');
        let armed = 0;
        const reset = btn('btn-sm', T('Reset'), () => {
            if (!armed) {
                reset.textContent = T('Discard & rewrite?');
                armed = setTimeout(() => { armed = 0; reset.textContent = T('Reset'); }, 4000);
                return;
            }
            clearTimeout(armed);
            delete ctx.getRecaps()[key];
            ctx.saveRecaps();
            refreshFromScratch();
        });
        row.append(btn('btn-sm', T('↻ Refresh'), () => refresh(r)), reset,
            btn('btn-sm', T('Copy'), async () => {
                try { await navigator.clipboard.writeText([r.overview, ...r.themes.map(t => '- ' + t)].join('\n')); ctx.toast(T('Recap copied')); }
                catch (e) { ctx.toast(T('Copy failed')); }
            }));
        body.append(row, el('p', 'feed-muted', TN(Object.keys(r.covered || {}).length, 'Built from {n} recap', 'Built from {n} recaps') + ' · ' + T('Generated at {time}', { time: new Date(r.at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) })));
    };

    const run = async (createMissing) => {
        const done = trackJob(key, body);
        try {
            let P = parts();
            if (createMissing && P.missing.length) {
                const todo = [...P.missing].sort((a, b) => a.day - b.day);
                for (let k = 0; k < todo.length; k++) {
                    body.replaceChildren(el('p', 'feed-recap-loading', T('Creating day recaps… {a}/{b}', { a: k + 1, b: todo.length })));
                    await ctx.buildDay(todo[k].day, ctx.source);
                }
                P = parts();
            }
            if (!P.parts.length) { body.replaceChildren(el('p', 'feed-muted', T('Nothing to combine yet.'))); return; }
            const cached = ctx.getRecaps()[key];
            const fresh = cached && cached.covered ? changedOf(cached, P) : null;
            if (cached && fresh && !fresh.length) { ctx.toast(T('Nothing new since this recap')); return drawResult(cached, P); }
            const st = createRecapStatus({ title: cached ? T('✨ Updating recap…') : T('✨ Writing recap…'), detail: T('Sends {n} short recaps, not {m} headlines', { n: (fresh || P.parts).length, m: P.total }), onCancel: () => { if (cached) drawResult(cached, P); else drawPlan(P, null); } });
            body.replaceChildren(st.node);
            const send = fresh || P.parts;
            let r;
            try { r = await generateRollup(send, { label, prev: fresh ? cached : null, edited: (p) => !!(cached && p.key in cached.covered), onStage: st.onStage, signal: st.signal, onProgress: st.onProgress }); }
            finally { st.stop(); }
            const rc = { ...r, at: Date.now(), n: P.total, scope, covered: fresh ? { ...cached.covered, ...sigsOf(send) } : sigsOf(P.parts) };
            ctx.getRecaps()[key] = rc;
            ctx.saveRecaps();
            done();
            drawResult(rc, P);
            notifyReady(body, T('✨ {label} recap is ready', { label }), ctx.toast);
        } catch (e) { done(); if (e.cancelled) return; fail(e, () => run(createMissing)); }
        finally { done(); }
    };

    const refreshFromScratch = () => {
        const P = parts();
        if (P.missing.length) return drawPlan(P, null);
        run(false);
    };

    const refresh = (cached) => {
        const P = parts();
        if (P.missing.length) return drawPlan(P, cached);
        run(false);
    };

    const P = parts();
    const cached = ctx.getRecaps()[key];
    if (cached && cached.covered) drawResult(cached, P);
    else if (!P.rows.length) body.append(el('p', 'feed-muted', T('No items to recap here.')));
    else drawPlan(P, null);
}

/** Seven cells (Mon..Sun) of a week for the coverage strip: reused | missing | none | off (future). */
export function weekCells(anchor, ctx) {
    const start = weekStart(anchor), today = ctx.startOfDay(Date.now());
    const P = buildParts('week', start, ctx, today);
    const byDay = new Map(P.rows.filter(r => r.kind === 'day').map(r => [r.day, r.status]));
    return Array.from({ length: 7 }, (_, k) => { const d = addDays(start, k); return { day: d, status: d > today ? 'off' : (byDay.get(d) || 'none') }; });
}

/** Is the stored week/month recap older than one of the recaps it was built from? (false when there is none) */
export function isStale(scope, anchor, ctx) {
    const start = scope === 'week' ? weekStart(anchor) : monthStart(anchor);
    const cached = ctx.getRecaps()[rollKey(scope, start, ctx.source)];
    if (!cached || !cached.covered) return false;
    return buildParts(scope, start, ctx).parts.some(p => cached.covered[p.key] !== recapSig(p.recap));
}

/** Stacked green / yellow / red bar (positive / mixed / heavy) with a legend of percentages — no emoji to squint at. */
export function moodBar(el, tl) {
    const wrap = el('div', 'feed-mood-wrap');
    const bar = el('div', 'feed-mood-bar small');
    const parts = [['neg', tl.neg, T('😟 Mostly heavy')], ['neu', tl.neu, T('😐 Mixed')], ['pos', tl.pos, T('😊 Mostly positive')]];
    parts.forEach(([k, v, label]) => { if (!v) return; const seg = el('span', 'feed-mood-seg ' + k); seg.style.flex = String(v); seg.title = `${label} ${v}%`; bar.append(seg); });
    const legend = el('div', 'feed-mood-legend');
    parts.forEach(([k, v, label]) => { const it = el('span', k); it.title = label; it.append(el('i'), document.createTextNode(`${v}%`)); legend.append(it); });
    wrap.append(bar, legend);
    return wrap;
}
