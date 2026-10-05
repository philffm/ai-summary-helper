// feedMood.js — mood over time (day / week / month) for Insights.
//
// Items are pruned after `keepDays`, but mood should be comparable month over month. So every day's AI-rated
// mood is counted once into a tiny store and kept ~13 months, independent of item retention:
//   feedMoodDaily[dayTs][feedId] = { t: items, p: positive, u: neutral, g: heavy, c: { category: n } }
// Nothing here calls the AI: it only counts scores that already exist.

import { weekStart, monthStart, addDays } from './feedRollup.js';

export const MOOD_KEEP_DAYS = 400;
export const MIN_RATED = 5;
export const SPANS = { day: 14, week: 8, month: 6 };

/** Count items into the daily store. A day/feed entry is only replaced by a count that rates at least as many items. */
export function snapshotMood(store, items, itemMood, startOfDay, now = Date.now()) {
    const fresh = {};
    items.forEach(i => {
        const d = startOfDay(i.published);
        fresh[d] = fresh[d] || {};
        const e = fresh[d][i.feedId] = fresh[d][i.feedId] || { t: 0, p: 0, u: 0, g: 0, c: {} };
        e.t++;
        const m = itemMood(i);
        if (m) { e[m === 'pos' ? 'p' : m === 'neg' ? 'g' : 'u']++; if (i.cat) e.c[i.cat] = (e.c[i.cat] || 0) + 1; }
    });
    let changed = false;
    Object.keys(fresh).forEach(d => Object.keys(fresh[d]).forEach(f => {
        const n = fresh[d][f], o = store[d] && store[d][f];
        const nr = n.p + n.u + n.g, or = o ? o.p + o.u + o.g : -1;
        if (!o || nr > or || (nr === or && n.t >= o.t && JSON.stringify(n) !== JSON.stringify(o))) {
            (store[d] = store[d] || {})[f] = n; changed = true;
        }
    }));
    const cutoff = startOfDay(now - MOOD_KEEP_DAYS * 86400000);
    Object.keys(store).forEach(d => { if (+d < cutoff) { delete store[d]; changed = true; } });
    return changed;
}

const emptyB = () => ({ t: 0, p: 0, u: 0, g: 0, c: {}, f: {} });

/** Start timestamps of the last `n` buckets (oldest first) for a granularity. */
export function bucketStarts(scope, now, n = SPANS[scope]) {
    const out = [];
    if (scope === 'day') { const t = addDays(now, 0); for (let k = n - 1; k >= 0; k--) out.push(addDays(t, -k)); }
    else if (scope === 'week') { const w = weekStart(now); for (let k = n - 1; k >= 0; k--) out.push(addDays(w, -7 * k)); }
    else { const d = new Date(now); for (let k = n - 1; k >= 0; k--) out.push(new Date(d.getFullYear(), d.getMonth() - k, 1).getTime()); }
    return out;
}
export const bucketEnd = (scope, start) => scope === 'day' ? start : scope === 'week' ? addDays(start, 6) : new Date(new Date(start).getFullYear(), new Date(start).getMonth() + 1, 0).getTime();
const bucketOf = (scope, ts) => scope === 'day' ? ts : scope === 'week' ? weekStart(ts) : monthStart(ts);

/** Sum the daily store into buckets; `feeds` is a Set of feedIds (null = all). */
export function buildBuckets(store, scope, now, feeds = null) {
    const starts = bucketStarts(scope, now);
    const map = new Map(starts.map(s => [s, { start: s, end: bucketEnd(scope, s), ...emptyB() }]));
    Object.keys(store).forEach(d => {
        const b = map.get(bucketOf(scope, +d)); if (!b) return;
        Object.keys(store[d]).forEach(f => {
            if (feeds && !feeds.has(f)) return;
            const e = store[d][f];
            b.t += e.t; b.p += e.p; b.u += e.u; b.g += e.g;
            Object.keys(e.c).forEach(k => { b.c[k] = (b.c[k] || 0) + e.c[k]; });
            const s = (b.f[f] = b.f[f] || { p: 0, u: 0, g: 0 }); s.p += e.p; s.u += e.u; s.g += e.g;
        });
    });
    return starts.map(s => {
        const b = map.get(s); b.rated = b.p + b.u + b.g;
        b.index = moodIndex(b);
        return b;
    });
}

/** −100…+100: share of positive minus share of heavy among rated items; null when too few are rated. */
export function moodIndex(b) {
    const r = b.p + b.u + b.g;
    return r >= MIN_RATED ? Math.round((b.p - b.g) * 100 / r) : null;
}

export const pct = (b) => { const r = b.p + b.u + b.g; return r ? { pos: Math.round(b.p * 100 / r), neu: Math.round(b.u * 100 / r), neg: Math.round(b.g * 100 / r) } : { pos: 0, neu: 0, neg: 0 }; };

/** What changed between two buckets: categories (share of rated) and sources (their own mood index). */
export function movers(cur, prev) {
    const share = (b, n) => b.rated ? n * 100 / b.rated : 0;
    const keys = new Set([...Object.keys(cur.c), ...Object.keys(prev.c)]);
    const cats = [...keys].map(k => [k, Math.round(share(cur, cur.c[k] || 0) - share(prev, prev.c[k] || 0))])
        .filter(x => x[1] !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4);
    const si = (s) => { const r = s.p + s.u + s.g; return r >= 2 ? (s.p - s.g) * 100 / r : null; };
    const srcs = [...new Set([...Object.keys(cur.f), ...Object.keys(prev.f)])].map(f => {
        const a = cur.f[f] && si(cur.f[f]), b = prev.f[f] && si(prev.f[f]);
        return a != null && b != null ? [f, Math.round(a - b)] : null;
    }).filter(x => x && x[1] !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3);
    return { cats, srcs };
}
