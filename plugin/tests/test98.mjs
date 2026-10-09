// Automatic whole-library run: only with Ollama, on its own after the delay, and not again before the interval is over.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const yday = new Date(); yday.setDate(yday.getDate() - 1); yday.setHours(12, 0, 0, 0);
const { store } = setup({});
store['feeds:subs'] = [{ id: 'a', url: 'https://a.test/feed', title: 'A', tags: [], lastFetched: Date.now() }];
store['feeds:items'] = Array.from({ length: 25 }, (_, i) => ({ id: 'x' + i, feedId: 'a', title: 'Post ' + i, link: 'https://a.test/' + i, published: yday.getTime() - i * 60000, read: false }));
store['feeds:settings'] = { autoProcess: true, autoProcessMinutes: 15, autoProcessAt: 0 };
let aiCalls = 0;
globalThis.__ai = (m) => {
    aiCalls++;
    const n = (m.user.match(/^\[\d+\]/gm) || []).length, nums = Array.from({ length: n }, (_, k) => k + 1);
    if (/rate the sentiment/.test(m.system)) return { ok: true, text: JSON.stringify({ scores: nums.map(() => 0.1), labels: nums.map(() => 'World') }) };
    return { ok: true, text: `SCORES: ${nums.map(k => k + ':1').join(' | ')}\nLABELS: ${nums.map(k => k + ':World').join(' | ')}\nOverview.\n- Story\nMOOD: mixed` };
};
const ui = { showToast() {}, showScreen() {} };

// cloud model: the switch is on, but nothing runs
store.connectionMode = 'cloud'; store.activeService = 'openai';
const fm = await imp('modules/feedManager.js'); fm.initFeedManager(ui);
await tick(5500);
assert.equal(aiCalls, 0, 'no automatic run without Ollama');
assert(store['feeds:items'].every(i => !i.ai));

// Ollama: the run starts by itself
store.connectionMode = 'local'; store.activeService = 'ollama';
const fm2 = await imp('modules/feedManager.js'); fm2.initFeedManager(ui);
for (let k = 0; k < 120 && !store['feeds:items'].every(i => i.ai && i.cat === 'World'); k++) await tick(100);
assert(store['feeds:items'].every(i => i.ai && i.cat === 'World'), 'items rated and categorized on their own');
assert(aiCalls >= 2, 'rating + recap requests: ' + aiCalls);
const at = store['feeds:settings'].autoProcessAt;
assert(at > 0, 'run time remembered, so reopening the panel does not start another run at once');
const rec = Object.keys(store['feeds:recaps'] || {}).find(k => /\|all$/.test(k));
for (let k = 0; k < 60 && !(store['feeds:recaps'] && Object.keys(store['feeds:recaps']).some(x => /\|all$/.test(x))); k++) await tick(100);
assert(Object.keys(store['feeds:recaps'] || {}).some(k => /\|all$/.test(k)) || rec, 'day recap written');
console.log('TEST 98 OK'); process.exit(0);
