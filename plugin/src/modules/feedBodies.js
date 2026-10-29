// feedBodies.js
// The full text some feeds carry (content:encoded, Atom content) kept for reading inside the extension. It lives under its own
// keys, one per item, so the item list (read on every Feed open and sent through sync) stays small. Only items first seen get a body;
// bodies older than the retention window are dropped with a sweep. The HTML is stored as the feed sent it: clean it when it is shown.
export const FEED_BODY = 'feeds:body:';
export const FEED_BODY_INDEX = 'feeds:bodies';   // { itemId: published } — what is stored, and how old
export const MAX_FEED_BODY = 60000;              // characters per item
const MIN_BODY_TEXT = 240;                       // shorter than this is just the snippet again

export const feedBodyKey = (id) => FEED_BODY + id;

/**
 * Pick the HTML to keep from an item's candidate fields (best first, already decoded). Returns '' when there is nothing beyond a
 * short summary. `textLength` measures the text of a candidate (the parsers pass their own tag stripper).
 */
export function pickBody(candidates, textLength) {
    for (const html of candidates) {
        const s = String(html || '').trim();
        if (s && textLength(s) > MIN_BODY_TEXT) return s.length > MAX_FEED_BODY ? s.slice(0, MAX_FEED_BODY) : s;
    }
    return '';
}

/** Store the bodies of items not stored yet. entries: [{ id, html, published }]. */
export async function saveFeedBodies(entries, store = chrome.storage.local) {
    const fresh = (entries || []).filter(e => e && e.id && e.html);
    if (!fresh.length) return 0;
    const index = (await store.get(FEED_BODY_INDEX))[FEED_BODY_INDEX] || {};
    const set = {};
    let n = 0;
    for (const e of fresh) {
        if (index[e.id] !== undefined) continue;
        set[feedBodyKey(e.id)] = e.html;
        index[e.id] = Number(e.published) || Date.now();
        n++;
    }
    if (!n) return 0;
    set[FEED_BODY_INDEX] = index;
    await store.set(set);
    return n;
}

export async function getFeedBody(id, store = chrome.storage.local) {
    if (!id) return '';
    const key = feedBodyKey(id);
    return (await store.get(key))[key] || '';
}

/** Drop the bodies of items published before `cutoff` (ms). */
export async function pruneFeedBodies(cutoff, store = chrome.storage.local) {
    const index = (await store.get(FEED_BODY_INDEX))[FEED_BODY_INDEX];
    if (!index) return 0;
    const stale = Object.keys(index).filter(id => index[id] < cutoff);
    if (!stale.length) return 0;
    stale.forEach(id => { delete index[id]; });
    await store.remove(stale.map(feedBodyKey));
    await store.set({ [FEED_BODY_INDEX]: index });
    return stale.length;
}
