// Length panel: Auto | Custom, number field and slider stay in sync, values are clamped and saved, bias is stored.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w, store } = setup({}); const d = w.document;
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
const mk = (st) => ({ get: (k, cb) => { let o = {}; if (k == null) o = { ...st }; else [].concat(typeof k === 'object' && !Array.isArray(k) ? Object.keys(k) : k).forEach(x => { if (x in st) o[x] = st[x]; }); if (cb) { cb(o); return; } return Promise.resolve(o); },
  set: (o, cb) => { Object.assign(st, o); if (cb) cb(); return Promise.resolve(); }, remove: () => Promise.resolve() });
const lstore = {}; chrome.storage.local = mk(lstore);
const { SK } = await imp('modules/storageKeys.js');
const { initLengthControl } = await imp('modules/lengthControl.js');
await initLengthControl(); await tick(30);

const chip = d.getElementById('chipLengthLabel'), slider = d.getElementById('summaryLength'), num = d.getElementById('summaryLengthInput');
const modeBtns = () => [...d.querySelectorAll('#lengthModeGrid button')];
const biasBtns = () => [...d.querySelectorAll('#lengthBiasGrid button')];
assert.equal(modeBtns().length, 2, 'Auto and Custom');
assert.equal(modeBtns()[0].getAttribute('aria-pressed'), 'true', 'new install starts in Auto');
assert.equal(chip.textContent, 'Auto');
assert.notEqual(d.getElementById('lengthAutoBox').style.display, 'none');
assert.equal(d.getElementById('lengthCustomBox').style.display, 'none');

// bias
assert.equal(biasBtns().length, 3);
biasBtns()[2].click(); await tick(20);
assert.equal(lstore[SK.summaryLengthBias], 'long');

// custom mode: number ↔ slider
modeBtns()[1].click(); await tick(20);
assert.equal(lstore[SK.summaryLengthMode], 'custom');
assert.equal(d.getElementById('lengthAutoBox').style.display, 'none');
num.value = '333'; num.dispatchEvent(new w.Event('input', { bubbles: true })); await tick(10);
assert.equal(lstore[SK.summaryLength], 333, 'exact value saved from the number field');
assert.equal(slider.value, '333', 'slider follows');
assert.equal(chip.textContent, '333w');
slider.value = '420'; slider.dispatchEvent(new w.Event('input', { bubbles: true })); await tick(10);
assert.equal(num.value, '420', 'number follows the slider');
assert.equal(lstore[SK.summaryLength], 420);
// beyond the slider range the number field still works; the slider pins to its end
num.value = '1500'; num.dispatchEvent(new w.Event('input', { bubbles: true })); await tick(10);
assert.equal(lstore[SK.summaryLength], 1500); assert.equal(slider.value, '1000');
// out of range / empty is fixed when the field settles
num.value = '99999'; num.dispatchEvent(new w.Event('change', { bubbles: true })); await tick(10);
assert.equal(num.value, '2000'); assert.equal(lstore[SK.summaryLength], 2000);
num.value = ''; num.dispatchEvent(new w.Event('change', { bubbles: true })); await tick(10);
assert.equal(num.value, '200');
// back to Auto keeps the custom number for later
modeBtns()[0].click(); await tick(20);
assert.equal(lstore[SK.summaryLengthMode], 'auto'); assert.equal(chip.textContent, 'Auto'); assert.equal(lstore[SK.summaryLength], 200);
console.log('TEST 95 OK'); process.exit(0);
