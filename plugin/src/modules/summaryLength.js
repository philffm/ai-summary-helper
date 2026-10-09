// summaryLength.js — how long a summary should be.
// A fixed word count is too long for a 300-word post and too short for a 6,000-word essay, so the
// default is "auto": the target grows with the square root of the article length. The popup stores a
// setting, the content script turns it into a number once it knows how long the article is.

export const DEFAULT_WORDS = 200;
export const MIN_WORDS = 20;        // lowest value the number field accepts
export const MAX_WORDS = 2000;      // highest value the number field accepts
export const SLIDER_MIN = 50;       // the slider covers the everyday range; the number field goes beyond it
export const SLIDER_MAX = 1000;
export const BIAS_FACTOR = { short: 0.7, standard: 1, long: 1.4 };
export const BIASES = Object.keys(BIAS_FACTOR);

/** Keep a user-entered length inside the supported range. Non-numbers fall back to the default. */
export function clampLength(n) {
    const v = Math.round(Number(n));
    if (!Number.isFinite(v) || v <= 0) return DEFAULT_WORDS;
    return Math.min(MAX_WORDS, Math.max(MIN_WORDS, v));
}

/**
 * Target summary length for an article of `words` words.
 *   ~300 words → 70,  1,000 → 130,  2,500 → 200,  5,000 → 280,  10,000 → 400  (bias "standard")
 * Never more than half the source, so a short page is not padded; unknown length (0) → the default.
 */
export function autoSummaryLength(words, bias = 'standard') {
    const w = Math.max(0, Math.floor(Number(words) || 0));
    if (!w) return DEFAULT_WORDS;
    const factor = BIAS_FACTOR[bias] || 1;
    const wanted = Math.max(40, 4 * Math.sqrt(w)) * factor;
    const n = Math.min(wanted, Math.floor(w / 2), 800);
    const step = n >= 50 ? 10 : 5;
    return Math.max(10, Math.round(n / step) * step);
}

/** The stored setting as the one value that travels in messages: a number, or 'auto' / 'auto:short' / 'auto:long'. */
export function lengthSpec({ mode, value, bias } = {}) {
    if (mode === 'custom') return clampLength(value);
    return bias && bias !== 'standard' && BIAS_FACTOR[bias] ? 'auto:' + bias : 'auto';
}

/** Turn a message value (see lengthSpec) into a word count for an article of `words` words. */
export function resolveSummaryLength(spec, words) {
    if (typeof spec === 'string' && spec.startsWith('auto')) return autoSummaryLength(words, spec.split(':')[1] || 'standard');
    return clampLength(spec);
}

/** Read the setting from the `chrome.storage.local` result for the three length keys. */
export function readLengthSetting(local, SK) {
    const value = local[SK.summaryLength];
    const stored = local[SK.summaryLengthMode];
    const mode = stored === 'auto' || stored === 'custom' ? stored : (value ? 'custom' : 'auto');
    const bias = BIASES.includes(local[SK.summaryLengthBias]) ? local[SK.summaryLengthBias] : 'standard';
    return { mode, value: clampLength(value || DEFAULT_WORDS), bias };
}

/** The message value for the current setting (reads storage). */
export async function currentLengthSpec(SK) {
    const local = await chrome.storage.local.get([SK.summaryLength, SK.summaryLengthMode, SK.summaryLengthBias]);
    return lengthSpec(readLengthSetting(local, SK));
}
