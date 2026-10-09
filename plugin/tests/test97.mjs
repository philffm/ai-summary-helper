// Feed preferences: "Process the whole library" shows only for Ollama, runs in batches of 20 and fills in ratings, categories and day recaps.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const now = Date.now();
const yday = new Date(); yday.setDate(yday.getDate() - 1); yday.setHours(12, 0, 0, 0);
const { store, w } = setup({});
store['feeds:subs'] = [{ id: 'a', url: 'https://a.test/feed', title: 'A', tags: [], lastFetched: now }];
store['feeds:items'] = Array.from({ length: 45 }, (_, i) => ({ id: 'x' + i, feedId: 'a', title: 'Post ' + i, link: 'https://a.test/' + i, published: yday.getTime() - i * 60000, read: false }));
const sizes = [];
globalThis.__ai = (m) => {
    if (/topic tags/.test(m.system)) return { ok: true, text: 'Tech, News' };   // feed tagging: one request with a sample, not a rating batch
    const n = (m.user.match(/^\[\d+\]/gm) || []).length;
    sizes.push(n);
    const nums = Array.from({ length: n }, (_, k) => k + 1);
    if (/rate the sentiment/.test(m.system)) return { ok: true, text: JSON.stringify({ scores: nums.map(() => 0.2), labels: nums.map(() => 'Tech') }) };
    return { ok: true, text: `SCORES: ${nums.map(k => k + ':1').join(' | ')}\nLABELS: ${nums.map(k => k + ':Tech').join(' | ')}\nOverview of the day.\n- Story A\nMOOD: mixed` };
};
const $ = (s) => w.document.querySelector(s);
const fm = await imp('modules/feedManager.js'); const ui = { showToast() {}, showScreen() {} };

// not Ollama: only the hint, no start button
store.connectionMode = 'cloud'; store.activeService = 'openai';
fm.initFeedManager(ui); await tick(80);
const open = async () => { w.document.dispatchEvent(new w.CustomEvent('aish:settings-panel', { detail: { name: 'feedprefs' } })); await tick(250); };
await open();
assert($('#feedPrefsLibrary'), 'card exists');
assert(!$('#feedPrefsLibrary button'), 'no start button without Ollama');
assert(/Ollama/.test($('#feedPrefsLibrary').textContent));

// Ollama: plan text, batch size select, start
store.connectionMode = 'local'; store.activeService = 'ollama';
const fm2 = await imp('modules/feedManager.js'); fm2.initFeedManager(ui); await tick(120); await open();
const card = $('#feedPrefsLibrary');
assert(card.querySelector('#feedSetLibBatch'), 'batch size select');
assert.equal(card.querySelector('#feedSetLibBatch').value, '20', '20 is the default');
assert(/45 items to rate/.test(card.textContent) && /1 days to recap/.test(card.textContent), card.textContent);
const start = [...card.querySelectorAll('button')].find(b => /whole library/i.test(b.textContent));
assert(start && !start.disabled, 'start button: ' + [...card.querySelectorAll('button')].map(b => b.textContent + (b.disabled ? '(off)' : '')).join(' / '));
start.click();
for (let k = 0; k < 100 && !/Done\./.test(card.textContent); k++) await tick(50);
assert(/Done\./.test(card.textContent), 'finished: ' + card.textContent);
assert(sizes.length >= 6 && Math.max(...sizes) <= 20, 'requests of at most 20 items: ' + sizes);
const items = store['feeds:items'];
assert(items.every(i => i.ai && i.cat === 'Tech'), 'every item rated and categorized');
const rc = store['feeds:recaps'] || Object.values(store).find(v => v && typeof v === 'object' && Object.keys(v).some(k => /\|all$/.test(k)));
const rec = Object.entries(rc).find(([k]) => /\|all$/.test(k));
assert(rec, 'day recap stored');
assert.equal(Object.keys(rec[1].covered).length, 45, 'recap covers all 45 items');
assert(/Everything in your library/.test(card.textContent) || card.querySelector('button').disabled, 'nothing left to do afterwards');
console.log('TEST 97 OK'); process.exit(0);
