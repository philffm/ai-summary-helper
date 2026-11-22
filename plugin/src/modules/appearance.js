// appearance.js — the three axes of the look (brightness, design, colour) and how stored settings map onto them. Pure and small: the
// in-page tools of the content script use it too. See a11y.js for applying it.
// Appearance has three independent axes (Settings › Appearance):
//   brightness   theme   'system' | 'light' | 'dark'                  → html[data-theme]  (system = no attribute: the browser decides)
//   design       design  'standard' | 'postil' | 'contrast'           → html[data-design] (standard = no attribute)
//   colour       colorScheme 'default' | 'kaivo' | 'aish' | 'viola'    → html[data-scheme] (default = this build's own brand colours)
export const SCHEMES = ['kaivo', 'aish', 'viola'];
export const DESIGNS = ['standard', 'postil', 'contrast'];

/**
 * Any stored appearance → { theme, design, colorScheme } on the three axes. Older versions kept it differently, and that is read here
 * (nothing is rewritten in storage): theme "contrast" was the High contrast look, scheme "postil" the Postil look, scheme "blue" Aish.
 */
export function normalizeAppearance(cfg = {}) {
    let theme = cfg.theme, design = DESIGNS.includes(cfg.design) ? cfg.design : '', scheme = cfg.colorScheme;
    if (theme === 'contrast') { theme = 'system'; design = design || 'contrast'; }
    if (scheme === 'postil') { scheme = 'default'; design = design || 'postil'; }
    if (scheme === 'blue') scheme = 'aish';
    return { theme: theme === 'dark' || theme === 'light' ? theme : 'system', design: design || 'standard', colorScheme: SCHEMES.includes(scheme) ? scheme : 'default' };
}

/** The attribute values for a host element (html, or the shadow host of the in-page tools): '' = no attribute. */
export function appearanceAttrs(cfg = {}) {
    const n = normalizeAppearance(cfg);
    return { theme: n.theme === 'system' ? '' : n.theme, design: n.design === 'standard' ? '' : n.design, scheme: n.colorScheme === 'default' ? '' : n.colorScheme };
}

