// graphGaps.js — "Started, never deepened": topics with few saved articles that nothing opened for a long time. Split out of archiveGraph.js so the
// home page can use it without loading the whole graph. archiveGraph.js re-exports findGaps; nothing else changed.
import { uiLocale } from './feedI18n.js';
import { conceptKey, isKnownTopic, isLanguageTag, topicLabel } from './topicConcepts.js';

// One node per topic, not per spelling: News / Nachrichten / Noticias share a node, shown in the UI language.
export const tagIdOf = (tag) => 'tag-' + (isKnownTopic(tag) ? 'c-' + conceptKey(tag).replace(/^c:/, '') : tag.toLowerCase()).replace(/\s+/g, '-');
export const tagLabelOf = (tag) => topicLabel(tag, uiLocale());

// "Started, never deepened": topics with at most GAP_MAX_ARTICLES saved articles where nothing was opened for GAP_DAYS.
const GAP_DAYS = 30;
const GAP_MAX_ARTICLES = 2;
const GAP_CAP = 25;
export const stamp = (a) => { const t = new Date(a.lastOpened || a.timestamp).getTime(); return Number.isFinite(t) ? t : 0; };

/**
 * Topics that were started and never followed up: { id, label, articles, last, never } — never-opened topics first,
 * then the longest untouched. Counted over ALL articles (rarely-used tags are hidden in the graph, so this is
 * the one place they show up).
 */
export function findGaps(articles, { now = Date.now(), days = GAP_DAYS, maxArticles = GAP_MAX_ARTICLES, cap = GAP_CAP } = {}) {
    const byTag = new Map();
    (articles || []).forEach(a => (a.tags || []).forEach(tag => {
        if (isLanguageTag(tag)) return;   // "🌐 de" marks the language, it is not a topic
        const id = tagIdOf(tag);
        let e = byTag.get(id);
        if (!e) byTag.set(id, e = { id, label: tagLabelOf(tag), articles: [] });
        if (!e.articles.includes(a)) e.articles.push(a);
    }));
    const out = [];
    byTag.forEach(e => {
        if (e.articles.length > maxArticles) return;
        const last = Math.max(...e.articles.map(stamp));
        if ((now - last) / 86400000 < days) return;
        out.push({ ...e, last, never: e.articles.every(a => !a.lastOpened) });
    });
    return out.sort((a, b) => (b.never - a.never) || (a.last - b.last)).slice(0, cap);
}
