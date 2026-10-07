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
store['feeds:items'] = [{ ...mk('m1', mon), ai: true, sent: 0.8 }, { ...mk('t1', tue), ai: true, sent: 0 }, { ...mk('w1', wed), ai: true, sent: -0.7 }, { ...mk('w2', wed), ai: true, sent: -0.9 }];
store['feeds:ui'] = { source: 'all', status: 'all', date: 'any', mood: 'any', sort: 'new', scope: 'week', anchor: tue };
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
assert.ok(/3 of 3 days have a recap/.test($('#feedRecapCard').textContent));
assert.ok($('.feed-recap-stale'), 'stale shown on the card');
const bar = $('#feedRecapCard .feed-mood-bar'); assert.ok(bar, 'mood bar on the week card');
assert.deepEqual([...bar.children].map(c => c.className.replace('feed-mood-seg ', '')), ['neg', 'neu', 'pos'], 'red, yellow, green');
const leg = $('#feedRecapCard .feed-mood-legend').textContent; assert.equal(leg, '50%25%25%', leg);
assert.ok(!/😊 \d+%/.test($('#feedRecapCard').textContent), 'no emoji percent line');
console.log('TEST 20 OK');
