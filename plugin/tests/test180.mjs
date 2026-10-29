// Feed full text: both parsers keep it from content:encoded / Atom content, it is stored per item under its own keys, and old ones are swept.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
const { store } = setup({});
const { parseWorkerFeed } = await imp('modules/feedWorker.js');
const { parseFeed } = await imp('modules/feedParse.js');
const { saveFeedBodies, getFeedBody, pruneFeedBodies, FEED_BODY, FEED_BODY_INDEX } = await imp('modules/feedBodies.js');

const long = '<p>' + 'Full article text. '.repeat(40) + '</p><img src="https://a.test/i.png">';
const rss = `<rss><channel><title>T</title><item><title>Long</title><link>https://a.test/1</link><guid>1</guid>
  <description>Short teaser.</description><content:encoded xmlns:content="http://purl.org/rss/1.0/modules/content/"><![CDATA[${long}]]></content:encoded></item>
  <item><title>Short</title><link>https://a.test/2</link><guid>2</guid><description>Only a teaser.</description></item></channel></rss>`;
const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>T</title><entry><title>A</title><link href="https://a.test/3"/><id>3</id>
  <summary>Short.</summary><content type="html">${long.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</content></entry></feed>`;

const w = parseWorkerFeed(rss, 'https://a.test/feed', { id: 's' });
assert.equal(w.length, 2);
assert.ok(w[0].body.includes('Full article text.') && w[0].body.includes('<img'), 'worker keeps the HTML of content:encoded');
assert.equal(w[1].body, '', 'a teaser alone is not a body');
assert.ok(w[0].snippet.length <= 220, 'the snippet stays short');
assert.ok(parseWorkerFeed(atom, 'https://a.test/feed', { id: 's' })[0].body.includes('<p>Full article text.'), 'worker decodes Atom content');

const p = parseFeed(rss, 'https://a.test/feed');
assert.ok(p.items[0].body.includes('Full article text.'), 'popup parser keeps content:encoded');
assert.equal(p.items[1].body, '');
assert.ok(parseFeed(atom, 'https://a.test/feed').items[0].body.includes('Full article text.'), 'popup parser keeps Atom content');

// per-item keys, only new items are written, the sweep drops old ones
const now = Date.now(), day = 86400e3;
assert.equal(await saveFeedBodies([{ id: 'a', html: '<p>A</p>', published: now }, { id: 'b', html: '<p>B</p>', published: now - 40 * day }, { id: 'c', html: '' }]), 2);
assert.equal(await saveFeedBodies([{ id: 'a', html: '<p>changed</p>', published: now }]), 0, 'a stored item is not rewritten');
assert.equal(await getFeedBody('a'), '<p>A</p>');
assert.ok(store[FEED_BODY + 'a'] && store[FEED_BODY_INDEX].a);
assert.equal(await pruneFeedBodies(now - 30 * day), 1);
assert.equal(await getFeedBody('b'), '');
assert.equal(await getFeedBody('a'), '<p>A</p>');
console.log('TEST 180 OK');
