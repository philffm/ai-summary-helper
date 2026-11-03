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
import { isLanguageTag } from './topicConcepts.js';

export const SIM_VERSION = 2;   // 2: function words of more languages are no terms (cached vectors are rebuilt)
export const TERMS_KEPT = 100;      // strongest terms stored per article
export const TOP_TERMS = 40;        // strongest terms compared (after idf)
export const MAX_DF = 0.25;         // a term that is in more than this share of the articles says nothing (also drops stop words of any language)
export const NEIGHBOURS = 3;        // per article
export const MIN_SCORE = 0.22;
export const CONTENT_CAP = 30000;   // characters of saved text read per article
const W = { title: 3, tags: 3, summary: 1, content: 1 };

// Function words ("the" and its relatives) of the languages the extension is used in, three letters or more (shorter ones are dropped anyway).
// Without them a German article is "typical" for "die" and "und", and a group of German articles gets named after them.
const FUNCTION_WORDS = new Set((
    'der die das den dem des ein eine einer einen einem eines und oder aber nicht mit von für auf ist sind war waren wird werden wurde wurden auch als bei nach aus über wie noch nur sich dass zum zur vom beim hat haben kann können sein ihre ihr seine wir sie ich er es kein keine mehr sehr schon wenn dann doch diese dieser dieses diesen ' +
    'les des une dans pour que qui sur par avec est sont pas plus mais ont aux ces cette cet ses son leur leurs elle ils elles nous vous comme tout tous très être avoir fait sans sous aussi entre depuis donc alors ' +
    'los las una unos unas para por con que del como más pero sus este esta estos estas son está han ser fue era muy también entre sobre hasta desde cuando donde sin ese esa ' +
    'gli una uno per con che del della delle dei degli nel nella nei sono non più come anche tra fra alla alle agli questo questa questi queste dal dalla suo sua loro essere stato hanno molto ' +
    'een het van voor met dat dit deze die niet zijn wordt worden werd naar bij ook als maar nog aan door over uit tot zich meer wel kan hebben heeft ' +
    'uma uns umas para por com que dos das como mais mas sua seu suas seus são não foi ser está muito também entre sobre até quando onde sem esse essa este esta nos nas'
).split(/\s+/));

const HAN_KANA = /[぀-ヿ㐀-䶿一-鿿]/;
const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');

/** Unicode-aware words (umlauts, accents, Cyrillic, Greek …); Han/Kana runs become overlapping character pairs. Lower-case, ≥ 3 letters. */
export function tokenize(text) {
    const words = stripTags(text).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
    const out = [];
    for (const raw of words) {
        const w = raw.replace(/^[-'’]+|[-'’]+$/g, '');
        if (HAN_KANA.test(w)) { for (let i = 0; i + 1 < w.length; i++) out.push(w.slice(i, i + 2)); continue; }
        if (w.length < 3 || STOPWORDS.has(w) || FUNCTION_WORDS.has(w) || /^\d+$/.test(w)) continue;
        out.push(w);
    }
    return out;
}

/** Changes whenever what the vector is built from changes (title, tags, summary, text length). Cheap: no text needed. */
export function fingerprintOf(a) {
    return [a.timestamp || '', a.contentWordCount || 0, String(a.summary || '').length, String(a.title || '').length, (a.tags || []).filter(t => !isLanguageTag(t)).join('|')].join(':');
}

/** @param {{title?, tags?, summary?, content?}} fields  @param {object} meta the index entry (for the fingerprint) @param {boolean} full text included */
export function buildEntry(fields, meta, full) {
    const tf = new Map();
    const add = (text, weight) => { for (const t of tokenize(text)) tf.set(t, (tf.get(t) || 0) + weight); };
    add(fields.title, W.title);
    add((fields.tags || []).filter(t => !isLanguageTag(t)).join(' '), W.tags);   // a language mark says nothing about what an article is about
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

/** Pruned, normalised vectors (the `topTerms` strongest after idf) and the inverted index over them. Shared by neighbours() and similarTo(). */
async function vectorsOf(items, { maxDf = MAX_DF, topTerms = TOP_TERMS } = {}, pause = null) {
    const ids = Object.keys(items).sort();
    const N = ids.length;
    const df = new Map();
    for (const id of ids) for (const [t] of items[id].t) df.set(t, (df.get(t) || 0) + 1);
    const idf = new Map();
    df.forEach((n, t) => { if (n / N <= maxDf || N < 8) idf.set(t, Math.log((N + 1) / (n + 1)) + 1); });
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
    return { ids, vec, post };
}

const rank = (acc, k, minScore) => [...acc.entries()].filter(([, s]) => s >= minScore).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, k)
    .map(([o, s]) => [o, Math.round(s * 1000) / 1000]);

/**
 * Most similar articles for every article.
 * @param {Object<string,{t:Array}>} items id → entry
 * @param {{k?, minScore?, maxDf?, topTerms?}} opts
 * @param {() => Promise<void>} [pause] awaited every 100 articles, so a long run can hand the thread back
 * @returns {Promise<Object<string, Array<[string, number]>>>} id → [[otherId, score], …] best first
 */
export async function neighbours(items, { k = NEIGHBOURS, minScore = MIN_SCORE, maxDf = MAX_DF, topTerms = TOP_TERMS } = {}, pause = null) {
    const { ids, vec, post } = await vectorsOf(items, { maxDf, topTerms }, pause);
    const out = {};
    let n = 0;
    for (const id of ids) {
        const acc = new Map();
        for (const [t, w] of vec.get(id)) for (const [o, w2] of post.get(t)) if (o !== id) acc.set(o, (acc.get(o) || 0) + w * w2);
        const best = rank(acc, k, minScore);
        if (best.length) out[id] = best;
        if (pause && ++n % 100 === 0) await pause();
    }
    return out;
}

/** The articles most like ONE article (for a tool call: no need to compute everybody's neighbours). [[otherId, score], …] best first. */
export async function similarTo(items, id, { k = 8, minScore = 0.12, maxDf = MAX_DF, topTerms = TOP_TERMS } = {}) {
    if (!items[id]) return [];
    const { vec, post } = await vectorsOf(items, { maxDf, topTerms });
    const acc = new Map();
    for (const [t, w] of vec.get(id) || []) for (const [o, w2] of post.get(t) || []) if (o !== id) acc.set(o, (acc.get(o) || 0) + w * w2);
    return rank(acc, k, minScore);
}
