// graphSimilarityCache.js — keeps the per-article term vectors (graphSimilarity.js) up to date in the background and remembers them.
//
// Stage 2 (quick): articles with no vector yet, or whose fingerprint changed, get one from what the lean index already holds
//   (title, tags, summary). No storage reads; a few hundred ms for a big archive, done in slices.
// Stage 3 (deep): the saved text of each of those articles is read in small batches and added to its vector.
//   This is the part that touches storage, so it runs in the background, yields between batches and writes a checkpoint
//   as it goes: close the panel half way and the next run continues where this one stopped.
// Both stages are incremental: an article is only worked on when its fingerprint changed. The cache (one storage key, derived data,
// never part of a backup, deleted with the history) also holds the computed neighbours and the signature they belong to, so
// opening the graph with nothing changed costs one read.
import { SIM_VERSION, buildEntry, fingerprintOf, neighbours, signature } from './graphSimilarity.js';

const BATCH = 25;               // saved texts read per storage call
const CHECKPOINT = 100;         // deep entries between two saves (the panel can be closed at any time: no code runs then)
const emptyCache = () => ({ v: SIM_VERSION, items: {}, nn: null });

/**
 * @param {object} io { entries(): index entries, load(): cache|null, save(cache), readRecords(ids): {id: {content}}, pause(): Promise }
 * @param {{ deep?: boolean, signal?: {aborted:boolean}, onUpdate?: Function }} opts
 *   onUpdate({ stage: 'quick'|'deep', links, sig, done, total, complete })  `links`: { id: [[otherId, score], …] }
 * @returns {Promise<{ links, sig, complete }>}
 */
export async function refreshSimilarity(io, { deep = true, signal = null, onUpdate = () => {} } = {}) {
    const entries = (await io.entries()).filter(a => a && a.id);
    let cache = await io.load().catch(() => null);
    if (!cache || cache.v !== SIM_VERSION || typeof cache.items !== 'object') cache = emptyCache();
    const alive = new Set(entries.map(a => a.id));
    Object.keys(cache.items).forEach(id => { if (!alive.has(id)) delete cache.items[id]; });   // deleted articles leave the cache

    // Stage 2 — vectors from the index entry (title, tags, summary) for what is new or changed.
    let n = 0, dirty = false;
    for (const a of entries) {
        const it = cache.items[a.id];
        if (it && it.f === fingerprintOf(a)) continue;
        cache.items[a.id] = buildEntry({ title: a.title, tags: a.tags, summary: a.summary }, a, false);
        dirty = true;
        if (++n % 100 === 0) await io.pause();
        if (signal && signal.aborted) return { links: (cache.nn && cache.nn.links) || {}, sig: cache.nn && cache.nn.sig, complete: false };
    }
    const settle = async (stage, done, total) => {
        const sig = signature(cache.items);
        if (!cache.nn || cache.nn.sig !== sig) { cache.nn = { sig, links: await neighbours(cache.items, {}, io.pause) }; dirty = true; }
        if (dirty) { try { await io.save(cache); } catch (_) { /* a full disk only costs the cache */ } dirty = false; }   // an unchanged archive writes nothing
        const complete = total === 0 || (stage === 'deep' && done >= total);   // nothing left to read counts as finished
        // The strongest few terms per article: the graph names its subtopics with them (graphStructure.js).
        const terms = Object.fromEntries(Object.entries(cache.items).map(([id, it]) => [id, it.t.slice(0, 8).map(x => x[0])]));
        onUpdate({ stage, links: cache.nn.links, sig, done, total, complete, terms, items: cache.items });
        return { links: cache.nn.links, sig, complete, terms, items: cache.items };
    };

    const todo = entries.filter(a => cache.items[a.id].full === 0 && (a.contentWordCount || 0) > 0);
    let res = await settle('quick', 0, todo.length);
    if (!deep || !todo.length) return { ...res, complete: !todo.length };   // (res.complete is already true when there is nothing to read)

    // Stage 3 — saved text, batch by batch.
    let sinceSave = 0;
    for (let i = 0; i < todo.length; i += BATCH) {
        if (signal && signal.aborted) { if (dirty) { try { await io.save(cache); } catch (_) { /* see above */ } } return { ...res, complete: false }; }
        const batch = todo.slice(i, i + BATCH);
        let recs = {};
        try { recs = await io.readRecords(batch.map(a => a.id)) || {}; } catch (_) { recs = {}; }
        for (const a of batch) {
            const rec = recs[a.id];
            cache.items[a.id] = buildEntry({ title: a.title, tags: a.tags, summary: a.summary, content: rec && rec.content }, a, true);
            dirty = true;
        }
        sinceSave += batch.length;
        await io.pause();
        if (sinceSave >= CHECKPOINT && i + BATCH < todo.length) { sinceSave = 0; dirty = false; try { await io.save(cache); } catch (_) { /* see above */ } }
    }
    res = await settle('deep', todo.length, todo.length);
    return res;
}

/** The real thing: chrome.storage through StorageManager, idle time between slices. */
export async function defaultIo() {
    const [{ default: StorageManager }, { SK, articleRecKey }] = await Promise.all([import('./storageManager.js'), import('./storageKeys.js')]);
    return {
        entries: () => StorageManager.getArticlesIndex(),
        load: async () => (await StorageManager.getLocal([SK.graphSim]))[SK.graphSim] || null,
        save: (cache) => StorageManager.setLocal({ [SK.graphSim]: cache }),
        readRecords: async (ids) => {
            const keys = ids.map(articleRecKey);
            const got = await StorageManager.getLocal(keys);
            const out = {};
            ids.forEach((id, i) => { out[id] = got[keys[i]]; });
            return out;
        },
        pause: () => new Promise(r => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout: 250 }) : setTimeout(r, 0)))
    };
}

// One job per panel, however many times the graph is drawn: later callers join it.
let job = null;
const listeners = new Set();
let last = null;

/** Starts (or joins) the background refresh. `fn` is called with every update, and once at once if there already is one. Returns a stop function. */
export function watchSimilarity(fn, { deep = true } = {}) {
    listeners.add(fn);
    if (last) fn(last);
    if (!job) {
        const ctl = { aborted: false };
        job = defaultIo().then(io => refreshSimilarity(io, { deep, signal: ctl, onUpdate: (u) => { last = u; listeners.forEach(l => { try { l(u); } catch (_) { /* a listener must not stop the run */ } }); } }))
            .catch(() => {}).finally(() => { job = null; });
    }
    return () => listeners.delete(fn);
}
