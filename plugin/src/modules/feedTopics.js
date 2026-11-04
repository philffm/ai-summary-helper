// feedTopics.js — which feed items are about the same thing, for the Feeds graph: from the headline and the teaser, not from the source.
// Pure functions: no DOM, no chrome.*, no network. Same input, same result (ties are broken by term).
//
// The archive graph clusters by tags. A feed item has none of its own except its AI category, and the old graph gave it the
// source's name and tags instead, so the graph clustered by feed ("everything from heise"). Here every item gets topic words
// worked out from its own headline (weighted higher) and description, shared with at least one other item; the words of a
// source's own name are left out, so a feed's brand is no topic. Items on the same story from different feeds meet at the
// same words.
import { tokenize } from './graphSimilarity.js';

export const PER_ITEM = 3;         // topic words per item
export const MIN_DF = 2;           // a word on one item only ties nothing together
export const MAX_DF_SHARE = 0.2;   // a word on more than this share of the items says nothing (never fewer than 3 items allowed)
const W_TITLE = 3, W_TEXT = 1;

/**
 * @param {Array<{timestamp:number,title?:string,summary?:string,description?:string}>} articles
 * @param {{ skip?: Iterable<string> }} [opts] skip: words that are no topic (source names)
 * @returns {Map<number,string[]>} timestamp → up to PER_ITEM topic words, strongest first
 */
export function topicWords(articles, { skip = [] } = {}) {
    const stop = new Set();
    for (const s of skip) for (const w of tokenize(s)) stop.add(w);
    const docs = [], df = new Map();
    for (const a of articles) {
        const tf = new Map();
        const add = (text, weight) => { for (const w of tokenize(text)) if (!stop.has(w)) tf.set(w, (tf.get(w) || 0) + weight); };
        add(a.title, W_TITLE);
        add((a.summary || '') + ' ' + (a.description || ''), W_TEXT);
        docs.push([a.timestamp, tf]);
        for (const w of tf.keys()) df.set(w, (df.get(w) || 0) + 1);
    }
    const n = docs.length, maxDf = Math.max(3, Math.floor(n * MAX_DF_SHARE));
    const out = new Map();
    for (const [ts, tf] of docs) {
        const scored = [];
        for (const [w, c] of tf) {
            const d = df.get(w);
            if (d < MIN_DF || d > maxDf) continue;
            scored.push([w, c * Math.log(1 + n / d)]);
        }
        scored.sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
        out.set(ts, scored.slice(0, PER_ITEM).map(([w]) => w));
    }
    return out;
}
