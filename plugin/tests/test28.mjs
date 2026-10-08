// Feeds: a mood score carries over to the saved article with the same URL, others stay untouched.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { store, w } = setup({});
const now = Date.now();
store['feeds:subs'] = [{ id: 's1', url: 'https://a/f', title: 'A', lastFetched: now }];
store['feeds:items'] = [{ id: 'a', feedId: 's1', title: 'H', link: 'https://x.com/post', published: now - 1000, snippet: 's', read: false, ai: true, sent: -0.7 }];
store['articles:index'] = [{ id: 'art1', url: 'https://x.com/post?utm_source=q', title: 'H', timestamp: new Date().toISOString(), summary: 'sum', tags: [] }, { id: 'art2', url: 'https://other.com/', title: 'O', timestamp: new Date().toISOString(), summary: 's', tags: [] }];
store['feeds:ui'] = { source: 'all', status: 'all', date: 'any', mood: 'any', sort: 'new', scope: 'feed' };
const fm = await imp('modules/feedManager.js'); const ui = { showToast() {}, showScreen() {} };
fm.initFeedManager(ui); await tick(50); await fm.onFeedsScreenShown(ui); await tick(100);
const a1 = store['articles:index'].find(a => a.id === 'art1'), a2 = store['articles:index'].find(a => a.id === 'art2');
assert.equal(a1.moodScore, -0.7, 'carried over'); assert.equal(a2.moodScore, undefined, 'others untouched');
console.log('TEST 28 OK');
