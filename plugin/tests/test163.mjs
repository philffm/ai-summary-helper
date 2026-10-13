// Collections: storage, limits, no dead references, source profile/hints, check progress, Markdown.
import { setup, imp } from './harness.mjs'; import assert from 'assert';
const { store, w } = setup({});
globalThis.document = w.document; globalThis.window = w;
const K = await imp('modules/storageKeys.js');
const C = await imp('modules/collections.js');
const SM = (await imp('modules/storageManager.js')).default;
const { SK, articleRecKey, collRecKey } = K;

// articles to collect
store[SK.articlesIndex] = ['a1', 'a2', 'a3'].map((id, i) => ({ id, url: `https://site${i}.test/x`, title: 'Title ' + id, timestamp: '2026-01-0' + (i + 1) + 'T00:00:00Z', summary: '<p>Sum ' + id + '</p>', tags: [] }));
for (const id of ['a1', 'a2', 'a3']) store[articleRecKey(id)] = { content: '<p>text</p>' };

// create / list / update
assert.rejects(C.createCollection({ name: '   ' }));
const c1 = await C.createCollection({ name: '  Climate   policy ', question: 'Does it   work?' });
assert.equal(c1.name, 'Climate policy'); assert.equal(c1.question, 'Does it work?');
const c2 = await C.createCollection({ name: 'Second' });
assert.deepEqual((await C.listCollections()).map(e => e.name).sort(), ['Climate policy', 'Second']);
await C.updateCollection(c1.id, { question: 'Is it effective?' });
assert.equal((await C.getCollection(c1.id)).question, 'Is it effective?');
assert.equal((await C.listCollections()).find(e => e.id === c1.id).question, 'Is it effective?', 'index follows the record');

// add: remembers last used, no duplicates, parallel adds do not overwrite each other
assert.deepEqual(await C.addSource(c1.id, 'a1'), { ok: true, added: true });
assert.deepEqual(await C.addSource(c1.id, 'a1'), { ok: true, added: false });
assert.equal(await C.lastCollectionId(), c1.id);
await Promise.all([C.addSource(c1.id, 'a2'), C.addSource(c1.id, 'a3'), C.addSource(c2.id, 'a1')]);
assert.deepEqual((await C.getCollection(c1.id)).sources.map(s => s.articleId).sort(), ['a1', 'a2', 'a3']);
assert.equal(await C.lastCollectionId(), c2.id, 'the add that ran last wins');
assert.deepEqual((await C.collectionsOfArticle('a1')).map(c => c.name).sort(), ['Climate policy', 'Second'], 'one article in several collections');
assert.equal((await C.addSource('nope', 'a1')).reason, 'missing');

// limit
const big = await C.createCollection({ name: 'Big' });
for (let i = 0; i < C.MAX_SOURCES; i++) await C.addSource(big.id, 'x' + i);
assert.deepEqual(await C.addSource(big.id, 'overflow'), { ok: false, reason: 'full' });

// removing a source keeps the article; deleting an article removes it everywhere
await C.removeSource(c1.id, 'a3');
assert.ok(store[articleRecKey('a3')], 'article stays');
await SM.deleteArticle('a1');
assert.deepEqual((await C.getCollection(c1.id)).sources.map(s => s.articleId), ['a2']);
assert.deepEqual((await C.getCollection(c2.id)).sources, []);
assert.equal((await C.listCollections()).find(e => e.id === c1.id).n, 1, 'index count follows');

// deleting a collection leaves articles alone and clears "last used"
await C.addSource(c1.id, 'a2');
await C.deleteCollection(c1.id);
assert.ok(!(collRecKey(c1.id) in store)); assert.ok(store[articleRecKey('a2')]);
assert.equal(await C.lastCollectionId(), '');

// profile: derived, then the reader's edits win
const art = { url: 'https://www.example.org/news/1', meta: { author: 'Jo Doe', published: '2019-03-04' }, title: 'T' };
assert.deepEqual(C.deriveProfile(art), { type: '', author: 'Jo Doe', date: '2019-03-04', publisher: 'example.org' });
await C.saveSourceProfile('a2', { type: 'news', author: 'Ed', date: '2026-02-01', publisher: 'Daily' });
const full = (await C.collectionArticles({ sources: [{ articleId: 'a2' }] }))[0];
assert.deepEqual(C.effectiveProfile(full), { type: 'news', author: 'Ed', date: '2026-02-01', publisher: 'Daily' });

// hints (no ratings)
const now = Date.UTC(2026, 9, 13);
assert.deepEqual(C.profileHints({ author: '', date: '2019-01-01', type: 'preprint' }, now).sort(), ['no_author', 'old', 'preprint']);
assert.deepEqual(C.profileHints({ author: 'A', date: '2025-06-01', type: 'news' }, now), []);
assert.ok(C.profileHints({ author: 'A', date: '', type: '' }, now).includes('no_date'));

// check: stored on the article, progress counts non-blank answers
await C.saveSourceCheck('a2', { who: 'A ministry', others: '  ', origin: 'Press release', missing: '' });
assert.deepEqual(C.checkProgress(store[articleRecKey('a2')].sourceCheck), { answered: 2, total: 4, done: false });
await C.saveSourceCheck('a2', { who: 'x', others: 'x', origin: 'x', missing: 'x' });
assert.equal(C.checkProgress(store[articleRecKey('a2')].sourceCheck).done, true);

// markdown
const md = C.collectionMarkdown({ name: 'Climate', question: 'Does it work?' }, [{ ...full, sourceCheck: { who: 'A ministry' } }], { label: (k) => k });
assert.ok(md.startsWith('# Climate\n\n> Does it work?'));
assert.ok(md.includes('## 1. [Title a2](https://site1.test/x)') && md.includes('Daily') && md.includes('- q_who: A ministry'));
assert.ok(C.collectionMarkdown({ name: 'C' }, [{ title: 'Old', url: 'https://a.test', timestamp: '2019-01-01T00:00:00Z' }], { label: (k) => k }).includes('hint_no_author'));
console.log('ok');
