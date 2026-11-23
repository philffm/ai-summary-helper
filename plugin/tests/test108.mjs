// Background alarm fetches feeds, requires Ollama, and resumes within a three-request tick budget.
import { bgSource } from './bgSource.mjs';
import assert from 'assert';
import fs from 'fs';
import { imp } from './harness.mjs';
const src = bgSource();
const start = src.indexOf("const FEED_ALARM = 'feedPoll';");
const end = src.indexOf('// ── One-shot AI completion', start);
assert(start >= 0 && end > start, 'background feed worker block found');
const block = src.slice(start, end);
const [{ parseWorkerFeed, mergeWorkerItems, boundedLibraryPlan, estimateFeedInterval, feedPriority, feedQualityWeight }, { planLibrary, runLibrary, categoryCounts, chunksOf }, { startOfDay }] = await Promise.all([
    imp('modules/feedWorker.js'), imp('modules/libraryBatch.js'), imp('modules/dateUtils.js')
]);
let aiCalls = 0, topicCalls = 0, fetchCalls = 0, notifications = 0;
const fetchHeaders = [];
const rss = `<rss><channel>${Array.from({ length: 35 }, (_, i) =>
    `<item><guid>guid-${i}</guid><title>Headline ${i}</title><link>https://example.test/${i}</link><pubDate>${new Date().toUTCString()}</pubDate></item>`
).join('')}</channel></rss>`;
const worker = {
    parseWorkerFeed, mergeWorkerItems, boundedLibraryPlan, estimateFeedInterval, feedPriority, feedQualityWeight,
    planLibrary, runLibrary, categoryCounts, chunksOf, startOfDay,
    saveFeedBodies: async () => 0, pruneFeedBodies: async () => 0,   // full text storage has its own test (test180)
    itemSig: item => item.id, hash: value => value,
    scoreItems: async items => {
        aiCalls++;
        return { scores: items.map(() => 0.5), labels: items.map(() => 'News') };
    },
    generateRecap: async () => ({}), generateRecapUpdate: async () => ({}),
    uiLanguage: async () => ({ code: 'en', name: 'English' }), loadLexicon: async () => {}, saveLexicon: async () => {},
    learnTagNames: async () => 0, setAiDetail: () => {},
    generateFeedTopics: async () => { topicCalls++; return { tags: ['News', 'World'], lang: 'en' }; }
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
    const settings = { autoProcess: true, backgroundPoll: false, autoProcessMinutes: 15, libraryBatch: 10, keepDays: 30, rateWithRecap: false };   // separate rating requests: the tick budget below counts them
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

    // Default (rateWithRecap on): today's items are rated by their recap call, so no separate rating request is sent for them.
    const before = aiCalls;
    const merged = makeBackground({ 'feeds:subs': [sub], 'feeds:items': [], 'feeds:settings': { ...settings, rateWithRecap: undefined } });
    await merged.run.pollFeeds();
    assert.equal(aiCalls, before, 'no separate rating request for items that the day recap rates');
    assert(Object.keys(merged.store['feeds:background'].recaps).length > 0, 'the recap still runs');

    // Without Ollama (the usual case) the alarm still checks feeds and KEEPS what it finds: the popup merges feeds:background
    // on open. (Before, only Ollama setups stored items, while the stored lastFetched/ETag made the popup skip the feed or get a
    // 304, so new items never reached the list.) The first check of a feed is the baseline (no badge); later ones count.
    {
        let n = 3;
        const feed = () => `<rss><channel>${Array.from({ length: n }, (_, i) => `<item><guid>p-${i}</guid><title>Post ${i}</title><link>https://plain.test/${i}</link><pubDate>${new Date().toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
        const prevFetch = globalThis.fetch;
        globalThis.fetch = async (url) => ({ ok: true, status: 200, url, headers: { get: () => '' }, text: async () => feed() });
        try {
            const plain = makeBackground({ 'feeds:subs': [{ id: 'p1', url: 'https://plain.test/feed', title: 'Plain' }], 'feeds:items': [], 'feeds:settings': { backgroundPoll: true, keepDays: 30 } }, false);
            await plain.run.pollFeeds();
            assert.equal(plain.store['feeds:background'].items.length, 3, 'stored without Ollama');
            assert.equal(plain.store['feeds:pending'] || 0, 0, 'first check is the baseline');
            n = 5; plain.store['feeds:subs'][0].lastFetched = 0;
            await plain.run.pollFeeds();
            assert.equal(plain.store['feeds:background'].items.length, 5);
            assert.equal(plain.store['feeds:pending'], 2, 'two new items for the badge');
            assert(!plain.store['feeds:background'].ratings || !Object.keys(plain.store['feeds:background'].ratings).length, 'nothing rated without Ollama');
            // a pull the user asked for (home page button) fetches a feed that is not due yet, and even with background polling switched off
            n = 6; plain.store['feeds:subs'][0].nextFetchAt = Date.now() + 3600000; plain.store['feeds:settings'].backgroundPoll = false;
            await plain.run.pollFeeds();
            assert.equal(plain.store['feeds:background'].items.length, 5, 'not due and polling off: nothing is fetched on its own');
            await plain.run.pollFeeds({ force: true });
            assert.equal(plain.store['feeds:background'].items.length, 6, 'forced: fetched now');
        } finally { globalThis.fetch = prevFetch; }
    }

    // every FEED_WORKER.<name> the worker scripts call exists in the real bundle (test fakes above cannot catch a missing export)
    {
        const bundle = fs.readFileSync(new URL('../src/modules/feedBackgroundBundle.js', import.meta.url), 'utf8');
        const api = new Set((bundle.match(/export const API = \{([\s\S]*?)\};/) || [])[1].split(/[\s,]+/).filter(Boolean));
        const used = new Set();
        for (const f of ['../src/background.js', '../src/bg/feedPoll.js', '../src/bg/aiComplete.js']) for (const m of fs.readFileSync(new URL(f, import.meta.url), 'utf8').matchAll(/FEED_WORKER\.(\w+)/g)) used.add(m[1]);
        const missing = [...used].filter(n => !api.has(n));
        assert.deepEqual(missing, [], 'feed worker bundle exports everything the worker calls');
    }

    const stopped = makeBackground({ 'feeds:settings': { autoProcess: false, backgroundPoll: false } });
    await stopped.run.applyFeedPollConfig();
    assert.equal(stopped.alarms.length, 1, 'stopping automatic processing clears the alarm');
} finally {
    globalThis.fetch = originalFetch;
}
console.log('TEST 108 OK');
