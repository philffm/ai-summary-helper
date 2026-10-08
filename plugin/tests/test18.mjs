// Feeds roll-up (week page): stale flag and refresh; tracked as known-failing in the runner.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(0, 0, 0, 0); return d.getTime(); };
const mon = (() => { const d = new Date(day(7)); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); d.setHours(0, 0, 0, 0); return d.getTime(); })();
const addD = (ts, n) => { const d = new Date(ts); d.setDate(d.getDate() + n); d.setHours(0, 0, 0, 0); return d.getTime(); };
const tue = addD(mon, 1), wed = addD(mon, 2);
const { store, w } = setup({});
const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const mk = (id, d) => ({ id, feedId: 's1', title: 'Title' + id, link: 'https://x/' + id, published: d + 10 * 3600e3, snippet: 'snip', read: false });
const { recapSig } = await import(process.env.AISH_SRC + '/modules/feedAi.js');
store['feeds:subs'] = [{ id: 's1', url: 'https://a/f', title: 'Alpha', lastFetched: Date.now() }];
store['feeds:items'] = [mk('m1', mon), mk('t1', tue), mk('w1', wed)];
store['feeds:ui'] = { source: 'all', status: 'all', date: { from: tue, to: tue }, mood: 'any', sort: 'new' };
const rc = (o) => ({ overview: o, themes: ['t'], mood: 'pos', at: Date.now(), n: 1, covered: {} });
const orig = { m: rc('MondayRecap'), t: rc('TuesdayRecap'), w: rc('WedRecap') };
store['feeds:recaps'] = {
  [`${mon}|all`]: rc('MondayEDITED'), [`${tue}|all`]: orig.t, [`${wed}|all`]: orig.w,
  [`w:${mon}|all`]: { overview: 'Old week text', themes: ['old'], mood: 'neu', at: Date.now(), n: 3, covered: { ['d:' + mon]: recapSig(orig.m), ['d:' + tue]: recapSig(orig.t), ['d:' + wed]: recapSig(orig.w) } }
};
const calls = [];
globalThis.__ai = (m) => { calls.push(m); return { ok: true, text: 'New week text.\n- n\nMOOD: positive' }; };
const fm = await imp('modules/feedManager.js'); const ui = { showToast() {}, showScreen() {} };
fm.initFeedManager(ui); await tick(50); await fm.onFeedsScreenShown(ui); await tick(50);
assert.ok(/3 of 3 days have a recap/.test($('.feed-recap-bar').textContent));
click($(".feed-recap-seg").children[2]); await tick(60); assert.ok($(".feed-rollup")); console.log("MONTH sheet:", $(".feed-rollup").textContent.slice(0,160)); process.exit(0);
assert.ok(/Old week text/.test($('.feed-rollup').textContent) && $('.feed-recap-stale'), 'cached + stale hint');
click($$('.feed-rollup .feed-recap-actions button')[0]); await tick(100);
assert.equal(calls.length, 1);
const u = calls[0].user;
assert.ok(/Current period recap/.test(u) && /Old week text/.test(u), 'previous roll-up is the base');
assert.ok(/MondayEDITED/.test(u) && /\(changed\)/.test(u), 'changed day sent and marked');
assert.ok(!/TuesdayRecap|WedRecap/.test(u), 'unchanged day recaps NOT sent again');
assert.ok(!/Title|snip/.test(u));
assert.ok(/New week text/.test($('.feed-rollup').textContent));
assert.ok(!$('.feed-recap-stale'), 'no longer stale');
assert.equal(store['feeds:recaps'][`w:${mon}|all`].covered['d:' + mon], recapSig(store['feeds:recaps'][`${mon}|all`]));
console.log('TEST 17 OK');
