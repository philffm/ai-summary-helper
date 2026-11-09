// feedI18n.js — UI strings for the Feeds screens.
// The English text IS the lookup key: T('Mark read') looks up the message
// `f_mark_read_<hash>` in _locales/<lang>/messages.json and falls back to the
// English text itself. `scripts/feed-i18n.mjs` extracts every T()/TN()/TU()/N_()
// literal, checks coverage per locale and flags over-long translations.
import { t, resolveLocale } from './i18n.js';
import { i18nKey } from './i18nKey.js';

// The key for an English string (FNV-1a slug, see i18nKey.js — shared with the content scripts).
export function keyOf(en) { return i18nKey(en); }

const fill = (s, vars) => vars ? s.replace(/\{([a-z]+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;

export function T(en, vars) {
    const k = keyOf(en);
    const got = t(k);
    return fill(got === k ? en : got, vars);
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
