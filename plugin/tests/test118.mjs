// Feed stacks in the list: off by default, on via the filter sheet's state; lead + "+N similar items", expand, read together, unstack.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const now = Date.now();
const { store, w } = setup({});
const mk = (id, feedId, title, ageH) => ({ id, feedId, title, link: 'https://x/' + id, published: now - ageH * 3600e3, snippet: '', read: false });
store['feeds:subs'] = [{ id: 's1', url: 'https://a/f', title: 'Alpha', lastFetched: now }, { id: 's2', url: 'https://b/f', title: 'Beta', lastFetched: now }, { id: 's3', url: 'https://c/f', title: 'Gamma', lastFetched: now }];
store['feeds:items'] = [
  mk('a', 's1', 'EU leaders agree new climate target for 2040', 1),
  mk('b', 's2', 'EU leaders agree on new 2040 climate target', 2),
  mk('c', 's3', 'Climate target for 2040: EU leaders agree after long talks', 3),
  mk('d', 's1', 'Local bakery wins national bread award', 4)];
const fm = await imp('modules/feedManager.js'); const ui = { showToast() {}, showScreen() {} };
fm.initFeedManager(ui); await tick(60); await fm.onFeedsScreenShown(ui); await tick(80);
const cards = () => [...w.document.querySelectorAll('#feedItemList .feed-item')];
assert.equal(cards().length, 4, 'stacking is off by default: every item is a card');
assert.equal(w.document.querySelectorAll('.feed-stack').length, 0);

// switch on (what the filter sheet's "Stack similar items" row does: ui.stack = true, persisted, re-render)
store['feeds:ui'] = { ...(store['feeds:ui'] || {}), stack: true };
await fm.onFeedsScreenShown(ui); await tick(80);
assert.equal(cards().length, 2, 'one stack + one single: ' + cards().map(c => c.textContent.slice(0, 40)).join(' | '));
const stack = w.document.querySelector('.feed-stack');
assert(stack, 'stack row exists');
assert(/\+2 similar items/.test(stack.textContent) && /Beta/.test(stack.textContent) && /Gamma/.test(stack.textContent), stack.textContent);
const rows = stack.querySelector('.feed-stack-rows');
assert(rows.hidden, 'collapsed by default');
stack.querySelector('.feed-stack-toggle').click();
assert(!rows.hidden && stack.querySelectorAll('.feed-stack-row').length === 2, 'expands to the two other items');
assert.equal(stack.querySelector('.feed-stack-toggle').getAttribute('aria-expanded'), 'true');

// reading the lead reads the whole stack
const items = store['feeds:items'];
assert(items.every(i => !i.read));
const dayRead = [...w.document.querySelectorAll('.feed-day-action')].find(b => /Mark read/.test(b.textContent));
assert(dayRead, 'day header offers Mark read'); dayRead.click(); await tick(120);
assert(['a', 'b', 'c'].every(id => store['feeds:items'].find(i => i.id === id).read), 'the lead and the two stacked items are read: ' + store['feeds:items'].map(i => i.id + ':' + i.read));   // d may sit under another day header, depending on the clock

// "Not the same story" splits it for good
store['feeds:items'].forEach(i => { i.read = false; });
await fm.onFeedsScreenShown(ui); await tick(80);
w.document.querySelector('.feed-stack-toggle').click();
w.document.querySelector('.feed-stack-split').click(); await tick(120);
assert.equal(cards().length, 4, 'unstacked: four cards again');
assert(store['feeds:settings'].stackExclude.includes('a') && store['feeds:settings'].stackExclude.includes('c'), 'remembered');
console.log('TEST 118 OK'); process.exit(0);
