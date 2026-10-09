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
const subs = [{ id: 'a' }, { id: 'b', topics: ['Tech'], topicsLang: 'en' }, { id: 'c', topics: ['Bundesliga'], topicsLang: 'de' }, { id: 'd' }];
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

// Multilingual topics: the same topic in another language is the same tag.
const { conceptKey, topicLabel, conceptList, CONCEPTS } = await imp('modules/topicConcepts.js');
assert.equal(conceptKey('News'), conceptKey('Nachrichten')); assert.equal(conceptKey('Noticias'), conceptKey('новости'));
assert.equal(conceptKey('Wirtschaft'), conceptKey('Economics')); assert.equal(conceptKey('Économie'), conceptKey('business'));
assert.notEqual(conceptKey('News'), conceptKey('Politik'));
assert.equal(conceptKey(' Fußball '), conceptKey('fußball'), 'unknown tags compare as text');
assert.notEqual(conceptKey('Bundesliga'), conceptKey('News'));
assert.equal(topicLabel('Economics', 'de'), 'Wirtschaft'); assert.equal(topicLabel('Nachrichten', 'en'), 'News'); assert.equal(topicLabel('Bundesliga', 'de'), 'Bundesliga');
assert.equal(topicLabel('News', 'ja'), 'ニュース'); assert.equal(topicLabel('News', 'zh_HK'), '新聞');
assert.equal(conceptList('de').length, Object.keys(CONCEPTS).length);
for (const [id, byLocale] of Object.entries(CONCEPTS)) for (const l of ['en', 'de', 'es', 'fr', 'it', 'pt_PT', 'ru', 'hi', 'ko', 'ja', 'zh_CN', 'zh_TW', 'zh_HK', 'ar']) assert(byLocale[l] && byLocale[l].length, `${id} has a label for ${l}`);
assert.deepEqual(parseTopicTags('News, Nachrichten, Wirtschaft, Economics, Sport'), ['News', 'Wirtschaft', 'Sport'], 'cross-language duplicates collapse');
// A feed whose tags are all known topics is not re-tagged when the UI language changes (it is just shown in the new language).
assert(!needsTopics({ topics: ['News', 'Wirtschaft'], topicsLang: 'de' }, 'en'));
assert(needsTopics({ topics: ['News', 'Bundesliga'], topicsLang: 'de' }, 'en'));

// AI-named topics: "tag = English name" pairs give every tag a language-independent key.
const { parseTopicPairs, translateFeedTopics, setAiTransport } = await imp('modules/feedAi.js');
assert.deepEqual(parseTopicPairs('Fußball = Football, Wirtschaft = Economy, Economics, Nachrichten = News, Politik'),
    [{ label: 'Fußball', en: 'football' }, { label: 'Wirtschaft', en: 'economy' }, { label: 'Nachrichten', en: 'news' }], 'pairs, max 3; Economics dedupes against Wirtschaft');
assert.deepEqual(parseTopicPairs('Tech, Politics'), [{ label: 'Tech', en: '' }, { label: 'Politics', en: '' }], 'plain tags still work');
// Language change: known topics from the dictionary, the rest from ONE short translation request.
const asked = [];
setAiTransport(async ({ system, user }) => { asked.push(user); return 'Fußball'; });
const tr = await translateFeedTopics(['football', 'economy']);
assert.deepEqual(asked, ['football'], 'only the unknown topic is sent');
assert.equal(tr.tags.length, 2); assert.equal(tr.tags[1], 'Economy'); assert.equal(tr.tags[0], 'Fußball');
const plan2 = planLibrary({ ...base, subs: [{ id: 'a', topics: ['Fußball'], topicKeys: ['football'], topicsLang: 'de' }, { id: 'b', topics: ['X'], topicsLang: 'de' }], topicLang: 'en' });
assert.deepEqual(plan2.tag.map(e => [e.id, e.keys || null]), [['a', ['football']], ['b', null]], 'keys → translate only; no keys → look at the feed again');

// History / graph / analytics / search: the same topic in other languages is one topic.
const { normalizeTag, buildCanonicalTagMap, applyCanonicalTags } = await imp('modules/tagIntelligence.js');
assert.equal(normalizeTag('Nachrichten'), normalizeTag('News'));
const arts = [{ tags: ['News', 'Wirtschaft'] }, { tags: ['Nachrichten', 'News'] }, { tags: ['Economics'] }];
const cmap = buildCanonicalTagMap(arts);
assert.deepEqual(applyCanonicalTags(['News', 'Nachrichten'], cmap), ['News'], 'merge tool folds languages');
const { tagMatches } = await imp('modules/topicConcepts.js');
assert(tagMatches('News', 'nachrichten') && tagMatches('Tech news', 'news') && !tagMatches('Sport', 'nachrichten'));
console.log('TEST 112 OK');
process.exit(0);
