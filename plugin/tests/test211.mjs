// Contrast of the on-page highlights and the page tools (WCAG 2.2: 4.5:1 for text), from the design tokens (AISH-039):
// the marks painted into the page use content/markColors.js (= light annotation tokens, checked by design-system/lint.mjs),
// the panel, split button and selection toolbar read inPage.css, so every text pair they use is checked in every brand × theme.
import assert from 'assert';
import fs from 'fs'; import path from 'path';
const SRC = process.env.AISH_SRC;
const src = (f) => fs.readFileSync(path.resolve(SRC, f), 'utf8');
const hl = src('content/highlighter.js'), css = src('inPage.css');
const MK = Object.fromEntries([...src('content/markColors.js').matchAll(/'([\w-]+)':\s*'(#[0-9a-f]{6})'/gi)].map((m) => [m[1], m[2]]));
const rgb = (h) => { h = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const ok = (what, fg, bg, min = 4.5) => assert.ok(ratio(fg, bg) >= min, `${what}: ${fg} on ${bg} is ${ratio(fg, bg).toFixed(2)}:1, needs ${min}:1`);

// marks in the page: opaque backgrounds (a see-through one takes the page's colour), token colours, readable text
assert.equal(Object.keys(MK).length, 6, 'six mark colours');
ok('your highlight', MK['annotation-user-fg'], MK['annotation-user-bg']);
ok('AI highlight', MK['annotation-ai-fg'], MK['annotation-ai-bg']);
ok('flash', MK['annotation-user-fg'], MK['annotation-user-bar']);
for (const [name, bg, fg] of [['aish-user', 'annotation-user-bg', 'annotation-user-fg'], ['aish-ghost', 'annotation-ai-bg', 'annotation-ai-fg'], ['aish-flash', 'annotation-user-bar', 'annotation-user-fg']]) {
  const re = new RegExp(`::highlight\\(${name}\\) \\{ background-color: \\$\\{MK\\['${bg}'\\]\\}; color: \\$\\{MK\\['${fg}'\\]\\}`);
  assert.ok(re.test(hl), `::highlight(${name}) uses MK ${bg} / ${fg}`);
}
assert.ok(!/#[0-9a-f]{6}\b|rgba?\(/i.test(hl), 'no colour literals in highlighter.js');

// page tools: the token pairs the component CSS uses, in every brand and theme
const resolved = JSON.parse(fs.readFileSync(path.resolve(SRC, '../../design-system/dist/tokens.resolved.json'), 'utf8'));
const used = (fg, bg) => assert.ok(css.includes(`var(--${fg})`) && css.includes(`var(--${bg})`), `inPage.css uses --${fg} and --${bg}`);
const PAIRS = [
  ['text-primary', 'surface-sheet', 'panel text'], ['text-secondary', 'surface-sheet', 'filter, close'], ['text-muted', 'surface-sheet', 'hide-on-site, hints'],
  ['text-link', 'surface-sheet', 'Note about this page'], ['on-accent', 'accent', 'Summarize, Save, selected filter'],
  ['saved-note-user-fg', 'saved-note-user-bg', 'your highlight card'], ['saved-note-ghost-fg', 'saved-note-ghost-bg', 'AI suggestion card'],
  ['saved-note-danger', 'saved-note-user-bg', 'Remove'], ['saved-note-danger', 'saved-note-ghost-bg', 'Dismiss'],
  ['annotation-user-fg', 'annotation-user-bg', '✏️ n'], ['text-inverse', 'surface-inverse', 'selection toolbar'],
];
let checked = 0;
for (const [brand, ctx] of Object.entries(resolved)) {
  for (const [theme, t] of Object.entries(ctx.app)) {
    for (const [fg, bg, what] of PAIRS) {
      used(fg, bg);
      const F = t['--' + fg]?.value, B = t['--' + bg]?.value;
      assert.ok(/^#[0-9a-f]{6}$/i.test(F) && /^#[0-9a-f]{6}$/i.test(B), `${brand}/${theme}: --${fg} / --${bg} resolve to opaque colours (${F}, ${B})`);
      ok(`${brand}/${theme} ${what}`, F, B); checked++;
    }
  }
}
console.log(`test211 ok (${checked} token pairs)`);
