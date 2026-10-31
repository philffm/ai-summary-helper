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
export const INCLUDE_DEFAULT = { highlights: true, qa: false };

export const articlePath = (id) => 'articles/' + String(id).replace(/[^A-Za-z0-9_.-]/g, '_') + '.json';
export const LIBRARY_PATH = 'library.json';

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

/** The file for one article: Article JSON v1 plus `_sync`. `full` = index entry merged with its record. */
export function buildArticleFile({ entry, rec, highlights = [], place, rev }) {
    const inc = includeOf(place);
    const full = { ...entry, ...(rec || {}) };
    const conversation = inc.qa && Array.isArray(rec && rec.conversation) ? rec.conversation : [];
    const obj = toArticleJson(full, { highlights: inc.highlights ? highlights : [], conversation });
    obj._sync = { v: READABLE_VERSION, ...(rev ? { rev } : {}) };
    return obj;
}

/** One list entry: the article file without `_sync` and without the full text. */
export function libraryEntry(file) {
    const { _sync, blocks, ...rest } = file || {};
    void _sync; void blocks;
    return rest;
}

/** library.json for websites. `files` = the article files of everything the place holds. Newest first, stable. */
export function buildLibrary(files, { now = () => new Date().toISOString() } = {}) {
    const articles = (files || []).map(libraryEntry).sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')) || String(a.id).localeCompare(String(b.id)));
    return { aish: 'library/1', generatedAt: now(), count: articles.length, articles };
}

export const toJson = (obj) => JSON.stringify(obj, null, 2) + '\n';
