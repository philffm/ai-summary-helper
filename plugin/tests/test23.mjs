// Feeds recap: error path; a summary finished elsewhere flips the card without a reload.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { store, sent, w } = setup({});
const $ = s => w.document.querySelector(s);
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const now = Date.now();
store['feeds:subs'] = [{ id: 's1', url: 'https://a/f', title: 'Alpha', lastFetched: now }];
store['feeds:items'] = [{ id: 'a', feedId: 's1', title: 'Hello', link: 'https://x.com/post?utm_source=q', published: now - 1000, snippet: 's', read: false }];
store['feeds:ui'] = { source: 'all', status: 'all', date: 'any', mood: 'any', sort: 'new', scope: 'feed' };
const fm = await imp('modules/feedManager.js'); const ui = { showToast() {}, showScreen() {} };
fm.initFeedManager(ui); await tick(50); await fm.onFeedsScreenShown(ui); await tick(50);
const btn = () => $('.feed-sum-btn');
assert.ok(btn() && !btn().classList.contains('busy'));
click(btn()); await tick(20);
assert.ok(btn().classList.contains('busy') && btn().disabled && /5%/.test(btn().textContent), btn().textContent);
const L = globalThis.__msgL; assert.ok(L && L.length, 'listener registered');
const emit = (m, url = 'https://x.com/post') => L.forEach(f => f(m, { tab: { id: 9, url } }));
emit({ action: 'summaryProgress', progress: 40 }); assert.ok(/40%/.test(btn().textContent) && btn().style.getPropertyValue('--p') === '40');
emit({ action: 'summaryProgress', progress: 30 }); assert.ok(/40%/.test(btn().textContent), 'never backwards');
emit({ action: 'summaryProgress', progress: 70 }, 'https://other.com/'); assert.ok(/70%/.test(btn().textContent), 'single pending follows redirected tab');
await fm.onFeedsScreenShown(ui); await tick(30); assert.ok(btn().classList.contains('busy'), 'survives re-render');
store['articles:index'] = [{ url: 'https://x.com/post', title: 'Hello', timestamp: new Date().toISOString() }];
emit({ action: 'summaryComplete', url: 'https://x.com/post' }); await tick(600);
assert.ok(!btn().classList.contains('busy') && /View summary/.test(btn().textContent), btn().textContent);
// error path
store['articles:index'] = [];
await fm.onFeedsScreenShown(ui); await tick(30);
click(btn()); await tick(20); emit({ action: 'summaryError', error: 'boom' }); await tick(10);
assert.ok(!btn().classList.contains('busy') && !btn().disabled, 'error resets');
// summary finished elsewhere (storage change) -> card flips without any relay message
store['articles:index'] = [];
await fm.onFeedsScreenShown(ui); await tick(30);
assert.ok(/Summarize/.test(btn().textContent) && !/View/.test(btn().textContent));
store['articles:index'] = [{ url: 'https://x.com/post', title: 'Hello', timestamp: new Date().toISOString() }];
globalThis.__chL.forEach(f => f({ 'articles:index': {} }, 'local')); await tick(500);
assert.ok(/View summary/.test(btn().textContent), btn().textContent);
console.log('TEST 23 OK');
