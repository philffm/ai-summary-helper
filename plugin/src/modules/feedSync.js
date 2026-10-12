// modules/feedSync.js
// Pure merge logic for the feed-URL vault (no storage, no network, no DOM): the same rules are implemented on the phone and
// checked against tests/fixtures/feed-sync-vector.json.
//
// What syncs: feed URLs, their title and tags. Never items, articles or read state.
// An entry is { url, title?, tags?, updatedAt, removed? }. A removed feed stays in the list as a tombstone so the other device
// learns about the removal instead of re-adding the feed.
//
// Rules (every device applies the same ones, so all devices converge):
//   • entries are matched by URL;
//   • the entry with the larger updatedAt wins; on a tie a tombstone wins, then the larger canonical JSON;
//   • tombstones older than TOMBSTONE_TTL_MS are dropped.

export const FEED_SYNC_VERSION = 1;
export const TOMBSTONE_TTL_MS = 90 * 24 * 3600e3;
export const MAX_FEEDS = 1000;
const MAX_TAGS = 8;

const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

/** Web feed URLs only. Returns the normalised URL or '' (the vault comes from another device: never trusted). */
export function cleanFeedUrl(raw) {
    if (typeof raw !== 'string') return '';
    const s = raw.replace(/[\u0000-\u001f\u007f\s]+/g, '');
    if (!s || s.length > 2048) return '';
    let u;
    try { u = new URL(s); } catch (_) { return ''; }
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname ? u.href : '';
}

export function cleanTagList(tags) {
    const out = [];
    for (const t of Array.isArray(tags) ? tags : []) {
        const v = clip(t, 40);
        if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
        if (out.length >= MAX_TAGS) break;
    }
    return out;
}

/** One entry in canonical form (fixed key order), or null when unusable. */
export function cleanEntry(e) {
    if (!e || typeof e !== 'object') return null;
    const url = cleanFeedUrl(e.url);
    const updatedAt = Number(e.updatedAt);
    if (!url || !Number.isFinite(updatedAt) || updatedAt < 0) return null;
    if (e.removed === true) return { url, updatedAt: Math.floor(updatedAt), removed: true };
    const out = { url, title: clip(e.title, 200), tags: cleanTagList(e.tags), updatedAt: Math.floor(updatedAt) };
    return out;
}

const canon = (e) => JSON.stringify(e);

/** Cleans a list: invalid entries dropped, duplicates resolved by the merge rule, capped at MAX_FEEDS (newest first). */
export function cleanEntries(list) {
    const map = new Map();
    for (const raw of Array.isArray(list) ? list : []) {
        const e = cleanEntry(raw);
        if (e) map.set(e.url, map.has(e.url) ? pick(map.get(e.url), e) : e);
    }
    return sortEntries([...map.values()]).slice(0, MAX_FEEDS);
}

function pick(a, b) {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
    if (!!a.removed !== !!b.removed) return a.removed ? a : b;
    return canon(a) >= canon(b) ? a : b;
}

const sortEntries = (list) => list.sort((a, b) => b.updatedAt - a.updatedAt || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));

/** Union of two lists under the rules above. Commutative, associative and idempotent. */
export function mergeEntries(a, b, now = Date.now()) {
    const map = new Map();
    for (const e of [...cleanEntries(a), ...cleanEntries(b)]) map.set(e.url, map.has(e.url) ? pick(map.get(e.url), e) : e);
    const kept = [...map.values()].filter((e) => !(e.removed && now - e.updatedAt > TOMBSTONE_TTL_MS));
    return sortEntries(kept).slice(0, MAX_FEEDS);
}

/**
 * What this device did since the last sync. `subs` are the live feeds ([{url,title,tags}]); `base` is the merged list as
 * of the last sync (including tombstones). Unchanged feeds keep their old updatedAt; new or edited feeds get `now`;
 * feeds that vanished get a tombstone stamped `now`; a feed that came back replaces its tombstone.
 */
export function localEntries(subs, base, now = Date.now()) {
    const was = new Map(cleanEntries(base).map((e) => [e.url, e]));
    const out = [];
    const live = new Set();
    for (const s of Array.isArray(subs) ? subs : []) {
        const cur = cleanEntry({ url: s && s.url, title: s && s.title, tags: s && s.tags, updatedAt: 0 });
        if (!cur || live.has(cur.url)) continue;
        live.add(cur.url);
        const old = was.get(cur.url);
        const same = old && !old.removed && old.title === cur.title && canon(old.tags) === canon(cur.tags);
        out.push(same ? old : { ...cur, updatedAt: now });
    }
    for (const [url, old] of was) {
        if (live.has(url)) continue;
        out.push(old.removed ? old : { url, updatedAt: now, removed: true });
    }
    return out;
}

/** What to change on this device so that its feeds match the merged list. */
export function planChanges(subs, merged) {
    const have = new Map((Array.isArray(subs) ? subs : []).map((s) => [s.url, s]));
    const plan = { add: [], update: [], remove: [] };
    for (const e of merged) {
        const s = have.get(e.url);
        if (e.removed) { if (s) plan.remove.push(e.url); continue; }
        if (!s) { plan.add.push({ url: e.url, title: e.title, tags: e.tags }); continue; }
        if ((e.title && (s.title || '') !== e.title) || canon(cleanTagList(s.tags)) !== canon(e.tags)) plan.update.push({ url: e.url, title: e.title || s.title || '', tags: e.tags });
    }
    return plan;
}

export const sameEntries = (a, b) => canon(cleanEntries(a)) === canon(cleanEntries(b));
