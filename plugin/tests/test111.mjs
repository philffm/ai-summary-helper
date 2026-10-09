// Feed polling: conditional requests preserve items on 304; adaptive interval and priority use posting rhythm and reading.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';

const now = Date.now();
const day = 86400000;
const items = [
    { feedId: 'frequent', published: now - 4 * day, read: true },
    { feedId: 'frequent', published: now - 3 * day, read: true },
    { feedId: 'frequent', published: now - 2 * day, read: false },
    { feedId: 'rare', published: now - 14 * day, read: false },
    { feedId: 'rare', published: now - 7 * day, read: false }
];
const { estimateFeedInterval, feedPriority, feedQualityWeight } = await imp('modules/feedWorker.js');
assert.equal(estimateFeedInterval(items, 'frequent', 15 * 60000, now), 12 * 60 * 60 * 1000);
assert.equal(estimateFeedInterval(items, 'rare', 15 * 60000, now), 3.5 * day);
assert(feedPriority({ id: 'frequent', lastFetched: now - day }, items, 1, now) >
    feedPriority({ id: 'frequent', lastFetched: now - 60000 }, items, 1, now), 'older fetches have greater expected new items');
assert(feedQualityWeight(items, 'frequent', now) > feedQualityWeight(items, 'rare', now), 'reading behaviour weights priority');

const requests = [];
let requestNumber = 0;
const xml = `<rss><channel><title>Conditional</title><item><guid>item-1</guid><title>Unread story</title><link>https://example.test/story</link><pubDate>${new Date(now).toUTCString()}</pubDate></item></channel></rss>`;
const feedUrl = 'https://example.test/feed';
const fixture = msg => {
    requests.push(msg);
    requestNumber++;
    if (requestNumber === 2 || (requestNumber >= 4 && requestNumber <= 13)) {
        return { ok: true, status: 304, text: '', url: feedUrl };
    }
    return {
        ok: true, status: 200, text: xml, url: feedUrl, etag: '"v1"',
        lastModified: 'Wed, 01 Jan 2025 00:00:00 GMT', cacheControl: 'public, max-age=3600'
    };
};
const { store, sent, w } = setup({ [feedUrl]: fixture });
store['feeds:subs'] = [{ id: 's1', url: feedUrl, title: 'Conditional', lastFetched: 0, tags: [] }];
store['feeds:settings'] = { refreshMinutes: 15 };
const fm = await imp('modules/feedManager.js');
const ui = { showToast() {}, showScreen() {} };
fm.initFeedManager(ui);
await fm.onFeedsScreenShown(ui);
await tick(80);
assert.equal(requests.length, 1);
assert.equal(requests[0].etag, '');
assert.equal(store['feeds:subs'][0].etag, '"v1"');
assert(store['feeds:subs'][0].nextFetchAt >= now + 3500 * 1000, 'Cache-Control max-age delays another fetch');
const saved = structuredClone(store['feeds:items']);
const unread = w.document.querySelector('[data-status="unread"]')?.textContent;

store['feeds:subs'][0].lastFetched = 0;
store['feeds:subs'][0].nextFetchAt = 0;
await fm.onFeedsScreenShown(ui);
await tick(80);
assert.equal(requests.length, 2);
assert.equal(requests[1].etag, '"v1"');
assert.equal(requests[1].lastModified, 'Wed, 01 Jan 2025 00:00:00 GMT');
assert.deepEqual(store['feeds:items'], saved, '304 leaves feed items and read state unchanged');
assert.equal(w.document.querySelector('[data-status="unread"]')?.textContent, unread, '304 leaves unread count unchanged');

w.document.getElementById('feedRefreshBtn').click();
await tick(80);
assert.equal(requests.length, 3);
assert.equal(requests[2].etag, '', 'forced refresh omits validators');
assert.equal(requests[2].lastModified, '', 'forced refresh omits modified date');
assert(sent.some(message => message.action === 'fetchFeedText'));

for (let i = 0; i < 10; i++) {
    store['feeds:subs'][0].lastFetched = 0;
    store['feeds:subs'][0].nextFetchAt = 0;
    await fm.onFeedsScreenShown(ui);
    await tick(30);
}
assert.equal(store['feeds:subs'][0].validatorFailures, 10, 'consecutive 304s are tracked');
store['feeds:subs'][0].lastFetched = 0;
store['feeds:subs'][0].nextFetchAt = 0;
await fm.onFeedsScreenShown(ui);
await tick(60);
assert.equal(requests[13].etag, '', 'repeated 304s trigger an unconditional full fetch');

const feeds = Array.from({ length: 150 }, (_, index) => ({
    id: `feed-${index}`, url: `https://example.test/${index}`, title: `Feed ${index}`,
    lastFetched: now - 4 * day, tags: [],
    ...(index === 148 ? { slow: true } : {}),
    ...(index === 149 ? { errorCount: 2 } : {})
}));
const libraryItems = [];
for (const index of [...Array.from({ length: 10 }, (_, i) => i), ...Array.from({ length: 10 }, (_, i) => i + 10)]) {
    const frequent = index < 10, feedId = `feed-${index}`;
    libraryItems.push(
        { id: `${feedId}-old`, feedId, title: 'Prior', link: `https://example.test/${index}/old`, published: now - (frequent ? 2 * day : 14 * day), read: frequent },
        { id: `${feedId}-new`, feedId, title: 'Prior', link: `https://example.test/${index}/new`, published: now - (frequent ? 2 * day - 3600000 : 7 * day), read: frequent }
    );
}
let slowFinished = false;
const manyFixtures = Object.fromEntries(feeds.map(feed => [feed.url, async () => {
    if (feed.slow) await new Promise(resolve => setTimeout(resolve, 300));
    if (feed.errorCount) return { ok: false, status: 429, error: 'HTTP 429', retryAfter: '120' };
    const feedIndex = feeds.indexOf(feed);
    const response = {
        ok: true, status: 200, url: feed.url,
        text: `<rss><channel><title>${feed.title}</title><item><guid>${feed.id}-fresh</guid><title>${feedIndex < 10 ? 'Fresh frequent read' : 'Fresh item'} ${feedIndex}</title><link>${feed.url}/fresh</link><pubDate>${new Date(now).toUTCString()}</pubDate></item></channel></rss>`
    };
    if (feed.slow) slowFinished = true;
    return response;
}]));
const many = setup(manyFixtures);
many.store['feeds:subs'] = feeds;
many.store['feeds:items'] = libraryItems;
many.store['feeds:settings'] = { refreshMinutes: 15, smartRefreshOrder: true };
const manyFm = await imp('modules/feedManager.js');
manyFm.initFeedManager(ui);
await manyFm.onFeedsScreenShown(ui);
await tick(100);
const manyRequests = many.sent.filter(message => message.action === 'fetchFeedText').map(message => message.url);
assert(manyRequests.slice(0, 10).every(url => Number(url.split('/').pop()) < 10),
    'frequent/read feeds are first in a 150-feed library');
assert(many.store['feeds:items'].some(item => item.title.startsWith('Fresh frequent read')),
    'new frequent items become visible before all feeds return');
assert(!slowFinished, 'a slow feed does not delay other feeds becoming visible');
for (let i = 0; i < 60 && (!slowFinished || !many.store['feeds:subs'][149].nextFetchAt); i++) await tick(50);
assert.equal(many.store['feeds:subs'].length, 150);
assert(many.store['feeds:subs'][149].nextFetchAt > Date.now(), '429 Retry-After backs off the failed feed');
console.log('TEST 111 OK');
