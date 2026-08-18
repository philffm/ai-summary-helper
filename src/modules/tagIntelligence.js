// tagIntelligence.js
// Two jobs:
//   1. Normalize: fold obvious variants ("ML" / "Machine Learning" / "machine-learning")
//      into one canonical tag so search, the analytics report, and the
//      archive graph all group them together instead of splintering.
//   2. Enrich: when the AI-generated tag list is thin, suggest extra tags
//      from the article's own top TF-IDF terms — reuses the index
//      localSearch.js already built, no re-analysis.

import { levenshtein } from './textUtils.js';
import { topTermsFor } from './localSearch.js';

// Small curated alias table for the abbreviations/variants that come up
// constantly in tech/news reading archives. Extend freely — this is data,
// not logic.
const CANONICAL_ALIASES = {
    'ml': 'machine learning',
    'ai': 'artificial intelligence',
    'genai': 'generative ai',
    'gen ai': 'generative ai',
    'llm': 'large language models',
    'llms': 'large language models',
    'ux': 'ux design',
    'ui': 'ui design',
    'js': 'javascript',
    'ts': 'typescript',
    'crypto': 'cryptocurrency',
    'vc': 'venture capital'
};

const FUZZY_MERGE_THRESHOLD = 2; // max edit distance to treat two tags as the same

function basicNormalize(tag) {
    return (tag || '')
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ');
}

/** Normalize a single tag against the alias table (does not need the archive). */
export function normalizeTag(tag) {
    const base = basicNormalize(tag);
    if (!base) return '';
    if (CANONICAL_ALIASES[base]) return CANONICAL_ALIASES[base];
    return base;
}

/**
 * Build a canonical-tag map across the whole archive: fuzzy-merges tags
 * that are near-identical (typos, singular/plural, punctuation) so the
 * most frequently used spelling wins as the display form.
 * @param {Array<object>} articles
 * @returns {Map<string, string>} rawTagLowercase -> canonicalDisplayTag
 */
export function buildCanonicalTagMap(articles) {
    const counts = new Map(); // normalizedBase -> Map(displayForm -> count)
    for (const article of articles) {
        for (const raw of article.tags || []) {
            const base = normalizeTag(raw);
            if (!base) continue;
            if (!counts.has(base)) counts.set(base, new Map());
            const displayMap = counts.get(base);
            displayMap.set(raw.trim(), (displayMap.get(raw.trim()) || 0) + 1);
        }
    }

    // Fuzzy-merge near-identical bases (e.g. "podcast" vs "podcasts") by
    // clustering with a cheap edit-distance check. O(k^2) over the unique
    // tag count, which for a personal archive's tag vocabulary is tiny.
    const bases = Array.from(counts.keys());
    const parent = new Map(bases.map(b => [b, b])); // union-find
    const find = x => (parent.get(x) === x ? x : find(parent.get(x)));
    const union = (x, y) => { parent.set(find(x), find(y)); };

    for (let i = 0; i < bases.length; i++) {
        for (let j = i + 1; j < bases.length; j++) {
            const a = bases[i], b = bases[j];
            if (Math.abs(a.length - b.length) > FUZZY_MERGE_THRESHOLD) continue;
            if (levenshtein(a, b) <= FUZZY_MERGE_THRESHOLD) union(a, b);
        }
    }

    // For each cluster, pick the most-used display form as canonical.
    const clusterTotals = new Map(); // root -> Map(displayForm -> count)
    for (const base of bases) {
        const root = find(base);
        if (!clusterTotals.has(root)) clusterTotals.set(root, new Map());
        const target = clusterTotals.get(root);
        for (const [display, count] of counts.get(base).entries()) {
            target.set(display, (target.get(display) || 0) + count);
        }
    }

    const rootCanonical = new Map();
    for (const [root, displayMap] of clusterTotals.entries()) {
        const best = Array.from(displayMap.entries()).sort((a, b) => b[1] - a[1])[0];
        rootCanonical.set(root, best[0]);
    }

    const result = new Map();
    for (const base of bases) {
        result.set(base, rootCanonical.get(find(base)));
    }
    return result;
}

/** Apply the canonical map to one article's tag list, deduping the result. */
export function applyCanonicalTags(tags, canonicalMap) {
    const seen = new Set();
    const out = [];
    for (const raw of tags || []) {
        const base = normalizeTag(raw);
        const canonical = canonicalMap.get(base) || raw.trim();
        const key = canonical.toLowerCase();
        if (!seen.has(key)) { seen.add(key); out.push(canonical); }
    }
    return out;
}

/**
 * Suggest extra tags for an article from its own top TF-IDF terms —
 * useful when the AI returned only 1-2 tags, or none (e.g. a Ollama model
 * that ignored the tag instruction). Reuses the prebuilt search index.
 */
export function suggestTags(index, article, { maxSuggestions = 3 } = {}) {
    const existing = new Set((article.tags || []).map(t => t.toLowerCase()));
    const terms = topTermsFor(index, article.timestamp, 10);
    const suggestions = [];
    for (const term of terms) {
        if (existing.has(term)) continue;
        if (term.length < 4) continue;
        suggestions.push(term);
        if (suggestions.length >= maxSuggestions) break;
    }
    return suggestions;
}
