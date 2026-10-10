// Feed preferences: performance profile select applies batch / requests / interval; "Measure this computer" times two rating batches.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const now = Date.now();
const { store, w } = setup({});
store['feeds:subs'] = [{ id: 'a', url: 'https://a.test/feed', title: 'A', tags: [], lastFetched: now }];
store['feeds:items'] = [{ id: 'x1', feedId: 'a', title: 'Post', link: 'https://a.test/1', published: now - 1000, read: false, ai: true, cat: 'Tech' }];
let calls = 0;
globalThis.__ai = (m) => {
    calls++;
    const n = (m.user.match(/^\[\d+\]/gm) || []).length;
    const nums = Array.from({ length: n }, (_, k) => k + 1);
    return { ok: true, text: JSON.stringify({ scores: nums.map(() => 0.1), labels: nums.map(() => 'News') }) };
};
store.connectionMode = 'local'; store.activeService = 'ollama';
const fm = await imp('modules/feedManager.js'); fm.initFeedManager({ showToast() {}, showScreen() {} }); await tick(80);
w.document.dispatchEvent(new w.CustomEvent('aish:settings-panel', { detail: { name: 'feedprefs' } })); await tick(250);
const card = () => w.document.querySelector('#feedPrefsLibrary');
const sel = card().querySelector('#feedSetPreset');
assert(sel, 'profile select');
assert.equal(sel.value, 'balanced', 'defaults match the balanced profile');
assert(/Not measured yet/.test(card().textContent), 'benchmark not run yet');

sel.value = 'power'; sel.dispatchEvent(new w.Event('change', { bubbles: true })); await tick(200);
const saved = store['feeds:settings'];
assert.equal(saved.libraryBatch, 40); assert.equal(saved.requestsPerTick, 6); assert.equal(saved.autoProcessMinutes, 15);
assert.equal(card().querySelector('#feedSetPreset').value, 'power', 'select shows the stored profile after redraw');

const measure = [...card().querySelectorAll('button')].find(b => /Measure this computer/.test(b.textContent));
assert(measure, 'measure button');
measure.click();
for (let k = 0; k < 100 && !(store['feeds:settings'].libraryBench); k++) await tick(50);
const b = store['feeds:settings'].libraryBench;
assert(b && b.warm >= 0 && b.cold >= 0, 'benchmark stored');
assert.equal(calls, 2, 'one cold and one warm batch');
for (let k = 0; k < 100 && !/for 20 headlines/.test(card().textContent); k++) await tick(50);
assert(/for 20 headlines/.test(card().textContent), 'result shown: ' + card().textContent.slice(0, 200));
assert(/recommended/.test(card().textContent), 'a profile is recommended');
console.log('TEST 114 OK'); process.exit(0);
