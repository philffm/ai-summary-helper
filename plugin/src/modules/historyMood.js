// historyMood.js — mood data for History articles (the "big" summaries).
// A score (-1..1) is stored on the articlesIndex entry as `moodScore`. It comes from the AI (button in the
// History analytics) or is carried over from a feed item that was already scored. Nothing is guessed on-device.
import { scoreItems, MAX_RECAP_ITEMS } from './feedAi.js';
import { itemMood } from './feedSentiment.js';
import { snapshotMood } from './feedMood.js';
import StorageManager from './storageManager.js';

const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const plain = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/[#*_`>]+/g, ' ').replace(/\s+/g, ' ').trim();
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

/** An articlesIndex entry shaped like a feed item, so feedMood/moodView can count it. */
export function articleAsItem(a) {
    const scored = typeof a.moodScore === 'number';
    return {
        id: a.id, feedId: 'history', url: a.url, title: a.title || '', snippet: plain(a.summary).slice(0, 200),
        published: Date.parse(a.timestamp) || 0, ai: scored, sent: scored ? a.moodScore : undefined,
        cat: (a.tags || []).find(t => t && t !== 'feed') || undefined
    };
}

/** Daily mood counts for the History archive (rebuilt on demand — History is never pruned). */
export function moodStoreFor(articles) {
    const store = {};
    snapshotMood(store, (articles || []).map(articleAsItem), itemMood, startOfDay);
    return store;
}

export const unscoredIn = (articles, from, to) => (articles || []).filter(a => typeof a.moodScore !== 'number'
    && startOfDay(Date.parse(a.timestamp) || 0) >= from && startOfDay(Date.parse(a.timestamp) || 0) <= to)
    .sort((x, y) => (Date.parse(y.timestamp) || 0) - (Date.parse(x.timestamp) || 0));

/** Score articles with the AI (title + start of the summary) and store the result. Returns how many were scored. */
export async function scoreArticles(list, onProgress) {
    const todo = (list || []).filter(a => a && typeof a.moodScore !== 'number');
    const done = {};
    for (let k = 0; k < todo.length; k += MAX_RECAP_ITEMS) {
        const chunk = todo.slice(k, k + MAX_RECAP_ITEMS);
        if (onProgress) onProgress(Math.min(k + chunk.length, todo.length), todo.length);
        const { scores } = await scoreItems(chunk.map(articleAsItem), (i) => host(i.url));
        chunk.forEach((a, n) => { if (scores[n] !== null && scores[n] !== undefined) done[a.id] = scores[n]; });
        await StorageManager.setArticleMoods(done);
    }
    return Object.keys(done).length;
}
