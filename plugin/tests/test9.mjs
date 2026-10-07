import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const now = Date.now();
let n = 0;
const entries = (k, base) => Array.from({ length: k }, (_, i) => `<entry><id>${base}${i}</id><title>${base} post ${i}</title><link rel="alternate" href="https://${base}.test/${i}"/><published>${new Date(now - (i + 1) * 3600e3).toISOString()}</published></entry>`).join('');
const feed = (base, k) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>${base}</title><link href="https://${base}.test/"/>${entries(k, base)}</feed>`;
const { store, w } = setup({ 'https://a.test/feed': feed('a', 120), 'https://b.test/feed': feed('b', 120) });
const $$ = s => [...w.document.querySelectorAll(s)];
store['feeds:subs'] = [{ id: 'a', url: 'https://a.test/feed', title: 'A', tags: [], lastFetched: 0 }, { id: 'b', url: 'https://b.test/feed', title: 'B', tags: [], lastFetched: 0 }];
// pre-existing old items (11 days) beyond 50/feed
store['feeds:items'] = Array.from({ length: 60 }, (_, i) => ({ id: 'old' + i, feedId: 'a', title: 'Old ' + i, link: 'https://a.test/old' + i, published: now - (11 + i / 100) * 86400e3, read: false }));
const fm = await imp('modules/feedManager.js'); const ui = { showToast() {}, showScreen() {} };
fm.initFeedManager(ui); await tick(50); await fm.onFeedsScreenShown(ui); await tick(300);
console.log('stored', store['feeds:items'].length);
assert.equal(store['feeds:items'].length, 120 + 120 + 60, 'nothing dropped inside retention');
assert.equal($$('.feed-item').length, 100, 'first page');
const more = $$('.feed-more button'); assert.equal(more.length, 1); console.log(more[0].textContent);
more[0].click(); await tick(30);
assert.equal($$('.feed-item').length, 200);
// reload keeps everything
const fm2 = await imp('modules/feedManager.js'); fm2.initFeedManager(ui); await fm2.onFeedsScreenShown(ui); await tick(100);
assert.equal(store['feeds:items'].length, 300);
console.log('TEST 9 OK');
