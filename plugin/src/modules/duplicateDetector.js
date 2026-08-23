// duplicateDetector.js
// Tiered duplicate check for the save flow:
//   Tier 1 - normalized URL exact match          -> O(1) map lookup
//   Tier 2 - title similarity (Dice on word sets) -> cheap, tiny strings
//   Tier 3 - TF-IDF cosine similarity              -> only for the few
//            candidates that survive Tier 1/2, reusing the same index
//            localSearch.js already builds for search/recommendations.
//
// Nothing here re-reads full article content unless a cheap signal
// already suggests a likely match, so checking a new save against a
// large archive stays fast.

import { normalizeUrl, normalizeTitle, tokenize, diceCoefficient } from './textUtils.js';
import { vectorizeText, cosineSim } from './localSearch.js';

const TITLE_CANDIDATE_THRESHOLD = 0.45; // Dice score to even consider Tier 3
const CONTENT_DUPLICATE_THRESHOLD = 0.80; // cosine similarity to call it a duplicate
const NEAR_IDENTICAL_THRESHOLD = 0.95;    // cosine similarity regardless of title/URL

/**
 * @param {object} candidate - { url, title, summary, content } of the article being saved
 * @param {Array<object>} existingArticles
 * @param {object} [index] - optional prebuilt localSearch index (reused, not rebuilt)
 * @returns {{ isDuplicate: boolean, reason?: string, match?: object, score?: number }}
 */
export function findDuplicate(candidate, existingArticles, index = null) {
    if (!existingArticles || existingArticles.length === 0) {
        return { isDuplicate: false };
    }

    // --- Tier 1: exact normalized URL -------------------------------------
    const candidateUrl = normalizeUrl(candidate.url);
    if (candidateUrl) {
        const urlMatch = existingArticles.find(a => normalizeUrl(a.url) === candidateUrl);
        if (urlMatch) {
            return { isDuplicate: true, reason: 'url', match: urlMatch, score: 1 };
        }
    }

    // --- Tier 2: title similarity -> shortlist of candidates --------------
    const candidateTitleWords = tokenize(normalizeTitle(candidate.title), { minLength: 2 });
    const candidates = [];
    for (const article of existingArticles) {
        const words = tokenize(normalizeTitle(article.title), { minLength: 2 });
        const dice = diceCoefficient(candidateTitleWords, words);
        if (dice >= TITLE_CANDIDATE_THRESHOLD) candidates.push({ article, dice });
    }

    // --- Tier 3: content similarity, only for shortlisted candidates ------
    if (candidates.length > 0 && index) {
        const candidateText = [candidate.title, candidate.summary].filter(Boolean).join(' ');
        const candidateVec = vectorizeText(index, candidateText);
        let best = null;
        for (const { article } of candidates) {
            const docVec = index.vectors.get(article.timestamp);
            if (!docVec) continue;
            const sim = cosineSim(candidateVec, docVec);
            if (!best || sim > best.score) best = { article, score: sim };
        }
        if (best && best.score >= CONTENT_DUPLICATE_THRESHOLD) {
            return { isDuplicate: true, reason: 'content', match: best.article, score: best.score };
        }
    }

    // --- Fallback: near-identical content even with an unrelated title ----
    // (e.g. same article re-saved from a syndicated URL with a different
    // headline). Only worth the full-index scan if nothing else matched.
    if (index) {
        const candidateText = [candidate.title, candidate.summary].filter(Boolean).join(' ');
        const candidateVec = vectorizeText(index, candidateText);
        let best = null;
        for (const article of existingArticles) {
            const docVec = index.vectors.get(article.timestamp);
            if (!docVec) continue;
            const sim = cosineSim(candidateVec, docVec);
            if (!best || sim > best.score) best = { article, score: sim };
        }
        if (best && best.score >= NEAR_IDENTICAL_THRESHOLD) {
            return { isDuplicate: true, reason: 'near-identical', match: best.article, score: best.score };
        }
    }

    return { isDuplicate: false };
}
