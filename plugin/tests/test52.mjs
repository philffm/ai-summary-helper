// Colour contrast of the text tokens on the page background and on glass cards (WCAG AA: 4.5:1 for text).
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/styles.css'), 'utf8');
const darkAt = css.indexOf('--bg-page: #0b0e14');
const light = css.slice(0, darkAt), dark = css.slice(darkAt);
const tok = (src, name) => { const m = src.match(new RegExp('--' + name + ':\\s*([^;]+);')); return m ? m[1].trim() : null; };
const parse = (v) => {
  let m = v.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = v.match(/^#([0-9a-f]{3})$/i);
  if (m) return [...m[1]].map(c => parseInt(c + c, 16)).concat(1);
  m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) { const p = m[1].split(',').map(x => parseFloat(x)); return [p[0], p[1], p[2], p[3] ?? 1]; }
  throw new Error('cannot parse ' + v);
};
const over = (fg, bg) => [0, 1, 2].map(i => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rows = [];
for (const [mode, src, fallback] of [['light', light, light], ['dark', dark, light]]) {
  const get = (n) => tok(src, n) || tok(fallback, n);
  const page = parse(get('bg-page'));
  const card = over(parse(get('glass-card')), page);
  for (const t of ['text-primary', 'text-secondary', 'text-muted', 'text-link', 'accent']) {
    const fg = parse(get(t));
    for (const [bgName, bg] of [['page', page], ['card', card]]) rows.push({ mode, token: t, on: bgName, ratio: +ratio(over(fg, bg), bg).toFixed(2) });
  }
}
console.table(rows);
// Body-text tokens must pass AA; --accent is used for large/bold text and borders too, so it gets the 3:1 UI threshold.
const bad = rows.filter(r => r.ratio < (r.token === 'accent' ? 3 : 4.5));
assert.equal(bad.length, 0, 'contrast below threshold: ' + JSON.stringify(bad));
console.log('TEST 52 OK');
process.exit(0);
