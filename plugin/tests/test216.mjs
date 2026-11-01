// What the Android app uploads (a page it saved itself, a passage it marked) must land in the extension as a normal article and highlight.
// The values below have exactly the shape PhoneUploader.kt writes (see PhoneUploaderTest.kt).
import assert from 'assert';
import path from 'path'; import { pathToFileURL } from 'url';
const imp = (m) => import(pathToFileURL(path.resolve(process.env.AISH_SRC, m)).href);
const { applyFields } = await imp('modules/syncApply.js');
const { articleKey } = await imp('modules/syncIdentity.js');
const merged = (values) => ({ f: Object.fromEntries(Object.keys(values).map((k) => [k, { t: 1, h: 'x' }])), values });

const article = { id: 'ph_a1', url: 'https://phone.example/post', title: 'A page from the phone', timestamp: '2023-11-14T22:13:20Z',
    content: '<h1>Title</h1><p>Body &lt;b&gt;&amp; more&lt;/b&gt;.</p><ul><li>one</li></ul><blockquote><p>Quote</p></blockquote>', summaryBase: '<p>Intro.</p><ul><li>point a</li></ul>' };
const { entry, rec } = applyFields('article', null, merged(article), { count: (h) => String(h).replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length, compose: (base) => base });
assert.equal(entry.id, 'ph_a1'); assert.equal(entry.url, article.url); assert.equal(entry.title, article.title); assert.equal(entry.timestamp, article.timestamp);
assert.equal(entry.archived, false, 'arrives in the inbox like any new article');
assert.equal(rec.content, article.content, 'the full text sits in the record, not the lean entry'); assert.ok(!('content' in entry));
assert.equal(entry.summary, article.summaryBase, 'the shown summary is rebuilt from the base'); assert.ok(entry.contentWordCount > 0);
assert.ok(Number.isFinite(Date.parse(entry.timestamp)), 'a date the extension can sort by');

const hl = applyFields('highlight', null, merged({ id: 'ph_9f2c', url: article.url, text: 'Prices rose faster than wages', type: 'user', timestamp: '2023-11-14T22:13:20Z' }), {});
assert.deepEqual([hl.id, hl.url, hl.text, hl.type], ['ph_9f2c', article.url, 'Prices rose faster than wages', 'user']);

// the same identity rule on both sides: what the phone treats as "the library already has this page" is what the extension merges
for (const [a, b] of [['https://www.econ.example/post/', 'https://econ.example/post'], ['http://econ.example/post?utm_source=x&fbclid=1', 'https://econ.example/post'], ['https://econ.example/post#s', 'https://econ.example/post']]) assert.equal(articleKey(a), articleKey(b), `${a} ≙ ${b}`);
assert.notEqual(articleKey('https://econ.example/post?id=2'), articleKey('https://econ.example/post'));
assert.equal(articleKey('https://econ.example/'), '', 'a bare site address is not an article (the phone returns the same)');
console.log('TEST 216 OK');
