// Restoring a large library: written in pieces into local storage, article lists last, and a refused write is an error.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
setup({});
const { restoreChunks, writeRestored } = await imp('modules/backupUtils.js');
const data = { 'articles:index': [{ id: 'a' }], 'feeds:body:x': 'y'.repeat(900), 'home:prefs': {} };
for (let i = 0; i < 120; i++) data[`articles:rec:${i}`] = { content: 'z'.repeat(1000) };

const chunks = restoreChunks(data, 10_000, 50);
assert.ok(chunks.length > 10, 'cut into pieces');
assert.ok(chunks.every((c) => Object.keys(c).length <= 50 && JSON.stringify(c).length < 13_000));
assert.deepEqual(chunks.flatMap(Object.keys).sort(), Object.keys(data).sort(), 'every key exactly once');
assert.ok('articles:index' in chunks.at(-1), 'the list comes last');
assert.equal(restoreChunks({ big: 'x'.repeat(50_000) }, 10_000).length, 1, 'a single large value still goes through');
assert.deepEqual(restoreChunks({}), []);

const seen = [];
const ok = { set(chunk, done) { seen.push(Object.keys(chunk).length); done(); } };
const progress = [];
await writeRestored(data, { area: ok, onProgress: (i, n) => progress.push([i, n]) });
assert.equal(seen.reduce((a, b) => a + b, 0), Object.keys(data).length);
assert.deepEqual(progress.at(-1), [progress.length, progress.length]);

let calls = 0;
const full = { set(chunk, done) { calls++; chrome.runtime.lastError = { message: 'QUOTA_BYTES exceeded' }; done(); chrome.runtime.lastError = null; } };
await assert.rejects(writeRestored(data, { area: full }), /QUOTA_BYTES/, 'a full store is not a success');
assert.equal(calls, 1, 'it stops at the first refusal');
await assert.rejects(writeRestored(data, { area: { set: () => Promise.reject(new Error('no space')) } }), /no space/);
console.log('test289 ok');
process.exit(0);
