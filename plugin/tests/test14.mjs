// Feeds AI scoring: prompt asks for labels and scores, an existing rating is never overwritten.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const now = Date.now();
const run = async (rateSetting) => {
  const { store, w } = setup({});
  const $ = s => w.document.querySelector(s);
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const mk = (id, ageH, extra = {}) => ({ id, feedId: 's1', title: 'T' + id, link: 'https://x/' + id, published: now - ageH * 3600e3, snippet: 's', read: false, ...extra });
  store['feeds:subs'] = [{ id: 's1', url: 'https://a/f', title: 'Alpha', lastFetched: now }];
  store['feeds:items'] = [mk('a', 0.01), mk('b', 0.02), mk('c', 0.03, { ai: true, sent: 0.9, cat: 'Old' })];
  if (rateSetting !== undefined) store['feeds:settings'] = { rateWithRecap: rateSetting };
  const calls = [];
  globalThis.__ai = (m) => { calls.push(m); return { ok: true, text: 'Overview.\n- x\nMOOD: mixed\nLABELS: 1:Tech | 2:Politics | 3:Ignored\nSCORES: 1:0.8 | 2:-0.6 | 3:-1' }; };
  const fm = await imp('modules/feedManager.js'); const ui = { showToast() {}, showScreen() {} };
  fm.initFeedManager(ui); await tick(50); await fm.onFeedsScreenShown(ui); await tick(50);
  click($('.feed-day-ai')); await tick(80);
  return { items: store['feeds:items'], calls };
};
let r = await run();   // default: on
assert.equal(r.calls.length, 1, 'one request only');
assert.ok(/LABELS/.test(r.calls[0].system) && /SCORES/.test(r.calls[0].system));
const by = Object.fromEntries(r.items.map(i => [i.id, i]));
assert.deepEqual([by.a.sent, by.a.cat, by.a.ai], [0.8, 'Tech', true]);
assert.deepEqual([by.b.sent, by.b.cat], [-0.6, 'Politics']);
assert.deepEqual([by.c.sent, by.c.cat], [0.9, 'Old'], 'existing rating never overwritten');
r = await run(false);  // off
assert.ok(!/LABELS|SCORES/.test(r.calls[0].system), 'prompt without rating when off');
assert.ok(r.items.every(i => i.id === 'c' || (!i.ai && !i.cat)), 'nothing rated when off');
console.log('TEST 14 OK');
