// Stamp store: stamps follow storage changes, tombstones only from markDeleted, scans catch up, nothing happens with sync off.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
const { store } = setup({});
const K = await imp('modules/storageKeys.js');
const { createStampStore } = await imp('modules/syncStampStore.js');
const { SK, articleRecKey, collRecKey } = K;

let clock = 1000;
const st = createStampStore({ storage: chrome.storage.local, now: () => (clock += 10) });

const entry = (id, extra = {}) => ({ id, url: 'https://x.test/' + id, title: 'T ' + id, timestamp: '2026-01-01T00:00:00Z', tags: ['one'], favorite: false, summary: 'S', ...extra });
const change = (key, oldValue, newValue) => ({ [key]: { oldValue, newValue } });

// sync off: nothing is written
assert.equal(await st.onChanged(change(SK.articlesIndex, [], [entry('a1')])), 0);
assert.deepEqual(await st.all(), {});
assert.equal(await st.markDeleted('article', ['a1']), 0);
assert.equal(await st.scan(), 0);
assert.ok(!(SK.syncDeviceId in store), 'no device id until sync is on');

store[SK.syncConfig] = { enabled: true };

// a new index entry is stamped; the device id is created once and kept
assert.equal(await st.onChanged(change(SK.articlesIndex, [], [entry('a1')])), 1);
let all = await st.all();
assert.ok(all['article:a1'].f.title && all['article:a1'].f['tag:one'], 'index-side fields stamped');
assert.ok(!('summaryBase' in all['article:a1'].f), 'record fields unknown without the record');
const dev = store[SK.syncDeviceId]; assert.ok(/^d_/.test(dev));
assert.equal(all['article:a1'].rev.d, dev);
assert.ok(store[SK.syncClock].t >= 1010);

// same state again: no-op. Local-only change (lastOpened): no-op. Real change: only that field moves.
assert.equal(await st.onChanged(change(SK.articlesIndex, [entry('a1')], [entry('a1')])), 0);
assert.equal(await st.onChanged(change(SK.articlesIndex, [entry('a1')], [entry('a1', { lastOpened: 'now' })])), 0);
const before = (await st.all())['article:a1'];
assert.equal(await st.onChanged(change(SK.articlesIndex, [entry('a1')], [entry('a1', { favorite: true })])), 1);
const after = (await st.all())['article:a1'];
assert.ok(after.f.favorite.t > before.f.favorite.t && after.f.title.t === before.f.title.t);

// a record event stamps only record-side fields and never clears index-side ones
const rec = { content: '<p>full</p>', summary: 'S + Q', summaryBase: 'S', conversation: [{ q: 'Q', a: 'A', pinned: true }], description: 'd' };
assert.equal(await st.onChanged(change(articleRecKey('a1'), undefined, rec)), 1);
let a1 = (await st.all())['article:a1'];
assert.ok(a1.f.summaryBase && a1.f.conversation && a1.f.content && a1.f.description);
assert.ok(a1.f.title && a1.f['tag:one'] && a1.f.favorite, 'index-side stamps survive a record event');
// space pruning rewrites the record without text: not a change
assert.equal(await st.onChanged(change(articleRecKey('a1'), rec, { ...rec, content: '', contentPruned: true })), 0);
// removing the record or the index entry is not a deletion
assert.equal(await st.onChanged(change(articleRecKey('a1'), rec, undefined)), 0);
assert.equal(await st.onChanged(change(SK.articlesIndex, [entry('a1', { favorite: true })], [])), 0);
assert.ok(!(await st.all())['article:a1'].deleted, 'a missing record is not a tombstone');

// highlights (by id) and collections (sources per article)
const hl = { id: 'hl_1', url: 'https://x.test/a1', text: 'quote', type: 'user', timestamp: '2026-01-01T00:00:00Z' };
assert.equal(await st.onChanged(change(SK.annotations, [], [hl])), 1);
assert.equal(await st.onChanged(change(SK.annotations, [hl], [{ ...hl, dismissed: true }])), 1);
assert.equal(await st.onChanged(change(SK.annotations, [hl], [])), 0, 'removing a highlight from the array is not a tombstone by itself');
const coll = { id: 'c1', name: 'N', question: 'Q', updated: 'u', sources: [{ articleId: 'a1' }] };
assert.equal(await st.onChanged(change(collRecKey('c1'), undefined, coll)), 1);
assert.ok((await st.all())['coll:c1'].f['src:a1']);

// explicit deletion: the only tombstone; stays dead through later events
assert.equal(await st.markDeleted('article', ['a1']), 1);
assert.ok((await st.all())['article:a1'].deleted);
assert.equal(await st.markDeleted('article', ['a1']), 0, 'already deleted');
assert.equal(await st.onChanged(change(SK.articlesIndex, [], [entry('a1')])), 0, 'a later event does not resurrect');
assert.equal(await st.markDeleted('hl', ['hl_1']), 1); assert.equal(await st.markDeleted('coll', ['c1']), 1);

// scan catches up after missed events, never creates tombstones, is idempotent
for (const k of Object.keys(store)) if (k.startsWith('sync:stamps:')) delete store[k];   // pretend the worker was killed before any event
store[SK.articlesIndex] = [entry('b1'), entry('b2', { tags: ['x', 'y'] })];
store[articleRecKey('b1')] = { content: '<p>b1</p>', summary: 'S', description: '' };
store[SK.annotations] = [{ id: 'hl_9', url: 'https://x.test/b1', text: 'q', type: 'ghost', timestamp: 't' }, { url: 'u', text: 'no id' }];
store[SK.collIndex] = [{ id: 'c9' }]; store[collRecKey('c9')] = { id: 'c9', name: 'Nine', sources: [] };
const scanned = await st.scan();
all = await st.all();
assert.deepEqual(Object.keys(all).sort(), ['article:b1', 'article:b2', 'coll:c9', 'hl:hl_9'], 'highlights without an id wait for the backfill');
assert.ok(all['article:b1'].f.content, 'unstamped records are read by the default scan');
assert.ok(Object.values(all).every((e) => !e.deleted), 'a scan never makes tombstones');
assert.ok(scanned >= 4);
assert.equal(await st.scan(), 0, 'scanning again changes nothing');
assert.equal(await st.scan({ full: true }), 0, 'neither does a full scan');
// a restored smaller library: stamps of missing records stay, nothing is deleted
store[SK.articlesIndex] = [entry('b1')];
assert.equal(await st.scan({ full: true }), 0);
assert.ok((await st.all())['article:b2'], 'the stamp of a record that is gone is kept (the engine asks)');

console.log('TEST 184 OK');
process.exit(0);
