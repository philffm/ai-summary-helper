// Feeds with a full list (feeds:items is several MB): a refresh saves at most once per interval instead of once per feed, a write
// leaves the list out when it did not change, and quick actions in a row share one write.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';

const now = Date.now();
const feeds = Array.from({ length: 30 }, (_, i) => ({ id: `f${i}`, url: `https://example.test/${i}`, title: `Feed ${i}`, lastFetched: 0, tags: [] }));
const old = feeds.flatMap((f, i) => [0, 1].map(k => ({ id: `${f.id}-${k}`, feedId: f.id, title: `Old ${i}.${k}`, link: `${f.url}/${k}`, published: now - (k + 1) * 3600000, read: false })));
const rss = (f, i) => `<rss><channel><title>${f.title}</title><item><guid>${f.id}-fresh</guid><title>Fresh ${i}</title><link>${f.url}/fresh</link><pubDate>${new Date(now).toUTCString()}</pubDate></item></channel></rss>`;
let unchanged = false;
const fixtures = Object.fromEntries(feeds.map((f, i) => [f.url, async () => {
    await new Promise(r => setTimeout(r, 5 + (i % 4) * 5));
    return unchanged ? { ok: true, status: 304, text: '', url: f.url } : { ok: true, status: 200, text: rss(f, i), url: f.url };
}]));
const { store } = setup(fixtures);
store['feeds:subs'] = feeds; store['feeds:items'] = old; store['feeds:settings'] = { refreshMinutes: 15 };
const writes = [];
const set = chrome.storage.local.set;
chrome.storage.local.set = (o, cb) => { writes.push(Object.keys(o)); return set(o, cb); };

const fm = await imp('modules/feedManager.js');
const ui = { showToast() {}, showScreen() {} };
fm.initFeedManager(ui);
await fm.onFeedsScreenShown(ui);
for (let i = 0; i < 80 && !feeds.every((f, k) => (store['feeds:items'] || []).some(x => x.title === `Fresh ${k}`)); i++) await tick(50);
assert.equal(store['feeds:items'].filter(x => x.title.startsWith('Fresh')).length, 30, 'every feed’s new item is stored');
const itemWrites = writes.filter(k => k.includes('feeds:items')).length;
assert(itemWrites >= 1 && itemWrites <= 6, `the list is written a few times, not once per feed (${itemWrites})`);

// a refresh that brings nothing new saves the feeds (fetch times, ETags) but leaves the list out
unchanged = true; writes.length = 0;
document.getElementById('feedRefreshBtn').click();
for (let i = 0; i < 80 && (writes.length === 0 || document.getElementById('feedRefreshBtn').disabled); i++) await tick(50);
await tick(50);
assert(writes.some(k => k.includes('feeds:subs')), 'feeds saved');
assert(!writes.some(k => k.includes('feeds:items')), 'unchanged list not written again');

// marking several items read in a row: the writes made while one runs are shared
writes.length = 0;
const btns = [...document.querySelectorAll('button')].filter(b => b.textContent === 'Mark read').slice(0, 4);
assert(btns.length >= 3, 'mark-read buttons');
btns.forEach(b => b.click());
await tick(100);
const reads = store['feeds:items'].filter(x => x.read).length;
assert(reads >= btns.length, 'all marks saved: ' + reads);
assert(writes.filter(k => k.includes('feeds:items')).length <= 2, 'clicks in a row share writes: ' + writes.length);
console.log('TEST 263 OK');
process.exit(0);
