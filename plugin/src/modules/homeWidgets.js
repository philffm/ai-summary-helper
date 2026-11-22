// homeWidgets.js — what the home page shows, as pure functions over the stored index (tested without a DOM).
const ts = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : 0; };
const live = (index) => (index || []).filter((a) => a && !a.archived);

/** Started but not finished, most recently opened first. */
export function continueReading(index, limit = 5) {
    return live(index).filter((a) => ((a.progress > 0.02 && a.progress < 0.95) || a.readPlace) && !a.finishedAt)
        .sort((a, b) => ts(b.lastOpened || b.timestamp) - ts(a.lastOpened || a.timestamp)).slice(0, limit);
}

/** Newest saved articles that were not opened yet come first, then the rest by date. */
export function recentlySaved(index, limit = 6) {
    return live(index).sort((a, b) => ts(b.timestamp) - ts(a.timestamp)).slice(0, limit);
}

/** The list the Feeds screen holds plus what the background poll found since (the popup merges those on open; the home page does it on read). */
export function mergeFeed(items, background) {
    const seen = new Set(), out = [];
    for (const i of [...(Array.isArray(background) ? background : []), ...(Array.isArray(items) ? items : [])]) {
        const k = i && (i.link || i.id); if (!k || seen.has(k)) continue; seen.add(k); out.push(i);
    }
    return out;
}

/** Newest feed items. */
export function latestFeed(items, limit = 6) {
    return (Array.isArray(items) ? items : []).filter((i) => i && i.title && i.link).sort((a, b) => (b.published || 0) - (a.published || 0)).slice(0, limit);
}

export function libraryStats(index, now = Date.now()) {
    const a = live(index), week = now - 7 * 864e5;
    return {
        total: a.length,
        unread: a.filter((x) => !x.readAt && !x.finishedAt && !(x.progress > 0)).length,
        starred: a.filter((x) => x.starred).length,
        finishedThisWeek: a.filter((x) => ts(x.finishedAt) >= week).length,
    };
}

/**
 * A random saved highlight (never a ghost or a dismissed one, long enough to be worth reading), or null.
 * hlIndex = [{ k: pageKey, n: active highlights }], readPage(k) → that page's records. Only the chosen page is read, not the whole store.
 */
export async function pickQuote(hlIndex, readPage, rand = Math.random, tries = 4) {
    const pages = (Array.isArray(hlIndex) ? hlIndex : []).filter((p) => p && p.k && p.n > 0);
    for (let i = 0; i < tries && pages.length; i++) {
        const page = pages.splice(Math.floor(rand() * pages.length), 1)[0];
        let recs = []; try { recs = await readPage(page.k) || []; } catch (_) { /* next page */ }
        const ok = recs.filter((r) => r && r.type !== 'ghost' && !r.dismissed && r.text && r.text.length >= 25 && r.text.length <= 600);
        if (ok.length) { const r = ok[Math.floor(rand() * ok.length)]; return { text: r.text, url: r.url || page.k, timestamp: r.timestamp || '' }; }
    }
    return null;
}

/** The newest recap of "all feeds" (keys are "<dayStart>|all"): { key, recap } or null. */
export function latestBriefing(recaps) {
    let best = null;
    for (const [key, r] of Object.entries(recaps || {})) {
        if (!/\|all$/.test(key) || !r || (!r.overview && !(r.themes || []).length)) continue;
        if (!best || (r.at || 0) > (best.recap.at || 0)) best = { key, recap: r };
    }
    return best;
}

/** Pages through a long list: next() → the next `size` items, more() → is there anything left. (The home lists load as you scroll.) */
export function pager(items, size = 12) {
    let at = 0; const list = Array.isArray(items) ? items : [];
    return { next() { const out = list.slice(at, at + size); at += out.length; return out; }, more: () => at < list.length, get shown() { return at; }, get total() { return list.length; } };
}

export const WIDGETS = ['briefing', 'quote', 'stats', 'continue', 'recent'];
/** The widgets to show, in order, minus the ones the user hid. */
export const visibleWidgets = (hidden) => WIDGETS.filter((w) => !(hidden || []).includes(w));

export function greetingKey(hour) { return hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'; }
