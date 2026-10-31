// The delete paths write sync tombstones (only when sync is on); clearAllArticles, a reset, writes none.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
const { store, w } = setup({});
globalThis.document = w.document; globalThis.window = w;
const K = await imp('modules/storageKeys.js');
const C = await imp('modules/collections.js');
const SM = (await imp('modules/storageManager.js')).default;
const { createStampStore } = await imp('modules/syncStampStore.js');
const { SK, articleRecKey } = K;
const st = createStampStore({ storage: chrome.storage.local });

const seed = () => {
    store[SK.articlesIndex] = ['a1', 'a2', 'a3'].map((id) => ({ id, url: 'https://x.test/' + id, title: id, timestamp: '2026-01-01T00:00:00Z', tags: [], summary: 's' }));
    for (const id of ['a1', 'a2', 'a3']) store[articleRecKey(id)] = { content: 'c', summary: 's' };
};

// sync off: deleting works and writes no stamps
seed();
await SM.deleteArticle('a1');
assert.deepEqual(await st.all(), {});

// sync on
store[SK.syncPlaces] = [{ id: 'p1', enabled: true }];
await SM.deleteArticle('a2');
assert.ok((await st.all())['article:a2'].deleted, 'deleteArticle writes a tombstone');
seed();
await SM.deleteArticles(['a1', 'a3', 'nope']);
const all = await st.all();
assert.ok(all['article:a1'].deleted && all['article:a3'].deleted);
assert.ok(!('article:nope' in all), 'unknown ids are not stamped');

const c = await C.createCollection({ name: 'X' });
await C.deleteCollection(c.id);
assert.ok((await st.all())['coll:' + c.id].deleted, 'deleteCollection writes a tombstone');

// reset-style delete: no markers (the engine asks about orphans instead)
seed();
for (const k of Object.keys(store)) if (k.startsWith('sync:stamps:')) delete store[k];
await SM.clearAllArticles();
assert.deepEqual(await st.all(), {}, 'clearAllArticles writes no tombstones');

console.log('TEST 185 OK');
process.exit(0);
