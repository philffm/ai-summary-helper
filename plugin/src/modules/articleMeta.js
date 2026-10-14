// modules/articleMeta.js
// The small facts about an article that every outgoing format (phone envelope, Markdown, JSON) reads the same way:
// site, author, language, one-line text. Pure: no chrome.*, no DOM, no fetch.

export const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Host without "www.", or '' when the URL is missing or not absolute. */
export function siteOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
}

/** Byline from the page, or the author the paper detection found. */
export function authorOf(a) {
    const x = a || {};
    return oneLine(x.byline || x.author || (x.meta && (x.meta.paper && x.meta.paper.authors || x.meta.author)));
}

/** Language of the article (BCP-47-ish, max 20 chars). */
export function langOf(a) {
    const x = a || {};
    return oneLine(x.language || x.lang || x.summaryLanguage).slice(0, 20);
}
