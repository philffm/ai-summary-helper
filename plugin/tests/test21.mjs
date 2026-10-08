// Feeds retention setting: pruning old items, month scope reads from the store.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(0, 0, 0, 0); return d.getTime(); };
const { store, w } = setup({});
const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
let n = 0;
const mk = (d, sent, cat, ai = true) => ({ id: 'i' + (n++), feedId: 's1', title: 'T' + n, link: 'https://x/' + n, published: d + 10 * 3600e3, snippet: 's', read: false, ai, sent: ai ? sent : undefined, cat });
store['feeds:subs'] = [{ id: 's1', url: 'https://a/f', title: 'Alpha', lastFetched: Date.now() }];
// this week (today) 6 rated: 4 pos 2 neg ; old (60 days ago) 6 rated: all neu — older than keepDays=30 → pruned, but mood must survive
const cur = []; for (let k = 0; k < 4; k++) cur.push(mk(day(0), 0.8, 'Tech')); for (let k = 0; k < 2; k++) cur.push(mk(day(0), -0.8, 'World'));
cur.push(mk(day(0), 0, undefined, false), mk(day(0), 0, undefined, false));
const old = []; for (let k = 0; k < 6; k++) old.push(mk(day(60), 0, 'Tech'));
store['feeds:items'] = [...cur, ...old];
store['feeds:ui'] = { source: 'all', status: 'all', date: 'any', mood: 'any', sort: 'new', scope: 'feed' };
const fm = await imp('modules/feedManager.js'); const ui = { showToast() {}, showScreen() {} };
fm.initFeedManager(ui); await tick(50); await fm.onFeedsScreenShown(ui); await tick(50);
const st = store['feeds:mood']; assert.ok(st && Object.keys(st).length >= 2, 'daily mood store written: ' + JSON.stringify(st && Object.keys(st)));
// prune old items (setting 30 days)
store['feeds:settings'] = { ...(store['feeds:settings'] || {}), keepDays: 30 };
await fm.onFeedsScreenShown(ui); await tick(30);
click($('#feedInsightsBtn')); await tick(50);
assert.ok($('.feed-mt'), 'mood section');
// month scope: previous months only visible through the store
click($$('.feed-mt-sec .ar-view-btn').find(b => b.dataset.view === 'month')); await tick(20);
assert.equal($$('.feed-mt-col').length, 6, '6 months');
assert.ok($$('.feed-mt-col:not(.na)').length >= 1, 'a rated bucket');
click($$('.feed-mt-sec .ar-view-btn').find(b => b.dataset.view === 'week')); await tick(20);
assert.equal($$('.feed-mt-col').length, 8, '8 weeks');
const now = $('.feed-mt-col.now'); assert.ok(now && !now.classList.contains('na'), 'current week has index');
assert.ok(/\+33/.test($('.feed-mt-big').textContent), 'index (4-2)/6=+33: ' + $('.feed-mt-big').textContent);
assert.ok($('.feed-mt-card .feed-mood-bar'), 'bar in detail card');
click($$('.feed-mt-sec .ar-view-btn').find(b => b.dataset.view === 'day')); await tick(20);
assert.equal($$('.feed-mt-col').length, 14);
// day with 8 items, 6 rated: index defined; yesterday empty → n/a
assert.ok($$('.feed-mt-col.na').length >= 12);
click($$('.feed-mt-col.na')[0]); await tick(10);
assert.ok($('.feed-mt-prog') || /\bn\/a\b/.test($('.feed-mt-big').textContent), 'n/a state');
// open week hands over to scope pages
click($$('.feed-mt-sec .ar-view-btn').find(b => b.dataset.view === 'week')); await tick(20);
click($$('.feed-mt-acts .btn-sm')[0]); await tick(50);
assert.ok($('#feedInsights').hidden, 'insights closed'); assert.ok(!$('#feedRecapCard').hidden, 'recap card shown for week scope');
console.log('TEST 21 OK');
