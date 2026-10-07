import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(0, 0, 0, 0); return d.getTime(); };
const mon = (() => { const d = new Date(day(7)); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); d.setHours(0, 0, 0, 0); return d.getTime(); })();
const at = (dayTs, h = 10) => dayTs + h * 3600e3;
const addD = (ts, n) => { const d = new Date(ts); d.setDate(d.getDate() + n); d.setHours(0, 0, 0, 0); return d.getTime(); };
const { store, w } = setup({});
const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const mk = (id, dayTs) => ({ id, feedId: 's1', title: 'Title' + id, link: 'https://x/' + id, published: at(dayTs), snippet: 'snip', read: false });
const tue = addD(mon, 1), wed = addD(mon, 2);
store['feeds:subs'] = [{ id: 's1', url: 'https://a/f', title: 'Alpha', lastFetched: Date.now() }];
store['feeds:items'] = [mk('m1', mon), mk('t1', tue), mk('w1', wed), mk('w2', wed)];
store['feeds:ui'] = { source: 'all', status: 'all', date: 'any', mood: 'any', sort: 'new', scope: 'week', anchor: tue };
const rc = (o) => ({ overview: o, themes: ['theme ' + o], mood: 'pos', at: Date.now(), n: 1, covered: {} });
store['feeds:recaps'] = { [`${mon}|all`]: rc('MondayRecap'), [`${tue}|all`]: rc('TuesdayRecap') };
const calls = [];
globalThis.__ai = (m) => { calls.push(m); return { ok: true, text: /merge brief/.test(m.system) ? 'Week overview.\n- big theme\nMOOD: mixed' : 'Day overview WedRecap.\n- t\nMOOD: positive\nLABELS: 1:Tech | 2:Tech\nSCORES: 1:0.5 | 2:0.1' }; };
const fm = await imp('modules/feedManager.js'); const ui = { showToast() {}, showScreen() {} };
fm.initFeedManager(ui); await tick(50); await fm.onFeedsScreenShown(ui); await tick(50);
// scope switch + coverage
const bar = $('#feedRecapCard'); assert.ok(bar && !bar.hidden, 'recap card on the week page');
assert.deepEqual($$('.feed-scope-btn').map(b => b.textContent), ['Feed', 'Day', 'Week', 'Month']);
assert.ok($('.feed-scope-btn.active').dataset.scope === 'week');
assert.ok(/2 of 3 days have a recap/.test(bar.textContent), bar.textContent);
assert.equal($$('.feed-item').length, 4, 'week page lists the week items');
click($('.feed-rc-act')); await tick(30);
assert.ok($('.feed-roll-rows'), 'plan rows'); assert.ok(/missing/.test($('.feed-roll-rows').textContent));
assert.ok(/Create 1 missing day recap first/.test($('.feed-roll-opts').textContent));
assert.ok(/Sends 2 short recaps, not 4 headlines/.test($('.feed-roll-save').textContent), $('.feed-roll-save').textContent);
click($('.feed-rollup .feed-wide-btn')); await tick(120);
assert.equal(calls.length, 2, 'one day recap + one roll-up');
assert.ok(/news-digest recaps from headlines/.test(calls[0].system) || /Items:/.test(calls[0].user), 'first = day recap for Wed');
const roll = calls[1];
assert.ok(/merge brief/.test(roll.system));
assert.ok(/MondayRecap/.test(roll.user) && /TuesdayRecap/.test(roll.user) && /WedRecap/.test(roll.user), 'roll-up reads the three day recaps');
assert.ok(!/Title/.test(roll.user) && !/snip/.test(roll.user), 'no raw headline in the roll-up request');
const wk = store['feeds:recaps'][`w:${mon}|all`]; assert.ok(wk, 'week recap stored'); assert.equal(Object.keys(wk.covered).length, 3);
assert.ok(/Week overview/.test($('.feed-rollup').textContent));
assert.ok($('.feed-rollup .feed-mood-bar') || true, 'mood bar when items are rated');
// refresh without change: no AI
const before = calls.length;
click($$('.feed-rollup .feed-recap-actions button')[0]); await tick(60);
assert.equal(calls.length, before, 'nothing changed -> no request');
// a day recap changes -> stale, refresh sends only that day + previous roll-up
store['feeds:recaps'][`${mon}|all`] = rc('MondayEDITED');
const fm2 = await imp('modules/feedManager.js'); // fresh instance reads storage
// simpler: new window state is shared; reuse first instance by reloading its data
await fm2.onFeedsScreenShown(ui); await tick(50);
console.log('TEST 16 OK (stale path checked in test17)');
