// Feeds layout: Feed is the default, week page, month page lists weeks.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const sod = (n) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(0, 0, 0, 0); return d.getTime(); };
const { store, w } = setup({});
const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const mk = (id, n) => ({ id, feedId: 's1', title: 'T' + id, link: 'https://x/' + id, published: sod(n) + 10 * 3600e3, snippet: 's', read: false });
store['feeds:subs'] = [{ id: 's1', url: 'https://a/f', title: 'Alpha', lastFetched: Date.now() }];
store['feeds:items'] = [mk('a', 0), mk('b', 1), mk('c', 2), mk('d', 12)];
w.HTMLElement.prototype.scrollIntoView = function () {};
const fm = await imp('modules/feedManager.js'); const ui = { showToast() {}, showScreen() {} };
fm.initFeedManager(ui); await tick(50); await fm.onFeedsScreenShown(ui); await tick(50);
// R1: Feed is the default, no recap card, one scope row, search is an icon
assert.deepEqual($$('.feed-scope-btn').map(b => b.textContent), ['Feed', 'Day', 'Week', 'Month']);
assert.equal($('.feed-scope-btn.active').dataset.scope, 'feed');
assert.ok($('#feedRecapCard').hidden, 'no card in Feed');
assert.ok($('#feedToolbar') && !$('#feedToolbar').hidden, 'search, graph, insights always visible');
assert.equal($('#feedControls').firstElementChild.id, 'feedToolbar', 'search bar is the first row, like History');
assert.ok(!$('#feedSearchBtn'));
assert.equal($$('.feed-item').length, 4, 'feed scrolls across all days');
assert.ok($('#feedSearch') && $('#feedGraphBtn') && $('#feedInsightsBtn'));
// R2: Week page (anchor = a day under the top bar; here: first header, fake layout)
$('#feedControls').getBoundingClientRect = () => ({ bottom: 0 });
$$('.feed-day[data-day]').forEach((h, i) => { h.getBoundingClientRect = () => ({ top: i * 100 }); });
click($$('.feed-scope-btn')[2]); await tick(30);
assert.equal($('.feed-scope-btn.active').dataset.scope, 'week');
assert.ok(!$('#feedRecapCard').hidden);
assert.equal($$('.feed-rc-cell').length, 7);
assert.ok(/Week \d+/.test($('.feed-rc-label').textContent));
assert.ok($$('.feed-item').length >= 1 && $$('.feed-item').length <= 4);
const wk = $('.feed-rc-label').textContent;
const stepOlder = $('.feed-rc-step'); 
if (!stepOlder.disabled) { click(stepOlder); await tick(30); assert.notEqual($('.feed-rc-label').textContent, wk, 'older week'); }
// R3: Month page lists weeks; tapping one opens the week page
click($$('.feed-scope-btn')[3]); await tick(30);
assert.equal($('.feed-scope-btn.active').dataset.scope, 'month');
assert.ok($$('.feed-weekrow').length >= 1, 'weeks as the list');
assert.equal($$('.feed-item').length, 0, 'no item cards on the month page');
click($('.feed-weekrow-btn')); await tick(30);
assert.equal($('.feed-scope-btn.active').dataset.scope, 'week');
// Day page
click($$('.feed-scope-btn')[1]); await tick(30);
assert.equal($('.feed-scope-btn.active').dataset.scope, 'day');
assert.equal($$('.feed-rc-cell').length, 0);
// back to Feed
click($$('.feed-scope-btn')[0]); await tick(30);
assert.ok($('#feedRecapCard').hidden);
assert.equal($$('.feed-item').length, 4);
// searching overrides the scope
click($$('.feed-scope-btn')[2]); await tick(30);
const inp = $('#feedSearch'); inp.value = 'Ta'; inp.dispatchEvent(new w.Event('input')); await tick(250);
assert.equal($('.feed-scope-btn.active').dataset.scope, 'feed', 'search wins over scope');
console.log('TEST 19 OK');
