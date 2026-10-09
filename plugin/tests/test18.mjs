// Feeds roll-up (month page): a month recap built from week recaps is flagged stale when a week changes, and the refresh sends only that week.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const sod = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addD = (ts, n) => { const d = new Date(ts); d.setDate(d.getDate() + n); return sod(d); };
// last month (complete, so its full weeks count as week parts) and its first and second full Monday-to-Sunday weeks
const m0 = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return sod(d); })();
const w1 = (() => { let d = m0; while (new Date(d).getDay() !== 1) d = addD(d, 1); return d; })();
const w2 = addD(w1, 7);
const { store, w } = setup({});
const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const mk = (id, d) => ({ id, feedId: 's1', title: 'Title' + id, link: 'https://x/' + id, published: d + 10 * 3600e3, snippet: 'snip', read: false });
const { recapSig } = await import(process.env.AISH_SRC + '/modules/feedAi.js');
store['feeds:subs'] = [{ id: 's1', url: 'https://a/f', title: 'Alpha', lastFetched: Date.now() }];
store['feeds:items'] = [mk('a1', addD(w1, 1)), mk('b1', addD(w2, 2))];
store['feeds:ui'] = { source: 'all', status: 'all', date: 'any', mood: 'any', sort: 'new', scope: 'month', anchor: addD(w1, 1) };
const rc = (o) => ({ overview: o, themes: ['t'], mood: 'pos', at: Date.now(), n: 1, covered: {} });
const orig = { a: rc('WeekOneRecap'), b: rc('WeekTwoRecap') };
store['feeds:recaps'] = {
  [`w:${w1}|all`]: rc('WeekOneEDITED'), [`w:${w2}|all`]: orig.b,
  [`m:${m0}|all`]: { overview: 'Old month text', themes: ['old'], mood: 'neu', at: Date.now(), n: 2, covered: { ['w:' + w1]: recapSig(orig.a), ['w:' + w2]: recapSig(orig.b) } }
};
const calls = [];
globalThis.__ai = (m) => { calls.push(m); return { ok: true, text: 'New month text.\n- n\nMOOD: positive' }; };
const fm = await imp('modules/feedManager.js'); const ui = { showToast() {}, showScreen() {} };
fm.initFeedManager(ui); await tick(50); await fm.onFeedsScreenShown(ui); await tick(50);
assert.ok($('#feedRecapCard'), 'recap card on the month page');
assert.ok($('.feed-recap-stale'), 'stale shown on the card');
click($('.feed-rc-act')); await tick(40);
assert.ok($('.feed-rollup'), 'month roll-up sheet opens');
assert.ok(/Old month text/.test($('.feed-rollup').textContent) && $('.feed-rollup .feed-recap-stale'), 'cached + stale hint');
click($$('.feed-rollup .feed-recap-actions button')[0]); await tick(100);
assert.equal(calls.length, 1);
const u = calls[0].user;
assert.ok(/Old month text/.test(u), 'previous roll-up is the base');
assert.ok(/WeekOneEDITED/.test(u) && /\(changed\)/.test(u), 'changed week sent and marked');
assert.ok(!/WeekTwoRecap/.test(u), 'unchanged week recap NOT sent again');
assert.ok(!/Title|snip/.test(u), 'no raw items');
assert.ok(/New month text/.test($('.feed-rollup').textContent));
assert.ok(!$('.feed-rollup .feed-recap-stale'), 'no longer stale');
assert.equal(store['feeds:recaps'][`m:${m0}|all`].covered['w:' + w1], recapSig(store['feeds:recaps'][`w:${w1}|all`]));
console.log('ok');
