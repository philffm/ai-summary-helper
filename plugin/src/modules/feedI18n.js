// feedI18n.js — UI strings for the Feeds screens.
// The English text IS the lookup key: T('Mark read') looks up the message
// `f_mark_read_<hash>` in _locales/<lang>/messages.json and falls back to the
// English text itself. `scripts/feed-i18n.mjs` extracts every T()/TN()/TU()/N_()
// literal, checks coverage per locale and flags over-long translations.
import { t, resolveLocale, supportedLocaleFor, loadDictionary } from './i18n.js';

// FNV-1a, 4 hex chars: keeps keys unique even when two texts share a slug.
export function keyOf(en) {
    let h = 0x811c9dc5;
    for (let i = 0; i < en.length; i++) { h ^= en.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    const slug = en.toLowerCase().replace(/\{[a-z]+\}/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 28);
    return `f_${slug}_${(h >>> 0).toString(16).slice(-4)}`;
}

const fill = (s, vars) => vars ? s.replace(/\{([a-z]+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;

export function T(en, vars) {
    const k = keyOf(en);
    const got = t(k);
    return fill(got === k ? en : got, vars);
}
/**
 * T() in another language than the app's (e.g. what the voice says in the SUMMARY language).
 * Resolves with `{ text, locale }`; locale is '' when that language has no translation here, and the text is then the
 * app-language one — the caller picks a matching voice language.
 */
export async function TIn(code, en, vars) {
    const loc = supportedLocaleFor(code);
    if (!loc) return { text: T(en, vars), locale: '' };
    const dict = await loadDictionary(loc);
    const m = dict[keyOf(en)];
    return { text: fill((m && m.message) || en, vars), locale: loc };
}
// Count-dependent text: two English forms; locales without a plural split just give both keys the same text.
export const TN = (n, one, other, vars) => T(n === 1 ? one : other, { n, ...vars });
// Section captions (DATE, MOOD …): translate in natural case, upper-case for display.
export const TU = (en, vars) => T(en, vars).toLocaleUpperCase(locale());
// Marker for strings defined at module load (before the dictionary is loaded); render with T().
export const N_ = (en) => en;

// Date/number formatting follows the UI language, not the browser's.
export function locale() {
    const l = typeof document !== 'undefined' && document.documentElement && document.documentElement.lang;
    return l || undefined;
}

// The UI language as a _locales folder code ('de', 'pt_PT', …) — what topicConcepts.js labels are keyed by.
export const uiLocale = () => resolveLocale(locale());
