// modules/syncReadable.js
// The readable file format for sync places (see .briefs/prd-library-sync.md section 4): normal JSON a website can read.
// Pure: no storage, no network, no DOM.
//
//   articles/<id>.json   AISH Article JSON v1 (plugin/formats/article-json-v1.md) plus a small `_sync` block
//   library.json         the list for websites: every published article without the full text
//
// Include mask: what a place may receive. Everything outside the mask is never written. (Publish-only places write only the
// v1 view; the values and stamps of other fields join `_sync` with two-way places, and the same mask will apply to them.)
// A article that stops matching the place's filter is not "deleted": a publish-only place simply drops its file, a two-way
// place will get an `excluded` marker that pulls ignore (only a real deletion ever produces `deleted`).
import { toArticleJson } from './articleFormat.js';
import { hashValue } from './syncStamps.js';

export const READABLE_VERSION = 1;
// The first two are the everyday defaults. The last three are the danger zone: they put your private writing, your reminders and
// copies of other people's articles into files anyone with access to the folder can read. All off by default.
export const INCLUDE_DEFAULT = { highlights: true, qa: false, notes: false, reminders: false, fulltext: false };

export const articlePath = (id) => 'articles/' + String(id).replace(/[^A-Za-z0-9_.-]/g, '_') + '.json';
export const LIBRARY_PATH = 'library.json';
export const LIBRARY_JS_PATH = 'library.js';   // the same list as a script, for a viewer opened from disk

export const includeOf = (place) => ({ ...INCLUDE_DEFAULT, ...((place && place.include) || {}) });

const hasTag = (entry, tag) => {
    const want = String(tag || '').trim().toLowerCase();
    return !!want && (Array.isArray(entry && entry.tags) ? entry.tags : []).some((t) => String(t).trim().toLowerCase() === want);
};

/**
 * Does this article belong in the place? Feed stubs and saved-only entries never go out (nothing to publish).
 * A place filter is { tag } (only articles with it) or { excludeTag } (everything but those). No filter = everything.
 */
export function placeMatches(entry, place) {
    if (!entry || !entry.id || entry.feedStub || entry.savedOnly) return false;
    const f = (place && place.filter) || {};
    if (f.tag) return hasTag(entry, f.tag);
    if (f.excludeTag) return !hasTag(entry, f.excludeTag);
    return true;
}

/** Changes whenever something that decides what a place holds changes: mode, include, filter. A change re-checks every article. */
export function configHash(place) {
    const p = place || {};
    return hashValue({ mode: p.mode || 'readable', include: includeOf(p), filter: p.filter || {} });
}

const BLOCK_TAG = /<\/?(?:p|div|section|article|blockquote|ul|ol|li|h[1-6]|pre|br|tr|table)\b[^>]*>/gi;
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** The saved text as blocks, without a DOM (the worker has none): [['h2','…'], ['p','…']]. Plain text works too. Capped. */
export function textToBlocksLite(content, { maxBlocks = 4000, maxChars = 400000 } = {}) {
    const raw = String(content || '');
    const looksHtml = /<[a-z][\s\S]*>/i.test(raw);
    const parts = looksHtml ? raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').split(BLOCK_TAG) : raw.split(/\n{2,}/);
    const heads = looksHtml ? [...raw.matchAll(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => decode(m[2].replace(/<[^>]+>/g, '').trim())) : [];
    const out = []; let chars = 0;
    for (const part of parts) {
        const t = decode(part.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
        if (!t) continue;
        out.push([heads.includes(t) ? 'h2' : 'p', t]); chars += t.length;
        if (out.length >= maxBlocks || chars >= maxChars) break;
    }
    return out;
}

/** The file for one article: Article JSON v1 plus `_sync`, and whatever the danger-zone switches allow. `full` = index entry merged with its record. */
export function buildArticleFile({ entry, rec, highlights = [], comments = {}, place, rev }) {
    const inc = includeOf(place);
    const full = { ...entry, ...(rec || {}) };
    const conversation = inc.qa && Array.isArray(rec && rec.conversation) ? rec.conversation : [];
    const shown = inc.highlights ? highlights : [];
    const obj = toArticleJson(full, { highlights: shown, conversation });
    if (inc.notes) {   // a comment rides on its highlight (same order as the file's list: toArticleJson keeps live ones in order)
        const live = shown.filter((h) => h && h.text && !h.dismissed);
        obj.highlights.forEach((o, i) => { const c = live[i] && comments[live[i].id]; if (c && c.text) { o.comment = c.text; if (c.tags && c.tags.length) o.tags = c.tags; } });
    }
    if (inc.reminders && entry && entry.decisionTimeframe) obj.reminder = { timeframe: String(entry.decisionTimeframe), ...(entry.decisionReason ? { reason: String(entry.decisionReason) } : {}) };
    if (inc.fulltext && rec && rec.content) { const b = textToBlocksLite(rec.content); if (b.length) obj.blocks = b; }
    obj._sync = { v: READABLE_VERSION, ...(rev ? { rev } : {}) };
    return obj;
}

/** The free notes for library.json (danger zone). Newest first. */
export function notesForLibrary(notes) {
    return (notes || []).map((n) => ({ id: n.id, text: n.text, tags: n.tags || [], created: n.created, ...(n.url ? { url: n.url } : {}), ...(n.quote ? { quote: n.quote } : {}) }))
        .sort((a, b) => String(b.created).localeCompare(String(a.created)));
}

/** One list entry: the article file without `_sync` and without the full text. */
export function libraryEntry(file) {
    const { _sync, blocks, ...rest } = file || {};
    void _sync;
    return blocks && blocks.length ? { ...rest, hasText: true } : rest;   // the list never carries the text, only that it is in the article's own file
}

/** library.json for websites. `files` = the article files of everything the place holds. Newest first, stable. */
export function buildLibrary(files, { now = () => new Date().toISOString(), notes } = {}) {
    const articles = (files || []).map(libraryEntry).sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')) || String(a.id).localeCompare(String(b.id)));
    return { aish: 'library/1', generatedAt: now(), count: articles.length, articles, ...(notes ? { notes } : {}) };
}

export const toJson = (obj) => JSON.stringify(obj, null, 2) + '\n';
