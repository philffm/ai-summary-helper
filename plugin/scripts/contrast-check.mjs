#!/usr/bin/env node
// Contrast check for the text tokens against their surfaces (light + dark), WCAG AA 4.5:1. Exits 1 on regressions.
// Glass surfaces are translucent, so each is composited over the page background first.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const css = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/styles.css'), 'utf8');
const block = (re) => { const m = css.match(re); if (!m) throw new Error('block not found: ' + re); let i = m.index + m[0].length, d = 1, s = i; while (d && i < css.length) { if (css[i] === '{') d++; else if (css[i] === '}') d--; i++; } return css.slice(s, i - 1); };
const vars = (b) => Object.fromEntries([...b.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
const light = vars(block(/:root,\s*:root\[data-theme='light'\]\s*\{/));
const dark = { ...light, ...vars(block(/:root\[data-theme='dark'\]\s*\{/)) };

const parse = (v) => {
    let m = v.match(/^#([0-9a-f]{3,8})$/i);
    if (m) { let h = m[1]; if (h.length <= 4) h = [...h].map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).concat(h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1); }
    m = v.match(/^rgba?\(([^)]+)\)$/);
    if (m) { const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    return null;
};
const over = (fg, bg) => [0, 1, 2].map(i => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
const lum = (c) => { const f = c.slice(0, 3).map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const TEXT = ['--text-primary', '--text-secondary', '--text-muted'];
const SURFACES = ['--bg-page', '--glass-base', '--glass-card', '--glass-input'];
let failed = 0;
for (const [theme, t] of [['light', light], ['dark', dark]]) {
    const page = parse(t['--bg-page']);
    for (const s of SURFACES) {
        const sv = parse(t[s]); if (!sv || !page) throw new Error(`cannot parse ${s} in ${theme}`);
        const bg = s === '--bg-page' ? page : over(sv, page);
        for (const k of TEXT) {
            const fg = parse(t[k]); if (!fg) throw new Error(`cannot parse ${k} in ${theme}`);
            const r = ratio(over(fg, bg), bg);
            const ok = r >= 4.5;
            if (!ok) failed++;
            console.log(`${ok ? 'ok  ' : 'FAIL'} ${theme} ${k} on ${s}: ${r.toFixed(2)}:1`);
        }
    }
}
if (failed) { console.error(`${failed} pair(s) below 4.5:1`); process.exit(1); }
