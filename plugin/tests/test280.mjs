// Appearance on three axes (brightness, design, colour): old stored shapes are read onto them, attributes follow, and the stylesheet knows each combination.
import assert from 'assert'; import fs from 'fs'; import path from 'path';
import { setup, imp } from './harness.mjs';
const { w } = setup({});
const A = await imp('modules/appearance.js'); const U = await imp('modules/a11y.js');
const n = A.normalizeAppearance;
assert.deepEqual(n({}), { theme: 'system', design: 'standard', colorScheme: 'default' }, 'nothing stored: follow the system, standard, the build\'s colours');
assert.deepEqual(n({ theme: 'contrast' }), { theme: 'system', design: 'contrast', colorScheme: 'default' }, 'the old High contrast theme is a design now');
assert.deepEqual(n({ colorScheme: 'postil' }), { theme: 'system', design: 'postil', colorScheme: 'default' }, 'the old Postil scheme is a design');
assert.deepEqual(n({ colorScheme: 'blue', theme: 'dark' }), { theme: 'dark', design: 'standard', colorScheme: 'aish' }, '"blue" was Aish');
assert.deepEqual(n({ theme: 'contrast', design: 'standard' }), { theme: 'system', design: 'standard', colorScheme: 'default' }, 'a chosen design wins over the old shape');
assert.deepEqual(n({ theme: 'light', design: 'postil', colorScheme: 'viola' }), { theme: 'light', design: 'postil', colorScheme: 'viola' });
assert.deepEqual(n({ theme: 'x', design: 'y', colorScheme: 'z' }), { theme: 'system', design: 'standard', colorScheme: 'default' }, 'unknown values fall back');
assert.deepEqual(A.appearanceAttrs({ theme: 'dark', design: 'contrast', colorScheme: 'kaivo' }), { theme: 'dark', design: 'contrast', scheme: 'kaivo' });
assert.equal(n({ colorScheme: 'graphite' }).colorScheme, 'graphite', 'Graphite is a colour scheme');
assert.deepEqual(A.appearanceAttrs({}), { theme: '', design: '', scheme: '' }, 'no attributes for the defaults');

const root = w.document.documentElement;
U.applyA11y({ theme: 'dark', design: 'postil', colorScheme: 'viola' }, root);
assert.equal(root.getAttribute('data-theme'), 'dark'); assert.equal(root.getAttribute('data-design'), 'postil'); assert.equal(root.getAttribute('data-scheme'), 'viola');
U.applyA11y({ theme: 'contrast' }, root);
assert(!root.hasAttribute('data-theme') && root.getAttribute('data-design') === 'contrast' && !root.hasAttribute('data-scheme'), 'the old shape applies as the new');
U.applyA11y({}, root); assert(!root.hasAttribute('data-design') && !root.hasAttribute('data-theme'), 'defaults leave no attribute');

// the stylesheets: a block for each design in light and dark, no trace of the old attribute values
for (const f of ['styles.css', 'inPage.css']) {
  const css = fs.readFileSync(path.resolve(process.env.AISH_SRC, f), 'utf8');
  for (const d of ['postil', 'contrast']) assert(new RegExp(`\\[data-design='${d}'\\]\\[data-theme='dark'\\]`).test(css), f + ': ' + d + ' in forced dark');
  assert(/\[data-design='contrast'\]:not\(\[data-theme='light'\]\)/.test(css), f + ': High contrast follows a dark system');
  assert(!/data-theme='contrast'\]/.test(css) && !/data-scheme='(blue|postil)'/.test(css), f + ': nothing keyed on the old values');
  // Postil with a colour scheme: tinted blocks, each light one before the Postil dark blocks and each dark one after them (so the dark ones win)
  for (const sc of ['kaivo', 'aish', 'viola', 'graphite']) {
    const light = css.indexOf(`[data-design='postil'][data-scheme='${sc}'] {`) >= 0 ? css.indexOf(`[data-design='postil'][data-scheme='${sc}'] {`) : css.indexOf(`[data-design='postil'][data-scheme='${sc}']) {`);
    const postilDark = css.indexOf("[data-design='postil'][data-theme='dark']");
    const tintDark = css.indexOf(`[data-design='postil'][data-scheme='${sc}'][data-theme='dark']`);
    assert(light > 0 && postilDark > 0 && tintDark > 0, f + ': tinted Postil for ' + sc);
    assert(light < postilDark && postilDark < tintDark, f + ': the order lets dark win for ' + sc);
  }
  assert(/data-scheme='aish'/.test(css) && /data-scheme='viola'/.test(css), f + ': colour schemes');
}
// High contrast takes the colour scheme for its accent: Graphite is pure white on black in dark and black on white in light
{
  const css = fs.readFileSync(path.resolve(process.env.AISH_SRC, 'styles.css'), 'utf8');
  const block = (sel) => { const i = css.indexOf(sel); return i < 0 ? '' : css.slice(i, css.indexOf('}', i)); };
  const dark = block("[data-design='contrast'][data-scheme='graphite'][data-theme='dark'] {"), light = block("[data-design='contrast'][data-scheme='graphite'] {");
  assert(/--accent: #FFFFFF/i.test(dark), 'Graphite + High contrast + dark: a white accent');
  assert(/--accent: #000000/i.test(light), 'Graphite + High contrast + light: a black accent');
  assert(/data-design='contrast'\]\[data-scheme='aish'\]/.test(css), 'the other schemes colour the High contrast accent');
}
console.log('TEST 280 OK'); process.exit(0);
