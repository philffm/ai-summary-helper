// Readable format: Article JSON v1 + _sync, the include mask, the place filter, library.json.
import assert from 'assert';
import path from 'path'; import { pathToFileURL } from 'url';
const R = await import(pathToFileURL(path.resolve(process.env.AISH_SRC, 'modules/syncReadable.js')).href);

const entry = (id, extra = {}) => ({ id, url: 'https://x.test/' + id, title: 'Title ' + id, timestamp: '2026-03-0' + id.slice(-1) + 'T00:00:00Z', tags: ['public', 'ai'], summary: 'S', favorite: true, decisionReason: 'private note', ...extra });
const rec = { content: '<p>FULL TEXT</p>', summary: '<p>Summary</p>', summaryBase: '<p>Summary</p>', conversation: [{ q: 'Why?', a: 'Because.', pinned: true }], sourceCheck: { notes: 'secret' } };
const hl = [{ id: 'hl_1', url: 'https://x.test/a1', text: 'a highlight', type: 'user', timestamp: '2026-03-01T00:00:00Z' }];

// paths are safe and stable
assert.equal(R.articlePath('article_1_ab'), 'articles/article_1_ab.json');
assert.equal(R.articlePath('../x/y'), 'articles/.._x_y.json');
assert.equal(R.LIBRARY_PATH, 'library.json');

// filter: tag, excludeTag, none; stubs never
assert.ok(R.placeMatches(entry('a1'), { filter: { tag: 'Public' } }), 'tag match ignores case');
assert.ok(!R.placeMatches(entry('a1', { tags: ['ai'] }), { filter: { tag: 'public' } }));
assert.ok(!R.placeMatches(entry('a1'), { filter: { excludeTag: 'public' } }));
assert.ok(R.placeMatches(entry('a1', { tags: ['ai'] }), { filter: { excludeTag: 'private' } }));
assert.ok(R.placeMatches(entry('a1'), {}), 'no filter = everything');
assert.ok(!R.placeMatches(entry('a1', { feedStub: true }), {}) && !R.placeMatches(entry('a1', { savedOnly: true }), {}));
assert.ok(!R.placeMatches(null, {}) && !R.placeMatches({}, {}));

// the file: v1 view, highlights by default, Q&A only when included, never the full text, notes, or source check
const place = { mode: 'readable', filter: { tag: 'public' } };
const f = R.buildArticleFile({ entry: entry('a1'), rec, highlights: hl, place, rev: { t: 5, d: 'dev' } });
assert.equal(f.aish, 'article/1'); assert.equal(f.id, 'a1'); assert.equal(f.title, 'Title a1'); assert.deepEqual(f.tags, ['public', 'ai']);
assert.equal(f.highlights.length, 1); assert.ok(!('qa' in f), 'Q&A is off by default');
assert.deepEqual(f._sync, { v: 1, rev: { t: 5, d: 'dev' } });
const json = JSON.stringify(f);
for (const secret of ['FULL TEXT', 'private note', 'secret', 'favorite']) assert.ok(!json.includes(secret), secret + ' is not published');
const withQa = R.buildArticleFile({ entry: entry('a1'), rec, highlights: hl, place: { include: { qa: true } } });
assert.equal(withQa.qa.length, 1);
const noHl = R.buildArticleFile({ entry: entry('a1'), rec, highlights: hl, place: { include: { highlights: false } } });
assert.equal(noHl.highlights.length, 0, 'highlights are a switch');

// library.json: no _sync, no blocks, newest first, counts
const files = [R.buildArticleFile({ entry: entry('a1'), rec, highlights: hl, place }), R.buildArticleFile({ entry: entry('a3'), rec: null, highlights: [], place })];
const lib = R.buildLibrary(files, { now: () => '2026-10-31T00:00:00Z' });
assert.equal(lib.aish, 'library/1'); assert.equal(lib.count, 2); assert.equal(lib.generatedAt, '2026-10-31T00:00:00Z');
assert.deepEqual(lib.articles.map((a) => a.id), ['a3', 'a1'], 'newest first');
assert.ok(lib.articles.every((a) => !('_sync' in a) && !('blocks' in a)));
assert.equal(lib.articles[1].summary.md.length > 0, true, 'the whole summary is in the list');
assert.ok(R.toJson(lib).endsWith('\n'));

// config hash: changes with mode, include and filter only
const h = R.configHash(place);
assert.equal(h, R.configHash({ ...place, name: 'renamed', url: 'https://other' }), 'name and address do not matter');
assert.notEqual(h, R.configHash({ ...place, filter: { tag: 'other' } }));
assert.notEqual(h, R.configHash({ ...place, include: { qa: true } }));
assert.notEqual(h, R.configHash({ ...place, mode: 'encrypted' }));

console.log('TEST 186 OK');
process.exit(0);
