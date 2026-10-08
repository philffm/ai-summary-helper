// Feeds: source picker sheet and the jump to Settings from it.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { store, w } = setup({});
const $$ = s => [...w.document.querySelectorAll(s)];
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const now = Date.now();
store['feeds:subs'] = [{ id: 's1', url: 'https://a/f', title: 'Alpha', tags: ['Tech'], lastFetched: now }];
store['feeds:items'] = [{ id: 'a', feedId: 's1', title: 'H', link: 'https://x/1', published: now - 1000, snippet: 's', read: false }];
store['feeds:ui'] = { source: 'all', status: 'all', date: 'any', mood: 'any', sort: 'new', scope: 'feed' };
let shownScreen = null;
const fm = await imp('modules/feedManager.js'); const ui = { showToast() {}, showScreen(s) { shownScreen = s; } };
fm.initFeedManager(ui); await tick(50); await fm.onFeedsScreenShown(ui); await tick(50);
click(w.document.querySelector('#feedSourcePill')); await tick(20);
const edits = $$('#feedSheetBody .feed-pick-edit'); assert.equal(edits.length, 2, 'edit next to Tags and Feeds');
click(edits[0]); await tick(100);
assert.equal(shownScreen, 'settings');
console.log('TEST 24 OK');
