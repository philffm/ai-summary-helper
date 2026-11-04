// modules/breakpoints.js — layout breakpoints for JS, from the design tokens (ADR 0005).
// The values live in design-system/tokens/app/base.json (semantic.breakpoint) and are emitted as --bp-* on :root.
// CSS media queries cannot read custom properties, so code that decides layout reads them here. FALLBACK is used where the
// stylesheet is not loaded (tests, offscreen documents); design-system/lint.mjs fails if it drifts from the tokens.
export const FALLBACK = {
    'narrow': 420,
    'toolbar-compact': 440,
    'popup': 480,
    'split': 720,
    'card-wide': 760,
    'toolbar-labels': 780,
    'settings-wide': 900,
    'split-3': 1100,
};
const cache = {};
/** Width in px of breakpoint `name` (token --bp-<name>). */
export function bp(name) {
    if (cache[name] != null) return cache[name];
    let v = NaN;
    try { v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bp-' + name)); } catch (_) { /* no DOM */ }
    if (!Number.isFinite(v)) return FALLBACK[name];   // not cached: the stylesheet may still arrive
    return (cache[name] = v);
}
