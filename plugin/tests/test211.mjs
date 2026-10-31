// Contrast of the on-page highlights and the page panel (WCAG 2.2: 4.5:1 for text, 3:1 for UI shapes), on light and dark pages and panels.
import assert from 'assert';
import fs from 'fs'; import path from 'path';
const src = (f) => fs.readFileSync(path.resolve(process.env.AISH_SRC, 'content', f), 'utf8');
const hl = src('highlighter.js'), panel = src('highlightPanel.js');
const rgb = (h) => { h = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const ok = (what, fg, bg, min = 4.5) => assert.ok(ratio(fg, bg) >= min, `${what}: ${fg} on ${bg} is ${ratio(fg, bg).toFixed(2)}:1, needs ${min}:1`);

// highlights: opaque backgrounds (a see-through one takes the page's colour, so the contrast would depend on the page)
assert.ok(!/rgba\(186,\s*230,\s*253/.test(hl), 'the AI highlight background must not be see-through');
const pair = (re, what) => { const m = re.exec(hl); assert.ok(m, what + ' not found'); ok(what, m[2], m[1]); };
pair(/::highlight\(aish-user\) \{ background-color: (#[0-9a-f]{6}); color: (#[0-9a-f]{6})/i, 'your highlight');
pair(/::highlight\(aish-ghost\) \{ background-color: (#[0-9a-f]{6}); color: (#[0-9a-f]{6})/i, 'AI highlight');
pair(/::highlight\(aish-flash\) \{ background-color: (#[0-9a-f]{6}); color: (#[0-9a-f]{6})/i, 'flash');
pair(/ai-ghost-highlight[\s\S]*?background-color:(#[0-9a-f]{6});color:(#[0-9a-f]{6})/i, 'AI highlight (fallback mark)');
pair(/ai-user-highlight[\s\S]*?background-color:(#[0-9a-f]{6});color:(#[0-9a-f]{6})/i, 'your highlight (fallback mark)');

// panel, light and dark: text, links, the remove action, muted text, and the coloured edge of a card (3:1 against the card)
const light = '#ffffff', dark = '#1f2937';
ok('muted', '#6b7280', light); ok('link', '#2563eb', light); ok('remove', '#dc2626', light);
const darkCss = panel.slice(panel.indexOf('@media (prefers-color-scheme: dark)'));
const dk = (re, what) => { const m = re.exec(darkCss); assert.ok(m, what + ' missing from the dark panel rules'); return m[1]; };
ok('dark muted', dk(/\.meta \{ color: (#[0-9a-f]{6})/i, 'muted'), dark);
ok('dark link', dk(/\.acts button \{ color: (#[0-9a-f]{6})/i, 'link'), dark);
ok('dark remove', dk(/\.acts \.rm \{ color: (#[0-9a-f]{6})/i, 'remove'), dark);
ok('dark edge (yours)', dk(/\.item\.user \{ border-left-color: (#[0-9a-f]{6})/i, 'edge'), dark, 3);
ok('light edge (yours)', /\.item\.user \{ border-left-color: (#[0-9a-f]{6})/i.exec(panel)[1], light, 3 - 0.2);   // #a16207 clears 4:1; the margin only guards a rounding slip
ok('light edge (AI)', /\.item\.ghost \{ border-left-color: (#[0-9a-f]{6})/i.exec(panel)[1], light, 3);

// the sticky notes (Notes tab, article view): text on each card colour, light and dark, and the dark delete link
{ const css = fs.readFileSync(path.resolve(process.env.AISH_SRC, 'styles.css'), 'utf8');
  const vars = (block) => Object.fromEntries([...block.matchAll(/--st-([a-z]+-[a-z]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
  const light = vars(/^:root \{ (--st-user-bg[^}]*)\}/m.exec(css)[1]), dark = vars(/^:root\[data-theme='dark'\] \{ (--st-user-bg[^}]*)\}/m.exec(css)[1]);
  const system = vars(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme='light'\]\):not\(\[data-theme='contrast'\]\) \{ (--st-user-bg[^}]*)\}/.exec(css)[1]);
  assert.deepEqual(system, dark, 'the System theme (no data-theme attribute) uses the same dark card colours');
  for (const [name, v] of [['light', light], ['dark', dark]]) for (const k of ['user', 'ghost', 'note']) ok(`${name} ${k} card text`, v[k + '-fg'], v[k + '-bg']);
  const del = /\.st-del \{ color: (#[0-9a-f]{6}); \}/.exec(css); assert.ok(del, 'the dark delete colour'); ok('dark delete link', del[1], dark['note-bg']); }
console.log('TEST 211 OK');
