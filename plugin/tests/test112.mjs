// Local feed processing gives every feed up to 3 topic tags (UI language), planned and run next to rating and recaps.
import assert from 'assert';
import { imp } from './harness.mjs';
const [{ planLibrary, runLibrary, countRequests, needsTopics, evenSample, categoryCounts, TOPIC_SAMPLE }, { boundedLibraryPlan }, { parseTopicTags }] = await Promise.all([
    imp('modules/libraryBatch.js'), imp('modules/feedWorker.js'), imp('modules/feedAi.js')
]);

// Reply parsing: up to 3 distinct short tags from messy local-model output.
assert.deepEqual(parseTopicTags('Tech, Politics, Climate, Sports'), ['Tech', 'Politics', 'Climate']);
assert.deepEqual(parseTopicTags('Tags: #Tech | tech | Klima\n'), ['Tech', 'Klima']);
assert.deepEqual(parseTopicTags('1. Wirtschaft\n2. Politik\n- Sport'), ['Wirtschaft', 'Politik', 'Sport']);
assert.deepEqual(parseTopicTags(''), []);

// Planning: feeds without topics, or with topics in another language, are queued; only when they have items.
const startOfDay = (t) => Math.floor(t / 86400000) * 86400000;
const now = Date.now();
const mk = (id, feedId, k) => ({ id, feedId, title: 'T' + id, published: now - k * 1000, ai: true, cat: 'x' });
const items = [mk('1', 'a', 1), mk('2', 'a', 2), mk('3', 'b', 3), mk('4', 'c', 4)];
const subs = [{ id: 'a' }, { id: 'b', topics: ['Tech'], topicsLang: 'en' }, { id: 'c', topics: ['Tech'], topicsLang: 'de' }, { id: 'd' }];
const base = { items, recaps: {}, source: 'all', inSource: () => true, startOfDay, itemSig: (i) => i.id, today: startOfDay(now) };
const plan = planLibrary({ ...base, subs, topicLang: 'en' });
assert.deepEqual(plan.tag.map(e => e.id), ['a', 'c'], 'a: none yet, c: other language, b: done, d: no items');
assert.deepEqual(plan.tag[0].items.map(i => i.id), ['1', '2'], 'newest first');
assert.equal(plan.tag[0].all.length, 2, 'all stored items of the feed travel along');

// Sample: spread evenly over ALL items (first and last kept), not just the newest.
const long = Array.from({ length: 100 }, (_, k) => k);
const sample = evenSample(long, TOPIC_SAMPLE);
assert.equal(sample.length, TOPIC_SAMPLE); assert.equal(sample[0], 0); assert.equal(sample.at(-1), 99);
assert.equal(new Set(sample).size, TOPIC_SAMPLE, 'no duplicates');
assert.deepEqual(evenSample([1, 2, 3], 30), [1, 2, 3]);
assert.deepEqual(categoryCounts([{ cat: 'Tech' }, { cat: 'Politics' }, { cat: 'Tech' }, {}]), [['Tech', 2], ['Politics', 1]]);
assert.equal(planLibrary(base).tag, undefined, 'no feeds given: no tag step');
assert(!needsTopics({ topics: ['x'], topicsLang: 'en' }, 'en') && needsTopics({ topics: [], topicsLang: 'en' }, 'en'));
assert.equal(countRequests(plan, 20), 2, 'one request per feed to tag');
assert.equal(boundedLibraryPlan({ ...plan, tag: [1, 2, 3, 4] }, 20, 3).tag.length, 2, 'at most 2 per background tick');

// Running: tagFeed is called per feed; a failing feed is counted and skipped.
const seen = [];
const out = await runLibrary(plan, 20, { tagFeed: async (e) => { if (e.id === 'a') throw new Error('bad reply'); seen.push(e.id); } });
assert.deepEqual(seen, ['c']);
assert.equal(out.tagged, 1); assert.equal(out.failed, 1); assert.equal(out.doneRequests, 2);
console.log('TEST 112 OK');
process.exit(0);
