// Popup item writes cannot overwrite the worker-owned additions and ratings overlay.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { store, w } = setup({});
const now = Date.now();
store['feeds:subs'] = [{ id: 's1', url: 'https://example.test/feed', title: 'Example', tags: [] }];
store['feeds:items'] = [{ id: 'existing', feedId: 's1', title: 'Existing', link: 'https://example.test/old', published: now, snippet: '', read: false }];
const fm = await imp('modules/feedManager.js');
const ui = { showToast() {}, showScreen() {} };
fm.initFeedManager(ui);
await fm.onFeedsScreenShown(ui);

const workerData = {
    items: [{ id: 'from-worker', feedId: 's1', title: 'Background item', link: 'https://example.test/new', published: now, snippet: '', read: false }],
    ratings: { existing: { ai: true, sent: 0.7, cat: 'News' } },
    recaps: {}, status: { at: now, rated: 1, recaps: 0, failed: 0 }
};
store['feeds:background'] = workerData;
for (const listener of globalThis.__chL || []) listener({ 'feeds:background': { newValue: workerData } });
await tick(350);
assert(w.document.body.textContent.includes('Background item'), 'popup reloads newly stored worker items');
assert.equal(store['feeds:items'].find(item => item.id === 'existing').sent, undefined, 'worker rating remains in its own key until popup writes');
const dayAction = w.document.querySelector('.feed-day-action:not(.feed-day-ai)');
assert(dayAction, 'popup action can write items while worker data is present');
dayAction.click();
await tick(100);
assert.equal(store['feeds:background'].items[0].id, 'from-worker', 'popup write did not overwrite worker additions');
assert.deepEqual(store['feeds:background'].ratings.existing, { ai: true, sent: 0.7, cat: 'News' }, 'popup write did not overwrite worker ratings');

await fm.onFeedsScreenShown(ui);
assert.equal(w.document.querySelectorAll('.feed-item').length, 2);
assert.equal(store['feeds:items'].find(item => item.id === 'existing').sent, 0.7, 'popup merges worker rating into its read model');
console.log('TEST 109 OK');
