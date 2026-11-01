// modules/syncPassphrase.js
// Passphrases for encrypted places: a suggestion of random words, one canonical spelling, and a plain check of a passphrase someone typed.
// Pure (the random source is injectable), so it runs in the popup, the tests and the phone's test vector.
import { WORDS } from './syncWordlist.js';

const SET = new Set(WORDS);
export const SUGGESTED_WORDS = 6;      // 6 x 11 bits = 66 bits: out of reach for an offline guess even at 600,000 key-derivation rounds
export const MIN_LENGTH = 12;          // for a passphrase someone makes up

/** Random words from the list, drawn uniformly (2,048 divides 65,536, so there is no bias). */
export function suggest(n = SUGGESTED_WORDS, random = (a) => globalThis.crypto.getRandomValues(a)) {
    const out = [];
    const buf = new Uint16Array(n);
    random(buf);
    for (const v of buf) out.push(WORDS[v % WORDS.length]);
    return out.join(' ');
}

/**
 * The one spelling every device derives the key from. A phrase made only of list words (four or more, separated by spaces, dashes or
 * commas, any capitalisation) becomes lower-case words with single spaces, so "Orbit-Lemon  TUNNEL …" opens what "orbit lemon tunnel …"
 * created. Anything else is used exactly as typed.
 */
export function canonicalPassphrase(input) {
    const text = String(input == null ? '' : input);
    const parts = text.trim().toLowerCase().split(/[\s,;-]+/).filter(Boolean);
    return parts.length >= 4 && parts.every((w) => SET.has(w)) ? parts.join(' ') : text;
}

/**
 * The suggested words in one piece, joined by dashes ("orbit-lemon-tunnel-…"): one "word" that a double click selects whole and that survives
 * .env files, shells, URLs and chat apps. Joining accepts it in every spelling (canonicalPassphrase), so spaces and dashes open the same place.
 * Anything that is not a list-word phrase (an own passphrase) is returned as typed.
 */
export function inOnePiece(input) {
    return isSuggestedWords(input) ? canonicalPassphrase(input).split(' ').join('-') : String(input == null ? '' : input);
}

/** True for a phrase made only of list words (four or more): the suggested kind, which this device may keep to show again. */
export function isSuggestedWords(input) {
    const text = String(input == null ? '' : input);
    const parts = text.trim().toLowerCase().split(/[\s,;-]+/).filter(Boolean);
    return parts.length >= 4 && parts.every((w) => SET.has(w));
}

const COMMON = ['password', 'passphrase', 'qwertz', 'qwerty', '123456', 'letmein', 'iloveyou', 'correct horse battery staple', 'aish', 'summary'];

/** '' when the passphrase is good enough, else a sentence the screen can show. */
export function passphraseProblem(p) {
    const canon = canonicalPassphrase(p);
    const words = canon.split(' ');
    if (words.length >= 5 && words.every((w) => SET.has(w))) return '';
    if (String(p || '').length < MIN_LENGTH) return `Choose a passphrase of at least ${MIN_LENGTH} characters, or use the suggested words.`;
    const flat = String(p).toLowerCase().replace(/[^a-z0-9]/g, '');
    const stem = flat.replace(/[0-9]+$/, '');
    if (COMMON.some((c) => { const k = c.replace(/[^a-z0-9]/g, ''); return flat === k || stem === k; }) || new Set(flat).size < 5) return 'That passphrase is too easy to guess. Use the suggested words or something longer.';
    return '';
}

/**
 * 'weak' | 'fine' | 'strong' for the hint under the field. Cautious on purpose: only random words from the list or a long mixed passphrase count as
 * strong, because a typed phrase made of ordinary words is easier to guess than its length suggests.
 */
export function strengthOf(p) {
    if (passphraseProblem(p)) return 'weak';
    const canon = canonicalPassphrase(p).split(' ');
    if (canon.length >= 6 && canon.every((w) => SET.has(w))) return 'strong';
    const s = String(p), classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9\s]/].filter((r) => r.test(s)).length;
    return s.length >= 20 && classes >= 3 ? 'strong' : 'fine';
}
