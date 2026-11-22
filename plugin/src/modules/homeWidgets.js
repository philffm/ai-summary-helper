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

export const WIDGETS = ['continue', 'recent', 'feeds', 'stats', 'goto'];
/** The widgets to show, in order, minus the ones the user hid. */
export const visibleWidgets = (hidden) => WIDGETS.filter((w) => !(hidden || []).includes(w));

export function greetingKey(hour) { return hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'; }
