// Feeds: activity bars scale with the number of items per day.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(0, 0, 0, 0); return d.getTime(); };
const { store, w } = setup({});
const $$ = s => [...w.document.querySelectorAll(s)];
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
let n = 0; const items = [];
const add = (d, k) => { for (let i = 0; i < k; i++) items.push({ id: 'i' + (n++), feedId: 's1', title: 'T' + n, link: 'https://x/' + n, published: d + 3600e3, snippet: 's', read: false }); };
add(day(1), 1); add(day(2), 5); add(day(3), 40); add(day(4), 200);
store['feeds:subs'] = [{ id: 's1', url: 'https://a/f', title: 'A', lastFetched: Date.now() }]; store['feeds:items'] = items;
store['feeds:ui'] = { source: 'all', status: 'all', date: 'any', mood: 'any', sort: 'new', scope: 'feed' };
const fm = await imp('modules/feedManager.js'); const ui = { showToast() {}, showScreen() {} };
fm.initFeedManager(ui); await tick(50); await fm.onFeedsScreenShown(ui); await tick(50);
click(w.document.querySelector('#feedFilterChip')); await tick(20);
click($$('#feedSheetBody .feed-pick-row').find(r => /Pick a day/.test(r.textContent))); await tick(20);
const lv = (d) => $$('.feed-cal-cell').find(c => c.dataset.day === String(day(d))).dataset.lvl;
console.log(lv(1), lv(2), lv(3), lv(4));
assert.ok(+lv(1) < +lv(2) && +lv(2) < +lv(3) && +lv(3) <= +lv(4), 'monotonic'); assert.equal(lv(4), '5'); assert.ok(+lv(2) >= 2, 'small days not washed out');
console.log('TEST 25 OK');
