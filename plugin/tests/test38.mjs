// Storage migration: legacy articles array, already-migrated flag, nothing-to-do case.
import { setup, imp } from './harness.mjs'; import assert from 'assert';
const { store } = setup({});
chrome.storage.local.getBytesInUse = (keys, cb) => cb(keys.reduce((n, k) => n + (k in store ? k.length + JSON.stringify(store[k]).length : 0), 0));
const { default: SM } = await imp('modules/storageManager.js');
// already migrated (flag = 2) but an old build wrote the legacy array again
store['articles:schema'] = 2;
store['articles:index'] = [{ id: 'article_1_a', title: 'Kept', url: 'https://x/1', timestamp: '2026-01-01T00:00:00.000Z', tags: [] }];
store['articles:rec:article_1_a'] = { content: 'c1', summary: 's1', description: '' };
store.articles = [
  { title: 'Kept', url: 'https://x/1', timestamp: '2026-01-01T00:00:00.000Z', content: 'c1', summary: 's1' },
  { title: 'Late', url: 'https://x/2', timestamp: '2026-02-02T00:00:00.000Z', content: 'c2', summary: 's2', tags: ['t'] }
];
assert.equal(await SM.hasLegacyArticles(), true);
await SM.migrateArticlesToIndexedRecords();
assert(!('articles' in store), 'legacy blob removed');
assert.equal(store['articles:index'].length, 2, 'merged without duplicating');
const late = store['articles:index'].find(a => a.title === 'Late');
assert(late && store[`articles:rec:${late.id}`].content === 'c2', 'record written');
assert.equal(await SM.hasLegacyArticles(), false);
// nothing legacy → no-op
const before = JSON.stringify(store['articles:index']);
await SM.migrateArticlesToIndexedRecords();
assert.equal(JSON.stringify(store['articles:index']), before);
console.log('TEST 38 OK');
