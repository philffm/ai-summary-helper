// textUtils.js
// Shared, dependency-free text helpers used by every on-device
// intelligence module (search, tag intelligence, duplicate detection,
// text metrics). Centralized so the stopword list, tokenizer, and HTML
// stripper only exist once instead of being copy-pasted four times.

export const STOPWORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
    'is', 'it', 'its', 'be', 'are', 'was', 'were', 'has', 'have', 'had', 'this', 'that',
    'from', 'by', 'as', 'we', 'our', 'your', 'their', 'he', 'she', 'they', 'i', 'my',
    'you', 'not', 'no', 'so', 'if', 'do', 'did', 'up', 'out', 'all', 'can', 'will',
    'would', 'about', 'more', 'also', 'than', 'then', 'into', 'when', 'which', 'who',
    'been', 'there', 'how', 'what', 'his', 'her', 'these', 'those', 'get',
    'just', 'new', 'one', 'two', 'use', 'used', 'using', 'each', 'may', 'while',
    'them', 'some', 'such', 'other', 'over', 'after', 'before', 'because', 'where'
]);

// Words that flip the polarity of a sentiment token that follows them
// within a couple of positions (see textMetrics.js).
export const NEGATORS = new Set(['not', 'no', 'never', "n't", 'without', 'hardly', 'barely']);

/** Strip HTML tags and collapse whitespace. Cheap regex pass — no DOM parsing. */
export function stripHtml(html) {
    return (html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Tokenize free text into lowercase word tokens.
 * @param {string} text
 * @param {{ minLength?: number, removeStopwords?: boolean }} opts
 * @returns {string[]}
 */
export function tokenize(text, opts = {}) {
    const { minLength = 3, removeStopwords = true } = opts;
    const plain = stripHtml(text).toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ');
    const raw = plain.split(/\s+/).filter(Boolean);
    return raw.filter(w => {
        const cleaned = w.replace(/^[-']+|[-']+$/g, '');
        if (cleaned.length < minLength) return false;
        if (removeStopwords && STOPWORDS.has(cleaned)) return false;
        return true;
    }).map(w => w.replace(/^[-']+|[-']+$/g, ''));
}

/** Build a term -> count map (cheap "bag of words"). */
export function termFrequencies(tokens) {
    const freq = new Map();
    for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
    return freq;
}

/**
 * Rough syllable estimate (vowel-group heuristic). Good enough for
 * Flesch scoring — doesn't need to be linguistically perfect, just
 * consistent.
 */
export function countSyllables(word) {
    const w = word.toLowerCase().replace(/[^a-z]/g, '');
    if (!w) return 0;
    let groups = w.match(/[aeiouy]+/g) || [];
    let count = groups.length;
    if (w.endsWith('e') && !w.endsWith('le') && count > 1) count -= 1;
    return Math.max(1, count);
}

/** Normalize a title for comparison: lowercase, strip punctuation/whitespace noise. */
export function normalizeTitle(title) {
    return (title || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Normalize a URL for duplicate comparison: drop protocol, www, trailing slash, tracking params. */
export function normalizeUrl(url) {
    try {
        const u = new URL(url);
        const dropParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref', 'source'];
        dropParams.forEach(p => u.searchParams.delete(p));
        const host = u.hostname.replace(/^www\./, '');
        const path = u.pathname.replace(/\/+$/, '');
        const qs = u.searchParams.toString();
        return `${host}${path}${qs ? '?' + qs : ''}`.toLowerCase();
    } catch {
        return (url || '').toLowerCase().trim();
    }
}

/** Dice coefficient over word sets — cheap, good for short strings like titles. */
export function diceCoefficient(aWords, bWords) {
    const a = new Set(aWords);
    const b = new Set(bWords);
    if (a.size === 0 || b.size === 0) return 0;
    let overlap = 0;
    for (const w of a) if (b.has(w)) overlap++;
    return (2 * overlap) / (a.size + b.size);
}

/** Jaccard similarity over two sets. */
export function jaccard(aSet, bSet) {
    if (aSet.size === 0 && bSet.size === 0) return 0;
    let inter = 0;
    for (const x of aSet) if (bSet.has(x)) inter++;
    const union = aSet.size + bSet.size - inter;
    return union === 0 ? 0 : inter / union;
}

/** Word-level k-shingles (default trigrams) for near-duplicate content checks. */
export function shingles(tokens, k = 3) {
    const set = new Set();
    if (tokens.length < k) {
        set.add(tokens.join(' '));
        return set;
    }
    for (let i = 0; i <= tokens.length - k; i++) {
        set.add(tokens.slice(i, i + k).join(' '));
    }
    return set;
}

/** Cheap Levenshtein distance, capped early for short strings like tags. */
export function levenshtein(a, b) {
    if (a === b) return 0;
    const al = a.length, bl = b.length;
    if (al === 0) return bl;
    if (bl === 0) return al;
    let prev = new Array(bl + 1);
    for (let j = 0; j <= bl; j++) prev[j] = j;
    for (let i = 1; i <= al; i++) {
        const cur = [i];
        for (let j = 1; j <= bl; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        }
        prev = cur;
    }
    return prev[bl];
}
