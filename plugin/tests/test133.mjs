// Icons lead the label everywhere: translated labels that still end with the emoji ("Copy 📋", "Save 💾"), the static
// Save button, and the Save button after its "Saved!" flash.
import { setup, imp } from './harness.mjs'; import assert from 'assert'; import fs from 'fs';
const { w } = setup({});
const d = w.document;
const ic = await imp('../src/modules/icons.js');
const [first, second] = ic.labelNodes('Copy 📋');
assert(first.classList && first.classList.contains('ic'), 'icon comes first');
assert.equal(second.textContent.trim(), 'Copy');
assert.equal(ic.labelNodes('📋 Copy')[0].classList.contains('ic'), true);
assert.equal(ic.labelNodes('Open ↗').length, 1, 'unmapped arrows stay plain trailing text');
const fab = d.getElementById('settingsSaveFab');
assert(fab.firstElementChild && fab.firstElementChild.classList.contains('ic'), 'static Save button: icon first');
assert(/^\s*Save\s*$/.test(fab.textContent.replace(/💾/g, '')), 'label kept');
const src = fs.readFileSync(new URL('../src/popup.html', import.meta.url), 'utf8');
assert(!/>[^<>]*[A-Za-z][^<>]* <span class="ic"><svg/.test(src), 'no static label puts its icon after the text');
console.log('TEST 133 OK');
