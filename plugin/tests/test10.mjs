import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const now = Date.now(); const D = 86400e3;
const dayStart = (t) => { const d = new Date(t); d.setHours(0,0,0,0); return d.getTime(); };
const today = dayStart(now);
const { store, w } = setup({});
w.HTMLElement.prototype.scrollIntoView = function () { w.__scrolled = this; };
const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
store.feedSubs = [{ id: 'a', url: 'https://a.test/f', title: 'A', tags: [], lastFetched: Date.now() }];
const mk = (id, daysAgo, h = 12) => ({ id, feedId: 'a', title: 'T ' + id, link: 'https://a.test/' + id, published: today - daysAgo * D + h * 3600e3, read: false });
store.feedItems = [mk('1',0,1), mk('2',2), mk('3',2,13), mk('4',5), mk('5',9), mk('6',9,14), mk('7',9,15)];
const fm = await imp('modules/feedManager.js'); const ui = { showToast() {}, showScreen() {} };
fm.initFeedManager(ui); await tick(50); await fm.onFeedsScreenShown(ui); await tick(100);
store.feedUi && 0;
const titles = () => $$('.feed-item h4').map(h => h.textContent);
const chip = () => $('#feedFilterChip').textContent;
// first run: default label
assert.ok(/Filter/.test(chip()), chip());
// open sheet → calendar
click($('#feedFilterChip')); await tick();
const pick = $$('#feedSheetBody .feed-pick-link')[0] || $$('.feed-pick-link')[0]; assert.ok(pick, 'pick row');
click(pick); await tick();
assert.ok($$('.feed-cal-cell').length >= 28, 'grid');
const cell = n => $$('.feed-cal-cell').find(c => c.dataset.day === String(dayStart(today - n * D)));
assert.ok(cell(2).classList.contains('has'), 'has');
// Only mode (default): click day -2
click(cell(2)); await tick(30);
assert.equal(titles().length, 2, 'only day: ' + titles());
console.log('chip', chip()); assert.ok(/ · |\d/.test(chip()) && !/Filter/.test(chip()));
assert.ok($$('.feed-day-step').length === 2, 'pager');
let st = JSON.parse(JSON.stringify(store.feedUi)); assert.equal(typeof st.date, 'object');
// pager next older day with items = -5
const steps = $$('.feed-day-step'); const older = steps.find(b => /‹/.test(b.textContent) ) , newer = steps.find(b => /›/.test(b.textContent));
click(newer.disabled ? older : newer); await tick(30);
console.log('after step', titles());
assert.ok(titles().length === 1 || titles().length === 1, 'stepped');
// reset
click($('#feedFilterChip')); await tick();
click($$('.feed-sheet-reset')[0]); await tick(30);
assert.equal(titles().length, 7, 'reset restores all'); assert.ok(/Filter/.test(chip()));
// range via shift-click
click($('#feedFilterChip')); await tick(); click($$('.feed-pick-link')[0]); await tick();
const sh = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, shiftKey: true }));
sh(cell(9)); await tick(); sh(cell(5)); await tick(30);
assert.equal(titles().length, 4, 'range 9..5: ' + titles()); console.log('range chip', chip());
// legacy values
store.feedUi = { ...store.feedUi, date: 'today' };
// no jump mode any more: no segmented switch, recap marker on days with a recap
click($('#feedFilterChip')); await tick(); click($$('.feed-sheet-reset')[0]); await tick();
store.feedRecaps = { [`${today - 5 * D}|all`]: { overview: 'x', themes: [], mood: 'neu', hash: 'h', at: now, n: 1 } };
const fm2 = await imp('modules/feedManager.js'); fm2.initFeedManager(ui); await fm2.onFeedsScreenShown(ui); await tick(100);
click($('#feedFilterChip')); await tick(); click($$('.feed-pick-link')[0]); await tick();
assert.equal($$('.feed-seg').length, 0, 'no jump/only switch');
assert.ok(cell(5).classList.contains('recap') && cell(5).querySelector('.feed-cal-recap'), 'recap marker');
assert.ok(!cell(2).classList.contains('recap'));
console.log('TEST 10 OK');
