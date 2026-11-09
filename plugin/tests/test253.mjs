// StorageManager.initialize() moves highlights from the old single list to one key per page (with the other startup migrations), and the popup's readers see the same highlights before and after.
import { setup, imp, SRC } from './harness.mjs'; import assert from 'assert'; import fs from 'fs';
const { store } = setup({});
chrome.runtime.getURL = (p) => 'chrome-extension://abc/' + p;
// a separate, empty sync area (the harness shares one object for both; the startup's sync cleanup would delete the local keys)
const syncStore = {};
chrome.storage.sync = { get: (k, cb) => { const o = {}; if (cb) cb(o); return Promise.resolve(o); }, set: (o, cb) => { Object.assign(syncStore, o); if (cb) cb(); return Promise.resolve(); }, remove: (k, cb) => { if (cb) cb(); return Promise.resolve(); } };
globalThis.fetch = async (u) => { const f = SRC + '/' + String(u).replace('chrome-extension://abc/', ''); return { ok: true, json: async () => JSON.parse(fs.readFileSync(f, 'utf8')) }; };   // packaged files (services.json)
store['hl:all'] = [
  { id: 'a', url: 'https://www.youtube.com/watch?v=abc', text: 'video note', type: 'user', timestamp: '2026-11-01T00:00:00Z' },
  { id: 'b', url: 'https://example.com/post', text: 'post note', type: 'ghost', timestamp: '2026-11-02T00:00:00Z' },
];
store['articles:index'] = [{ id: 'p1', url: 'https://example.com/post', title: 'Post', timestamp: '2026-11-02T00:00:00Z' }];
const { fetchAnnotationsForArticle } = await imp('modules/annotationExporter.js');
const before = await fetchAnnotationsForArticle({ url: 'https://example.com/post?utm_source=x' });
assert.deepEqual(before.map((h) => h.id), ['b'], 'old list: the reader finds it');
const { default: StorageManager } = await imp('modules/storageManager.js');
await StorageManager.initialize();
assert.equal(store['hl:schema'], 2, 'migrated on startup');
assert(!('hl:all' in store), 'old list gone');
assert.deepEqual(store['hl:page:https://www.youtube.com/watch?v=abc'].map((h) => h.id), ['a']);
assert.deepEqual(store['hl:page:https://example.com/post'].map((h) => h.id), ['b']);
const after = await fetchAnnotationsForArticle({ url: 'https://example.com/post?utm_source=x' });
assert.deepEqual(after.map((h) => h.id), ['b'], 'per-page keys: the same reader finds the same highlight');
await StorageManager.initialize();
assert.equal(Object.keys(store).filter((k) => k.startsWith('hl:page:')).length, 2, 'a second start changes nothing');
console.log('TEST 253 OK');
