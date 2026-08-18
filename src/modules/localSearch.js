// localSearch.js
// On-device TF-IDF index + tiered ranked search + similarity lookup.
//
// Design goals (resource-conscious, per the brief):
//  1. Cheap fields first. Title/tag substring matching is near-free (tiny
//     strings) and runs synchronously on every keystroke, same as today.
//  2. The index — not raw text scanning — is what makes it affordable to
//     also search summary/content. It's built ONCE per archive change,
//     not re-scanned per keystroke.
//  3. One index, three consumers: ranked search, "similar articles", and
//     tag-suggestion scoring all read the same structure. No duplicate
//     indexing work anywhere in the extension.
//
// Complexity: build is O(total tokens in archive) — done at most once per
// popup session (plus incremental touch-ups). A query is O(query terms x
// avg postings list length), which for a handful of query words against a
// personal archive (tens to low thousands of articles) is sub-millisecond.

import { tokenize, termFrequencies } from './textUtils.js';

// Field weighting: repeat a field's tokens N times before counting term
// frequency, so a title hit naturally outweighs a body hit without needing
// a separate per-field index or multi-vector cosine math.
const FIELD_WEIGHTS = { title: 4, tags: 3, description: 2, summary: 1, content: 1 };

function articleFields(article) {
    return {
        title: article.title || '',
        tags: (article.tags || []).join(' '),
        description: article.description || '',
        summary: article.summary || '',
        // Cap content contribution — long articles shouldn't dominate the
        // index just by being wordy, and it keeps token counts (and thus
        // memory/build time) bounded per document.
        content: (article.content || article.html || article.text || '').slice(0, 4000)
    };
}

function weightedTokens(article) {
    const fields = articleFields(article);
    const tokens = [];
    for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
        const fieldTokens = tokenize(fields[field]);
        for (let i = 0; i < weight; i++) tokens.push(...fieldTokens);
    }
    return tokens;
}

/**
 * Build a fresh TF-IDF index from an article array.
 * @param {Array<object>} articles - must each have a unique `timestamp`
 * @returns {object} index — pass to search()/similarTo()/vectorize()
 */
export function buildIndex(articles) {
    const docFreq = new Map();      // term -> number of docs containing it
    const docVectors = new Map();   // timestamp -> Map(term -> raw tf)
    const docTokenCount = new Map(); // timestamp -> total weighted tokens (for norm)

    for (const article of articles) {
        const id = article.timestamp;
        if (id == null) continue;
        const tokens = weightedTokens(article);
        const tf = termFrequencies(tokens);
        docVectors.set(id, tf);
        docTokenCount.set(id, tokens.length || 1);
        for (const term of tf.keys()) {
            docFreq.set(term, (docFreq.get(term) || 0) + 1);
        }
    }

    const N = Math.max(1, docVectors.size);
    const idf = new Map();
    for (const [term, df] of docFreq.entries()) {
        // Smoothed idf — never zero/negative even if a term is in every doc.
        idf.set(term, Math.log((N + 1) / (df + 1)) + 1);
    }

    // Precompute normalized TF-IDF vectors (unit length) so similarity is
    // a plain dot product at query time — no sqrt/division per comparison.
    const normalizedVectors = new Map();
    for (const [id, tf] of docVectors.entries()) {
        const totalTokens = docTokenCount.get(id);
        const vec = new Map();
        let sumSquares = 0;
        for (const [term, count] of tf.entries()) {
            const weight = (count / totalTokens) * (idf.get(term) || 0);
            vec.set(term, weight);
            sumSquares += weight * weight;
        }
        const norm = Math.sqrt(sumSquares) || 1;
        for (const [term, w] of vec.entries()) vec.set(term, w / norm);
        normalizedVectors.set(id, vec);
    }

    return { idf, vectors: normalizedVectors, size: docVectors.size, builtAt: Date.now() };
}

/** Vectorize arbitrary text (e.g. a not-yet-saved candidate) against an existing index's idf. */
export function vectorizeText(index, text) {
    const tokens = tokenize(text);
    const tf = termFrequencies(tokens);
    const total = tokens.length || 1;
    const vec = new Map();
    let sumSquares = 0;
    for (const [term, count] of tf.entries()) {
        const weight = (count / total) * (index.idf.get(term) || 0);
        vec.set(term, weight);
        sumSquares += weight * weight;
    }
    const norm = Math.sqrt(sumSquares) || 1;
    for (const [term, w] of vec.entries()) vec.set(term, w / norm);
    return vec;
}

/** Dot product of two pre-normalized sparse vectors = cosine similarity. */
export function cosineSim(vecA, vecB) {
    const [small, big] = vecA.size <= vecB.size ? [vecA, vecB] : [vecB, vecA];
    let sum = 0;
    for (const [term, w] of small.entries()) {
        const other = big.get(term);
        if (other) sum += w * other;
    }
    return sum;
}

/**
 * Tiered ranked search.
 * Tier 1 (always, cheap): substring match on title/tags — same instant
 * behaviour the extension already has.
 * Tier 2 (indexed, still cheap): cosine similarity against the prebuilt
 * TF-IDF index, so summary/content participate without ever being
 * re-scanned character-by-character.
 */
export function search(index, articles, query, { limit = 200 } = {}) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return articles;

    const results = [];
    const queryVec = q.length >= 3 ? vectorizeText(index, q) : null;

    for (const article of articles) {
        const title = (article.title || '').toLowerCase();
        const tags = (article.tags || []).map(t => t.toLowerCase());

        let score = 0;
        if (title.includes(q)) score += 1000 - Math.min(title.indexOf(q), 50);
        if (tags.some(t => t.includes(q))) score += 500;

        // Only pay for the vector lookup if the cheap tier didn't already
        // win decisively AND the index actually has this document.
        if (score < 1000 && queryVec && queryVec.size > 0) {
            const docVec = index.vectors.get(article.timestamp);
            if (docVec) {
                const sim = cosineSim(queryVec, docVec);
                if (sim > 0.03) score += sim * 300;
            }
        }

        if (score > 0) results.push({ article, score });
    }

    return results
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(r => r.article);
}

/**
 * Find the most similar existing articles to a given article, using the
 * same index built for search — no extra indexing pass.
 */
export function similarTo(index, articles, targetArticle, { limit = 5, minScore = 0.12 } = {}) {
    const targetVec = index.vectors.get(targetArticle.timestamp) || vectorizeText(index,
        [targetArticle.title, targetArticle.summary].filter(Boolean).join(' '));

    const scored = [];
    for (const article of articles) {
        if (article.timestamp === targetArticle.timestamp) continue;
        const vec = index.vectors.get(article.timestamp);
        if (!vec) continue;
        const sim = cosineSim(targetVec, vec);
        if (sim >= minScore) scored.push({ article, score: sim });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Top-N highest-weight terms for a document — used by tagIntelligence for tag suggestions. */
export function topTermsFor(index, articleTimestamp, n = 8) {
    const vec = index.vectors.get(articleTimestamp);
    if (!vec) return [];
    return Array.from(vec.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([term]) => term);
}
