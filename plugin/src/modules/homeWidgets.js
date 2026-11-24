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

/**
 * A note of the user's own (kind "note"), picked at random from the lean index; only that record is read. A comment on a highlight is not
 * one: on its own it is a sentence without the passage it belongs to (the card once showed only that), so the highlight side shows those.
 * A note that was written with a quote brings the quote too.
 * → { text, quote?, title, url } or null
 */
export async function pickNote(noteIndex, readRec, rand = Math.random) {
    const pool = (Array.isArray(noteIndex) ? noteIndex : []).filter((e) => e && e.id && e.kind === 'note');
    for (let i = 0; i < 3 && pool.length; i++) {
        const e = pool.splice(Math.floor(rand() * pool.length), 1)[0];
        let rec = null; try { rec = await readRec(e.id); } catch (_) { /* next */ }
        const text = String((rec && rec.text) || '').replace(/\s+/g, ' ').trim();
        const quote = String((rec && rec.quote) || '').replace(/\s+/g, ' ').trim();
        if (text.length >= 12) return { text: text.slice(0, 600), ...(quote ? { quote: quote.slice(0, 400) } : {}), title: (rec && rec.title) || '', url: (rec && rec.url) || '' };
    }
    return null;
}

/**
 * What the "From your highlights" card shows: a highlight or a note, by chance when both exist (so it is not always the same kind), the other
 * one when the first has nothing usable. → { kind: 'highlight' | 'note', text, url, title? } or null
 */
export async function pickSnippet({ hlIndex, readPage, noteIndex, readNote }, rand = Math.random) {
    const hasHl = (Array.isArray(hlIndex) ? hlIndex : []).some((p) => p && p.k && p.n > 0), hasNote = (Array.isArray(noteIndex) ? noteIndex : []).some((e) => e && e.kind === 'note');
    const order = hasHl && hasNote ? (rand() < 0.5 ? ['highlight', 'note'] : ['note', 'highlight']) : hasHl ? ['highlight'] : hasNote ? ['note'] : [];
    for (const kind of order) {
        if (kind === 'highlight') { const q = await pickQuote(hlIndex, readPage, rand); if (q) return { kind, ...q }; }
        else { const n = await pickNote(noteIndex, readNote, rand); if (n) return { kind, ...n }; }
    }
    return null;
}

/**
 * The biggest topics of the library for the Topics card: [{ id, label, raw, n }] by number of articles (raw = the tag as saved, what a search for it matches) (language marks and one-article topics left out).
 * tagId / tagLabel / isLanguage come from the graph code (graphGaps.js), so a topic is the same one as in the graph.
 */
export function topTopics(articles, { tagId, tagLabel, isLanguage = () => false }, max = 10, minArticles = 2) {
    const by = new Map();
    for (const a of live(articles)) for (const t of new Set(a.tags || [])) {
        if (isLanguage(t)) continue;
        const id = tagId(t); const e = by.get(id) || { id, label: tagLabel(t), raw: t, n: 0 }; e.n++; by.set(id, e);
    }
    return [...by.values()].filter((e) => e.n >= minArticles).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).slice(0, max);
}

/**
 * Circles for the topics, packed into a w × h box without overlap: biggest first, each on the first free spot of a spiral around the middle.
 * Radii follow √n. → [{ ...topic, x, y, r }] (fewer when one does not fit at the smallest size)
 */
export function packBubbles(topics, w, h, { gap = 3, maxR = Math.min(w, h) * 0.42, minR = 7 } = {}) {
    if (!topics.length) return [];
    const top = topics[0].n, placed = [];
    for (const t of topics) {
        const r = Math.max(minR, maxR * Math.sqrt(t.n / top));
        let spot = null;
        for (let k = 0; k < 900 && !spot; k++) {
            const ang = k * 0.45, dist = 2.2 * k * Math.max(0.4, r / 24);
            const x = w / 2 + Math.cos(ang) * dist * (w / h > 1.4 ? 1.8 : 1), y = h / 2 + Math.sin(ang) * dist;
            if (x - r < 0 || x + r > w || y - r < 0 || y + r > h) continue;
            if (placed.every((p) => Math.hypot(p.x - x, p.y - y) >= p.r + r + gap)) spot = { x, y };
        }
        if (spot) placed.push({ ...t, ...spot, r });
    }
    return placed;
}

// quiz and gaps are shown only when they have something to say
export const WIDGETS = ['briefing', 'quote', 'stats', 'continue', 'recent', 'graph', 'quiz', 'gaps'];
/** The widgets to show, in order, minus the ones the user hid. */
export const visibleWidgets = (hidden) => WIDGETS.filter((w) => !(hidden || []).includes(w));

export function greetingKey(hour) { return hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'; }
