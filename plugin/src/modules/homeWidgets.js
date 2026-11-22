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

/**
 * The briefing for the home page: the day recap of all feeds ("<dayStart>|all"). Today's when there is one (it is what Feeds shows for
 * today), else the latest day that has one. Week and month roll-ups ("w:…|all", "m:…|all", hundreds of items, written for another page of
 * Feeds) are not day briefings and never come here. → { key, day, recap } or null
 */
export function latestBriefing(recaps, now = Date.now()) {
    const d0 = new Date(now); d0.setHours(0, 0, 0, 0); const today = d0.getTime();
    let best = null;
    for (const [key, r] of Object.entries(recaps || {})) {
        const m = /^(\d+)\|all$/.exec(key);
        if (!m || !r || (!r.overview && !(r.themes || []).length)) continue;
        const day = Number(m[1]);
        const rank = day === today ? Infinity : day;   // today first, then the most recent day
        if (!best || rank > best.rank || (rank === best.rank && (r.at || 0) > (best.recap.at || 0))) best = { key, day, recap: r, rank };
    }
    if (best) delete best.rank;
    return best;
}

/** Pages through a long list: next() → the next `size` items, more() → is there anything left. (The home lists load as you scroll.) */
export function pager(items, size = 12) {
    let at = 0; const list = Array.isArray(items) ? items : [];
    return { next() { const out = list.slice(at, at + size); at += out.length; return out; }, more: () => at < list.length, get shown() { return at; }, get total() { return list.length; } };
}

/**
 * Saved quizzes that are due for a repeat: the reminder time has passed and the quiz was not run again since (a run after the reminder was set
 * counts as the repeat). recs = the quiz records (quiz:rec:<id>). → [{ id, name, missed, dueAt }], the longest overdue first.
 */
export function dueQuizzes(recs, now = Date.now()) {
    const out = [];
    for (const q of recs || []) {
        const due = Date.parse(q && q.remindAt);
        if (!q || !q.id || !Number.isFinite(due) || due > now) continue;
        if (q.last && Date.parse(q.last.at) >= due) continue;
        out.push({ id: q.id, name: q.name || '', missed: Array.isArray(q.last && q.last.missed) ? q.last.missed.length : 0, total: (q.questions || []).length, dueAt: due });
    }
    return out.sort((a, b) => a.dueAt - b.dueAt);
}

// quiz and gaps are shown only when they have something to say
export const WIDGETS = ['briefing', 'quote', 'stats', 'continue', 'recent', 'quiz', 'gaps'];
/** The widgets to show, in order, minus the ones the user hid. */
export const visibleWidgets = (hidden) => WIDGETS.filter((w) => !(hidden || []).includes(w));

export function greetingKey(hour) { return hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'; }
