// graphMaturity.js — how far you got with an article. No imports on purpose: the export code that uses it is bundled into a background
// worker by a small bundler that only understands named imports (scripts/build.js), so this must not pull in anything else.
/**
 * How far an article has been worked: 'seed' (saved), 'growing' (opened, or you annotated it), 'evergreen' (opened, summarised and
 * you added highlights or notes). `notes` = your highlights + notes on it (0 when unknown).
 */
export function maturityOf(a, notes = 0) {
    if (!a) return 'seed';
    const score = (a.lastOpened ? 1 : 0) + (String(a.summary || '').trim() ? 1 : 0) + (notes > 0 ? 1 : 0);
    return score >= 3 ? 'evergreen' : score >= 1 && (a.lastOpened || notes > 0) ? 'growing' : 'seed';
}
