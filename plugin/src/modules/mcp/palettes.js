// palettes.js — the colour schemes of the app (Settings › Appearance › Color scheme) as plain values for AI apps that build something
// from the user's library: the report takes the colours the user has chosen, and the app can offer the other ones afterwards.
// Hex values are written without "#" on purpose: the white-label build swaps the default brand's hex colours in every source file,
// and these tables must stay as they are (each scheme keeps its own colours in every build). Source of truth: the schemes in styles.css.

const NEUTRAL = { light: { card: 'ffffff', text: '0f172a', text2: '334155', muted: '566274', outline: 'rgba(100,116,139,0.25)' }, dark: { text: 'e8edf5', text2: 'b8c4d4', muted: '94a3b8', outline: 'rgba(148,163,184,0.25)' } };

export const PALETTES = {
    kaivo: { name: 'Kaivo', light: { bg: 'faf8ff', accent: '0F6675', accent2: '1C7F8E', link: '0B525E', tint: 'E8F6F7' }, dark: { bg: '0b0e14', card: '111D20', accent: '3FA6B3', accent2: '1C7F8E', link: '7CCBD4' } },
    aish: { name: 'Aish', light: { bg: 'faf8ff', accent: '2563eb', accent2: '3b82f6', link: '1d4ed8', tint: 'eff6ff' }, dark: { bg: '0b0e14', card: '141923', accent: '60a5fa', accent2: '3b82f6', link: '93c5fd' } },
    viola: { name: 'Viola', light: { bg: 'FBF9FF', accent: '6233E8', accent2: '7445F8', link: '4F24C9', tint: 'F3EFFF' }, dark: { bg: '0b0e14', card: '141923', accent: '8B68FF', accent2: '7445F8', link: 'B49CFF' } },
    graphite: { name: 'Graphite', light: { bg: 'F7F7F6', accent: '46443F', accent2: '68655F', link: '35332F', tint: 'F5F5F4' }, dark: { bg: '10100F', card: '181816', accent: '8C8982', accent2: '68655F', link: 'B9B6B0' } },
};
export const SCHEME_IDS = Object.keys(PALETTES);

const hex = (v) => (/^[0-9a-f]{6}$/i.test(v) ? '#' + v : v);

/** One palette for one brightness, with every colour spelled out ("#rrggbb"). */
export function paletteFor(scheme, mode = 'light') {
    const p = PALETTES[scheme] || PALETTES.kaivo, m = mode === 'dark' ? 'dark' : 'light', n = NEUTRAL[m];
    const o = { ...NEUTRAL.light, ...n, ...p[m] }; const out = {};
    for (const k of Object.keys(o)) out[k] = hex(o[k]);
    return out;
}

/** The :root block(s) for a scheme: `mode` 'light' | 'dark' fixes it, 'system' follows prefers-color-scheme. */
export function cssFor(scheme, mode = 'system') {
    const vars = (p, pad) => `${pad}--bg: ${p.bg}; --card: ${p.card}; --text: ${p.text}; --text-2: ${p.text2}; --muted: ${p.muted};\n${pad}--accent: ${p.accent}; --accent-2: ${p.accent2}; --link: ${p.link}; --outline: ${p.outline};`;
    const light = paletteFor(scheme, 'light'), dark = paletteFor(scheme, 'dark');
    if (mode === 'dark') return `:root {\n${vars(dark, '  ')}\n}`;
    if (mode === 'light') return `:root {\n${vars(light, '  ')}\n}`;
    return `:root {\n${vars(light, '  ')}\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n${vars(dark, '    ')}\n  }\n}`;
}

/** What the user has set: the scheme in use (`default` = this build's own brand colours) and the brightness. */
export function lookFrom(appearance = {}, defaultScheme = 'kaivo') {
    let s = appearance.colorScheme; if (s === 'blue') s = 'aish';
    const scheme = PALETTES[s] ? s : (PALETTES[defaultScheme] ? defaultScheme : 'kaivo');
    const mode = appearance.theme === 'dark' || appearance.theme === 'light' ? appearance.theme : 'system';
    return { scheme, mode };
}
