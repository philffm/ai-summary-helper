import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const now = Date.now();
const { store, w } = setup({}); const $$ = s => [...w.document.querySelectorAll(s)]; const $ = s => w.document.querySelector(s);
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
store.feedSubs = [{ id: 's', url: 'u', title: 'T', lastFetched: now }];
store.feedItems = ['a','b','c'].map((id, k) => ({ id, feedId: 's', title: 'Item ' + id, link: 'https://x.test/' + id, published: now - k * 1000, snippet: '', read: false }));
const fm = await imp('modules/feedManager.js'); const ui = { showToast() {}, showScreen() {} };
fm.initFeedManager(ui); await tick(50); await fm.onFeedsScreenShown(ui); await tick(50);
assert.equal($$('.feed-item').length, 3);
click($$('.feed-item')[0]); await tick(50);                       // open → read
assert.equal(store.feedItems.find(i => i.id === 'a').read, true);
assert.equal($$('.feed-item').length, 3, 'stays visible after open');
assert.ok($$('.feed-item')[0].classList.contains('is-read'));
click($('#feedChipRow [data-status=all]')); click($('#feedChipRow [data-status=unread]')); await tick(30);
assert.equal($$('.feed-item').length, 2, 'gone after changing view');
// day Mark read still clears
click($('.feed-day-action:not(.feed-day-ai)')); await tick(30);
assert.equal($$('.feed-item').length, 0);
console.log('TEST 8 OK');
