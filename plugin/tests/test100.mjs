// Whole-library run with Ollama configured but another model active: requests go to Ollama, and the card shows what is happening.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const yday = new Date(); yday.setDate(yday.getDate() - 1); yday.setHours(12, 0, 0, 0);
const { store, w } = setup({});
store['feeds:subs'] = [{ id: 'a', url: 'https://a.test/feed', title: 'A', tags: [], lastFetched: Date.now() }];
store['feeds:items'] = Array.from({ length: 45 }, (_, i) => ({ id: 'x' + i, feedId: 'a', title: 'Post ' + i, link: 'https://a.test/' + i, published: yday.getTime() - i * 60000, read: false }));
store.connectionMode = 'cloud'; store.activeService = 'openai';
store['feeds:settings'] = { rateWithRecap: false };   // this test is about the separate rating batches              // summaries use something else
store['config:services'] = { ollama: { endpoint: 'http://localhost:11434/v1/chat/completions', customModel: [{ id: 'llama3.2', provider: 'ollama' }], activeModelId: { id: 'llama3.2', provider: 'ollama' } } };
const $ = (s) => w.document.querySelector(s);
const services = [], heads = [], texts = [];
globalThis.__ai = (m) => {
    services.push(m.service);
    heads.push($('.library-head')?.textContent || '');
    texts.push($('#feedPrefsLibrary')?.textContent || '');
    const n = (m.user.match(/^\[\d+\]/gm) || []).length, nums = Array.from({ length: n }, (_, k) => k + 1);
    if (/topic tags/.test(m.system)) return { ok: true, text: 'Tech, News, Gadgets, Extra' };
    if (/rate the sentiment/.test(m.system)) return { ok: true, text: JSON.stringify({ scores: nums.map(() => 0.3), labels: nums.map(() => 'Tech') }) };
    return { ok: true, text: `SCORES: ${nums.map(k => k + ':1').join(' | ')}\nLABELS: ${nums.map(k => k + ':Tech').join(' | ')}\nOverview.\n- Story\nMOOD: mixed` };
};
const fm = await imp('modules/feedManager.js'); fm.initFeedManager({ showToast() {}, showScreen() {} }); await tick(80);
w.document.dispatchEvent(new w.CustomEvent('aish:settings-panel', { detail: { name: 'feedprefs' } })); await tick(250);
const card = $('#feedPrefsLibrary');
const start = [...card.querySelectorAll('button')].find(b => /whole library/i.test(b.textContent));
assert(start, 'available although Ollama is not the active model: ' + card.textContent);
start.click();
for (let k = 0; k < 120 && !/Done\./.test(card.textContent); k++) await tick(50);
assert(/Done\./.test(card.textContent), 'finished: ' + card.textContent);
assert(services.length >= 6 && services.every(s => s === 'ollama'), 'every request is addressed to Ollama: ' + services);
assert(heads.some(h => /Rating and categorizing: batch 1 of 3 · items 1–20 of 45/.test(h)), 'rating status names batch and items: ' + heads[0]);
assert(heads.some(h => /Day recap 1 of 1 .*batch 2 of 3/.test(h)), 'recap status names day and batch: ' + heads.join(' | '));
assert(texts.some(t => /Model: llama3\.2/.test(t) && /not your active summary model/.test(t)), 'names the model and that it is not the active one: ' + texts[0]);
assert(texts.some(t => /Request \d+ of 7/.test(t) && /elapsed/.test(t)), 'totals line: ' + texts[0]);
assert(heads.some(h => /Tagging feed 1 of 1/.test(h)), 'tagging status: ' + heads.join(' | '));
assert.deepEqual(store['feeds:subs'][0].topics, ['Tech', 'News', 'Gadgets'], 'feed gets up to 3 topic tags');
assert.equal(store['feeds:subs'][0].topicsLang, 'en');
assert(store['feeds:items'].every(i => i.ai && i.cat === 'Tech'));
console.log('TEST 100 OK'); process.exit(0);
