// Worker feed parser handles RSS/Atom, CDATA, relative links, duplicate IDs, and bounded request plans.
import assert from 'assert';
import { imp } from './harness.mjs';
const [{ parseWorkerFeed, feedItemId, mergeWorkerItems, boundedLibraryPlan }, { hash }] = await Promise.all([
    imp('modules/feedWorker.js'), imp('modules/feedHash.js')
]);
const sub = { id: 'source-1' };
const now = Date.UTC(2026, 9, 9);
const rss = `<rss><channel><item>
  <guid>stable-guid</guid><title><![CDATA[Feed <b>headline</b>]]></title>
  <link>/story?a=1&amp;b=2</link><pubDate>Fri, 09 Oct 2026 10:00:00 GMT</pubDate>
  <description><![CDATA[<p>CDATA <b>snippet</b></p>]]></description>
  <enclosure url="../audio/episode.mp3" type="audio/mpeg"/><duration>1:02</duration>
</item></channel></rss>`;
const parsed = parseWorkerFeed(rss, 'https://example.test/rss/feed.xml', sub, now);
assert.equal(parsed.length, 1);
assert.equal(parsed[0].id, hash('source-1|stable-guid'));
assert.equal(parsed[0].id, feedItemId(sub, parsed[0]), 'worker id matches feed manager hash formula');
assert.equal(parsed[0].title, 'Feed headline');
assert.equal(parsed[0].snippet, 'CDATA snippet');
assert.equal(parsed[0].link, 'https://example.test/story?a=1&b=2');
assert.equal(parsed[0].audio, 'https://example.test/audio/episode.mp3');
assert.equal(parsed[0].dur, 62);
assert.equal(parseWorkerFeed(rss, 'https://example.test/rss/feed.xml', sub, now)[0].id, parsed[0].id, 'repeated feeds deduplicate by stable id');
const duplicateFeed = rss.replace('</channel>', rss.match(/<item>[\s\S]*?<\/item>/)[0] + '</channel>');
assert.equal(parseWorkerFeed(duplicateFeed, 'https://example.test/rss/feed.xml', sub, now).length, 1, 'duplicate entries collapse by id');

const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
  <id>tag:example.test,2026:2</id><title><![CDATA[Atom &amp; news]]></title>
  <link rel="alternate" href="../story/2"/><updated>2026-10-09T09:30:00Z</updated>
  <summary><![CDATA[<p>Atom <em>summary</em></p>]]></summary>
  <link rel="enclosure" href="../audio/2.ogg" type="audio/ogg"/>
</entry></feed>`;
const atomItem = parseWorkerFeed(atom, 'https://example.test/feeds/current.xml', sub, now)[0];
assert.equal(atomItem.title, 'Atom & news');
assert.equal(atomItem.link, 'https://example.test/story/2');
assert.equal(atomItem.audio, 'https://example.test/audio/2.ogg');
assert.equal(atomItem.published, Date.parse('2026-10-09T09:30:00Z'));
const namespacedAtom = atom.replaceAll('<feed ', '<atom:feed ').replaceAll('</feed>', '</atom:feed>')
    .replaceAll('<entry>', '<atom:entry>').replaceAll('</entry>', '</atom:entry>');
assert.equal(parseWorkerFeed(namespacedAtom, 'https://example.test/feeds/current.xml', sub, now).length, 1);

const relativeDate = parseWorkerFeed('<rss><item><title>New</title><link>https://example.test/new</link><pubDate>yesterday</pubDate></item></rss>', 'https://example.test/feed', sub, now)[0];
assert.equal(relativeDate.published, now, 'unparseable/relative dates fall back to fetch time');
const retained = mergeWorkerItems([], [
    { id: 'expired', published: now - 3 * 86400000 },
    { id: 'favorite', published: now - 3 * 86400000, favorite: true },
    { id: 'current', published: now }
], 1, now, 1);
assert.deepEqual(retained.map(item => item.id).sort(), ['current', 'favorite'], 'retention and total cap preserve favorites');

const plan = boundedLibraryPlan({ rate: Array.from({ length: 100 }, (_, id) => ({ id })), days: [] }, 10, 3);
assert.equal(plan.rate.length, 30);
assert.ok(Math.ceil(plan.rate.length / 10) <= 3, 'bounded plan has at most three AI requests');
const withRecaps = boundedLibraryPlan({ rate: [], days: Array.from({ length: 4 }, (_, day) => ({ day, todo: Array.from({ length: 25 }, (_, id) => ({ id })) })) }, 10, 3);
assert.ok(withRecaps.days.reduce((n, day) => n + Math.ceil(day.todo.length / 10), 0) <= 3);
const feedAi = await imp('modules/feedAi.js');
let transportService = '';
feedAi.setAiTransport(async request => {
    transportService = request.service;
    return '{"scores":[0.5],"labels":["Tech"]}';
});
const scored = await feedAi.scoreItems([{ title: 'Local story', snippet: '' }], () => 'Source', { service: 'ollama' });
assert.deepEqual(scored, { scores: [0.5], labels: ['Tech'] });
assert.equal(transportService, 'ollama', 'worker can route shared feed AI logic directly without messaging itself');
feedAi.setAiTransport(null);
console.log('TEST 106 OK');
