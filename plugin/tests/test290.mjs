// A browser that cannot list storage keys (Safari) must never load the whole library to show settings or measure storage.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
const { store } = setup({});
let readAll = 0;
const local = chrome.storage.local, get = local.get;
// the harness shares one store between sync and local: give sync its own empty one, and count whole-store reads of local
chrome.storage.sync = { get: (keys, cb) => { if (cb) cb({}); return Promise.resolve({}); }, set: local.set, remove: (k, cb) => { if (cb) cb(); return Promise.resolve(); } };
chrome.storage.local = { ...local, getKeys: undefined, get: (keys, cb) => { if (keys === null || keys === undefined) readAll++; return get(keys, cb); } };
const { default: StorageManager } = await imp('modules/storageManager.js');
const { SK, articleRecKey } = await imp('modules/storageKeys.js');
const H = await imp('modules/storageHealth.js');

const index = [];
for (let i = 0; i < 60; i++) { index.push({ id: `a${i}`, url: `https://x.test/${i}`, timestamp: '2020-01-01T00:00:00Z', contentWordCount: 5000 }); store[articleRecKey(`a${i}`)] = { content: `<p>text</p><img src="data:image/png;base64,${'A'.repeat(400)}">`, summary: 's' }; }
store[SK.articlesIndex] = index;
store[SK.servicesConfig] = { openai: { endpoint: 'e' } };

const settings = await StorageManager.getSettings();
assert.deepEqual(settings[SK.servicesConfig], { openai: { endpoint: 'e' } }, 'settings are there');
assert.ok(!(SK.articlesIndex in settings) && !(articleRecKey('a0') in settings), 'the library is not');

const scan = await H.scanCleanup(index);
assert.equal(scan.images.n, 60);
assert.equal((await H.removeSavedImages(index)).n, 60);
assert.ok(!store[articleRecKey('a59')].content.includes('base64'));
const dropped = await H.dropPageText(index, ['a1', 'a41'], SK.articlesIndex);
assert.equal(dropped.n, 2);
assert.equal(store[articleRecKey('a41')].content, '');
assert.equal(store[SK.articlesIndex].filter((a) => a.contentPruned).length, 2);
// sync stamps are read after every package of a run: by name, and all of them are found
const { createStampStore } = await imp('modules/syncStampStore.js');
store[SK.syncPlaces] = [{ id: 'p1', enabled: true }];
const stamps = createStampStore({ storage: chrome.storage.local });
await stamps.scan({ full: true });
const all = await stamps.all();
assert.equal(Object.keys(all).filter((k) => k.startsWith('article:')).length, 60, 'every stamp, whatever its shard');
// with a key list (Chrome) the shards that are really there are taken, whatever their name
store['sync:stamps:legacy-name'] = { 'article:old': { rev: { t: 1, d: 'd' }, f: {}, deleted: true } };
chrome.storage.local.getKeys = async () => Object.keys(store);
assert.ok((await createStampStore({ storage: chrome.storage.local }).all())['article:old'], 'no stamp or deletion marker is overlooked');
assert.equal(readAll, 0, 'nothing read the whole local storage');
console.log('test290 ok');
process.exit(0);
