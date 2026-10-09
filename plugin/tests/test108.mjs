// Background alarm fetches feeds, requires Ollama, and resumes within a three-request tick budget.
import assert from 'assert';
import fs from 'fs';
import { imp } from './harness.mjs';
const src = fs.readFileSync(process.env.AISH_SRC + '/background.js', 'utf8');
const start = src.indexOf("const FEED_ALARM = 'feedPoll';");
const end = src.indexOf('// ── One-shot AI completion', start);
assert(start >= 0 && end > start, 'background feed worker block found');
const block = src.slice(start, end);
const [{ parseWorkerFeed, mergeWorkerItems, boundedLibraryPlan, estimateFeedInterval, feedPriority, feedQualityWeight }, { planLibrary, runLibrary, chunksOf }, { startOfDay }] = await Promise.all([
    imp('modules/feedWorker.js'), imp('modules/libraryBatch.js'), imp('modules/dateUtils.js')
]);
let aiCalls = 0, fetchCalls = 0, notifications = 0;
const fetchHeaders = [];
const rss = `<rss><channel>${Array.from({ length: 35 }, (_, i) =>
    `<item><guid>guid-${i}</guid><title>Headline ${i}</title><link>https://example.test/${i}</link><pubDate>${new Date().toUTCString()}</pubDate></item>`
).join('')}</channel></rss>`;
const worker = {
    parseWorkerFeed, mergeWorkerItems, boundedLibraryPlan, estimateFeedInterval, feedPriority, feedQualityWeight,
    planLibrary, runLibrary, chunksOf, startOfDay,
    itemSig: item => item.id, hash: value => value,
    scoreItems: async items => {
        aiCalls++;
        return { scores: items.map(() => 0.5), labels: items.map(() => 'News') };
    },
    generateRecap: async () => ({}), generateRecapUpdate: async () => ({})
};
const SK = {
    feedSubs: 'feeds:subs', feedItems: 'feeds:items', feedRecaps: 'feeds:recaps', feedBackground: 'feeds:background',
    feedBgSeen: 'feeds:bgSeen', feedPending: 'feeds:pending', feedSettings: 'feeds:settings',
    articlesIndex: 'articles:index', servicesConfig: 'config:services'
};

function makeBackground(initial, localMode = true) {
    const store = structuredClone(initial);
    const alarms = [];
    const chrome = {
        storage: {
            local: {
                get: async keys => {
                    if (typeof keys === 'string') return { [keys]: store[keys] };
                    if (Array.isArray(keys)) return Object.fromEntries(keys.filter(key => key in store).map(key => [key, store[key]]));
                    return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [key, key in store ? store[key] : fallback]));
                },
                set: async values => Object.assign(store, structuredClone(values))
            },
            sync: { get: async () => localMode ? { connectionMode: 'local', activeService: 'ollama' } : { connectionMode: 'cloud', activeService: 'openai' } }
        },
        alarms: { clear: async name => { alarms.push(['clear', name]); }, create: (name, config) => alarms.push(['create', name, config]) },
        action: { setBadgeBackgroundColor: async () => {}, setBadgeText: async () => {} },
        notifications: { create: async () => { notifications++; } }
    };
    const localGet = async keys => chrome.storage.local.get(keys);
    const run = new Function('chrome', 'localGet', 'SK', 'FEED_WORKER', 'sumJobsReady', 'updateSumBadge',
        `${block}\nreturn { pollFeeds, applyFeedPollConfig };`)(chrome, localGet, SK, worker, async () => {}, async () => {});
    return { run, store, alarms };
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
    fetchCalls++;
    fetchHeaders.push(options.headers || {});
    const notModified = options.headers && options.headers['If-None-Match'] === '"bg-v1"';
    return {
        ok: !notModified, status: notModified ? 304 : 200, url,
        headers: { get: name => name.toLowerCase() === 'etag' ? '"bg-v1"' : name.toLowerCase() === 'last-modified' ? 'Wed, 01 Jan 2025 00:00:00 GMT' : '' },
        text: async () => rss
    };
};
try {
    const sub = { id: 's1', url: 'https://example.test/feed', title: 'Example' };
    const settings = { autoProcess: true, backgroundPoll: false, autoProcessMinutes: 15, libraryBatch: 10, keepDays: 30 };
    const bg = makeBackground({ 'feeds:subs': [sub], 'feeds:items': [], 'feeds:settings': settings });
    await bg.run.applyFeedPollConfig();
    assert.deepEqual(bg.alarms[1], ['create', 'feedPoll', { delayInMinutes: 1, periodInMinutes: 15 }]);
    await bg.run.pollFeeds();
    assert.equal(aiCalls, 3, 'first alarm makes no more than three AI requests');
    assert.equal(bg.store['feeds:background'].items.length, 35, 'new items stored by the worker');
    assert.equal(Object.keys(bg.store['feeds:background'].ratings).length, 30, 'only the bounded work is processed this tick');
    assert.equal(bg.store['feeds:subs'][0].etag, '"bg-v1"', 'background poll stores response validators');
    bg.store['feeds:background'].status.at = 0;
    bg.store['feeds:subs'][0].lastFetched = 0;
    await bg.run.pollFeeds();
    assert.equal(fetchHeaders[1]['If-None-Match'], '"bg-v1"', 'background poll sends validators');
    assert.equal(bg.store['feeds:background'].items.length, 35, '304 does not parse or replace background items');
    assert.equal(aiCalls, 4, 'the next tick resumes from stored ratings');
    assert.equal(Object.keys(bg.store['feeds:background'].ratings).length, 35);
    assert(Object.keys(bg.store['feeds:background'].recaps).length > 0, 'same-day items receive a background recap');
    assert.equal(notifications, 2, 'finished runs notify with their result');

    const beforeFetches = fetchCalls;
    const cloud = makeBackground({ 'feeds:subs': [sub], 'feeds:items': [], 'feeds:settings': settings }, false);
    await cloud.run.pollFeeds();
    assert.equal(fetchCalls, beforeFetches, 'automatic feed processing does no work without Ollama');
    assert.equal(aiCalls, 4);

    const stopped = makeBackground({ 'feeds:settings': { autoProcess: false, backgroundPoll: false } });
    await stopped.run.applyFeedPollConfig();
    assert.equal(stopped.alarms.length, 1, 'stopping automatic processing clears the alarm');
} finally {
    globalThis.fetch = originalFetch;
}
console.log('TEST 108 OK');
