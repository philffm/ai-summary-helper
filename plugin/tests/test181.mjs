// Article index writes are serialized (no lost updates) and every delete path cleans collection references.
import { setup, imp } from './harness.mjs'; import assert from 'assert';
const { store, w } = setup({});
globalThis.document = w.document; globalThis.window = w;
const K = await imp('modules/storageKeys.js');
const C = await imp('modules/collections.js');
const SM = (await imp('modules/storageManager.js')).default;
const { SK, articleRecKey } = K;

const seed = () => {
    store[SK.articlesIndex] = ['a1', 'a2', 'a3', 'a4'].map((id, i) => ({ id, url: `https://site${i}.test/x`, title: 'T ' + id, timestamp: '2026-01-0' + (i + 1) + 'T00:00:00Z', tags: [], summary: 's' }));
    for (const id of ['a1', 'a2', 'a3', 'a4']) store[articleRecKey(id)] = { content: '<p>text</p>', summary: 's' };
};
seed();
const byId = (id) => store[SK.articlesIndex].find((a) => a.id === id);

// Parallel edits on different articles all land (each used to rewrite the whole array from a stale read).
await Promise.all([
    SM.setTags('a1', ['one']),
    SM.toggleFavorite('a2'),
    SM.setTitle('a3', 'Renamed'),
    SM.setArticleArchived('a4', true),
    SM.patchArticleStatus(['a1'], { read: true }),
    SM.touchArticleOpened('a2'),
]);
assert.deepEqual(byId('a1').tags, ['one']);
assert.ok(byId('a1').readAt, 'status patch on the same article as a tag edit');
assert.equal(byId('a2').favorite, true);
assert.ok(byId('a2').lastOpened);
assert.equal(byId('a3').title, 'Renamed');
assert.equal(byId('a4').archived, true);

// A conversation save (record + index) and a collection source profile (record) do not overwrite each other.
const coll = await C.createCollection({ name: 'Test' });
await C.addSource(coll.id, 'a1');
await Promise.all([
    SM.saveConversation('a1', [{ q: 'Why?', a: 'Because.', pinned: true }]),
    C.saveSourceProfile('a1', { type: 'news', author: 'Ann', date: '2026-01-01', publisher: 'P' }),
]);
const rec = store[articleRecKey('a1')];
assert.equal(rec.conversation.length, 1, 'conversation kept');
assert.equal(rec.sourceProfile.author, 'Ann', 'source profile kept');

// Deleting several articles at once removes index entries, records and collection references.
await C.addSource(coll.id, 'a2');
await C.addSource(coll.id, 'a3');
await SM.deleteArticles(['a2', 'a3']);
assert.deepEqual(store[SK.articlesIndex].map((a) => a.id).sort(), ['a1', 'a4']);
assert.ok(!(articleRecKey('a2') in store) && !(articleRecKey('a3') in store));
assert.deepEqual((await C.getCollection(coll.id)).sources.map((s) => s.articleId), ['a1'], 'no dead references');
assert.deepEqual(await SM.deleteArticles([]), 0, 'empty list is a no-op');
assert.equal(await SM.deleteArticles(['nope']), 0, 'unknown ids are ignored');

// Single delete still works and keeps the same cleanup.
await C.addSource(coll.id, 'a4');
await SM.deleteArticle('a4');
assert.deepEqual((await C.getCollection(coll.id)).sources.map((s) => s.articleId), ['a1']);

console.log('TEST 181 OK');
process.exit(0);
