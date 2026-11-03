// graphSimilarity.js — which articles are about the same thing, worked out from their text, on the device.
// Pure functions: no DOM, no chrome.*, no network. Same input, same result (every tie is broken by id / term).
//
// Why it is not localSearch.js: the search index is rebuilt on every archive change and only sees what the lean index entries hold
// (title, tags, summary — not the saved text). This one keeps a SMALL vector per article (its strongest terms), so it can be
// stored, updated per article and compared across the whole archive in a fraction of a second (see GRAPH.md, "Performance").
//
//   buildEntry()   one article → { f: fingerprint, full: 0|1, t: [[term, weight], …] }  (strongest terms only)
//   neighbours()   all entries → each article's most similar others (inverted index, pruned vectors)
//   signature()    short hash of the entries; tells the cache whether its neighbours are still current
import { STOPWORDS } from './textUtils.js';

export const SIM_VERSION = 1;
export const TERMS_KEPT = 100;      // strongest terms stored per article
export const TOP_TERMS = 40;        // strongest terms compared (after idf)
export const MAX_DF = 0.25;         // a term that is in more than this share of the articles says nothing (also drops stop words of any language)
export const NEIGHBOURS = 3;        // per article
export const MIN_SCORE = 0.22;
export const CONTENT_CAP = 30000;   // characters of saved text read per article
const W = { title: 3, tags: 3, summary: 1, content: 1 };

const HAN_KANA = /[぀-ヿ㐀-䶿一-鿿]/;
const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');

/** Unicode-aware words (umlauts, accents, Cyrillic, Greek …); Han/Kana runs become overlapping character pairs. Lower-case, ≥ 3 letters. */
export function tokenize(text) {
    const words = stripTags(text).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
    const out = [];
    for (const raw of words) {
        const w = raw.replace(/^[-'’]+|[-'’]+$/g, '');
        if (HAN_KANA.test(w)) { for (let i = 0; i + 1 < w.length; i++) out.push(w.slice(i, i + 2)); continue; }
        if (w.length < 3 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
        out.push(w);
    }
    return out;
}

/** Changes whenever what the vector is built from changes (title, tags, summary, text length). Cheap: no text needed. */
export function fingerprintOf(a) {
    return [a.timestamp || '', a.contentWordCount || 0, String(a.summary || '').length, String(a.title || '').length, (a.tags || []).join('|')].join(':');
}

/** @param {{title?, tags?, summary?, content?}} fields  @param {object} meta the index entry (for the fingerprint) @param {boolean} full text included */
export function buildEntry(fields, meta, full) {
    const tf = new Map();
    const add = (text, weight) => { for (const t of tokenize(text)) tf.set(t, (tf.get(t) || 0) + weight); };
    add(fields.title, W.title);
    add((fields.tags || []).join(' '), W.tags);
    add(fields.summary, W.summary);
    if (full && fields.content) add(String(fields.content).slice(0, CONTENT_CAP), W.content);
    const t = [...tf.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, TERMS_KEPT);
    return { f: fingerprintOf(meta || fields), full: full ? 1 : 0, t };
}

/** Short stable hash of what the neighbours were computed from. */
export function signature(items) {
    let h = 5381;
    for (const id of Object.keys(items).sort()) {
        const s = id + ':' + items[id].f + ':' + items[id].full + ';';
        for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(36) + ':' + Object.keys(items).length;
}

/**
 * Most similar articles for every article.
 * @param {Object<string,{t:Array}>} items id → entry
 * @param {{k?, minScore?, maxDf?, topTerms?}} opts
 * @param {() => Promise<void>} [pause] awaited every 100 articles, so a long run can hand the thread back
 * @returns {Promise<Object<string, Array<[string, number]>>>} id → [[otherId, score], …] best first
 */
export async function neighbours(items, { k = NEIGHBOURS, minScore = MIN_SCORE, maxDf = MAX_DF, topTerms = TOP_TERMS } = {}, pause = null) {
    const ids = Object.keys(items).sort();
    const N = ids.length;
    const df = new Map();
    for (const id of ids) for (const [t] of items[id].t) df.set(t, (df.get(t) || 0) + 1);
    const idf = new Map();
    df.forEach((n, t) => { if (n / N <= maxDf || N < 8) idf.set(t, Math.log((N + 1) / (n + 1)) + 1); });

    // pruned, normalised vectors + inverted index
    const vec = new Map(), post = new Map();
    let n = 0;
    for (const id of ids) {
        const top = items[id].t.filter(([t]) => idf.has(t)).map(([t, c]) => [t, (1 + Math.log(c)) * idf.get(t)])
            .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, topTerms);
        let norm = 0; top.forEach(([, w]) => { norm += w * w; }); norm = Math.sqrt(norm) || 1;
        const v = top.map(([t, w]) => [t, w / norm]);
        vec.set(id, v);
        for (const [t, w] of v) { let p = post.get(t); if (!p) post.set(t, p = []); p.push([id, w]); }
        if (pause && ++n % 100 === 0) await pause();
    }
    const out = {};
    n = 0;
    for (const id of ids) {
        const acc = new Map();
        for (const [t, w] of vec.get(id)) for (const [o, w2] of post.get(t)) if (o !== id) acc.set(o, (acc.get(o) || 0) + w * w2);
        const best = [...acc.entries()].filter(([, s]) => s >= minScore).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, k)
            .map(([o, s]) => [o, Math.round(s * 1000) / 1000]);
        if (best.length) out[id] = best;
        if (pause && ++n % 100 === 0) await pause();
    }
    return out;
}
