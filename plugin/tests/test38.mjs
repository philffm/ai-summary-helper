import { setup, imp } from './harness.mjs'; import assert from 'assert';
const { store } = setup({});
chrome.storage.local.getBytesInUse = (keys, cb) => cb(keys.reduce((n, k) => n + (k in store ? k.length + JSON.stringify(store[k]).length : 0), 0));
const { default: SM } = await imp('modules/storageManager.js');
// already migrated (flag = 2) but an old build wrote the legacy array again
store.articlesSchemaVersion = 2;
store.articlesIndex = [{ id: 'article_1_a', title: 'Kept', url: 'https://x/1', timestamp: '2026-01-01T00:00:00.000Z', tags: [] }];
store['article:article_1_a'] = { content: 'c1', summary: 's1', description: '' };
store.articles = [
  { title: 'Kept', url: 'https://x/1', timestamp: '2026-01-01T00:00:00.000Z', content: 'c1', summary: 's1' },
  { title: 'Late', url: 'https://x/2', timestamp: '2026-02-02T00:00:00.000Z', content: 'c2', summary: 's2', tags: ['t'] }
];
assert.equal(await SM.hasLegacyArticles(), true);
await SM.migrateArticlesToIndexedRecords();
assert(!('articles' in store), 'legacy blob removed');
assert.equal(store.articlesIndex.length, 2, 'merged without duplicating');
const late = store.articlesIndex.find(a => a.title === 'Late');
assert(late && store[`article:${late.id}`].content === 'c2', 'record written');
assert.equal(await SM.hasLegacyArticles(), false);
// nothing legacy → no-op
const before = JSON.stringify(store.articlesIndex);
await SM.migrateArticlesToIndexedRecords();
assert.equal(JSON.stringify(store.articlesIndex), before);
console.log('TEST 38 OK');
