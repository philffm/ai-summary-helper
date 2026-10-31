// Sync crypto, merge and apply: keys and encrypted files, deterministic merge, merged fields back onto storage (round trip).
import assert from 'assert';
import path from 'path'; import { pathToFileURL } from 'url';
const imp = (m) => import(pathToFileURL(path.resolve(process.env.AISH_SRC, m)).href);
const C = await imp('modules/syncCrypto.js'), M = await imp('modules/syncMerge.js'), A = await imp('modules/syncApply.js'), S = await imp('modules/syncStamps.js');
const FAST = { iterations: 1000 };

// ── crypto ──
const { meta, master, keys } = await C.createMeta('correct horse', FAST);
assert.equal(meta.mode, 'encrypted'); assert.equal(meta.iterations, 1000); assert.ok(!JSON.stringify(meta).includes('correct horse'), 'the passphrase is not in meta.json');
const open = await C.openMeta(meta, { passphrase: 'correct horse' });
assert.deepEqual([...open.master], [...master], 'the same passphrase gives the same key');
await assert.rejects(() => C.openMeta(meta, { passphrase: 'wrong' }), /Wrong passphrase/);
// recovery key: round trip, forgiving input, opens the place without the passphrase
const rk = C.recoveryKeyOf(master); assert.match(rk, /^([A-Z2-7]{4}-)+[A-Z2-7]{1,4}$/);
assert.deepEqual([...C.masterFromRecoveryKey(rk.toLowerCase().replace(/-/g, ' '))], [...master]);
assert.ok((await C.openMeta(meta, { recoveryKey: rk })).keys);
await assert.rejects(() => C.openMeta(meta, { recoveryKey: 'AAAA-BBBB' }), /too short/);
const other = C.recoveryKeyOf(new Uint8Array(32).fill(7)); await assert.rejects(() => C.openMeta(meta, { recoveryKey: other }), /Wrong passphrase/);
await assert.rejects(() => C.openMeta({ mode: 'readable' }, { passphrase: 'x' }), /not an encrypted/);
// files: round trip, random nonce, nothing readable, tampering and a wrong key are caught, big text survives
const value = { id: 'a1', text: 'Grüße 🌍 ' + 'x'.repeat(50000) };
const f1 = await C.encryptJson(keys, value), f2 = await C.encryptJson(keys, value);
assert.deepEqual(await C.decryptJson(keys, f1), value);
assert.notDeepEqual([...f1], [...f2], 'a new nonce every time');
assert.ok(!new TextDecoder('latin1').decode(f1).includes('Grüße'), 'the file is not readable'); assert.ok(f1.length < 2000, 'and it is compressed');
const bad = f1.slice(); bad[bad.length - 5] ^= 1; await assert.rejects(() => C.decryptJson(keys, bad), /wrong passphrase or damaged/);
const wrong = (await C.createMeta('another', FAST)).keys; await assert.rejects(() => C.decryptJson(wrong, f1), /wrong passphrase or damaged/);
await assert.rejects(() => C.decryptJson(keys, new Uint8Array([9, ...f1.slice(1)])), /not a sync file/);
await assert.rejects(() => C.decryptJson(keys, new Uint8Array(5)), /not a sync file/);
// opaque names: stable per key, different per type and id, and different under another key
const n1 = await C.nameOf(keys, 'article', 'a1');
assert.equal(n1, await C.nameOf(keys, 'article', 'a1')); assert.match(n1, /^[0-9a-f]{64}$/);
assert.notEqual(n1, await C.nameOf(keys, 'hl', 'a1')); assert.notEqual(n1, await C.nameOf(keys, 'article', 'a2')); assert.notEqual(n1, await C.nameOf(wrong, 'article', 'a1'));
// the iteration count in meta.json is read back (not assumed)
assert.equal((await C.openMeta({ ...meta }, { passphrase: 'correct horse' })).master.length, 32);

// ── merge ──
const rec = (d, t, fields) => ({ rev: { t, d }, f: Object.fromEntries(Object.entries(fields).map(([k, [tt, v]]) => [k, { t: tt, h: S.hashValue(v) }])), values: Object.fromEntries(Object.entries(fields).map(([k, [, v]]) => [k, v])) });
const a = rec('A', 30, { title: [10, 'Old'], favorite: [30, true], 'tag:x': [10, 'x'] });
const b = rec('B', 40, { title: [40, 'New'], favorite: [5, false], 'tag:y': [40, 'y'] });
let r = M.mergeRecord(a, b);
assert.equal(r.merged.values.title, 'New', 'the newer stamp wins per field'); assert.equal(r.merged.values.favorite, true, 'and per field, not per record');
assert.deepEqual(Object.keys(r.merged.f).sort(), ['favorite', 'tag:x', 'tag:y', 'title'], 'tags added on two devices both survive');
assert.equal(r.merged.rev.t, 40); assert.ok(r.changedLocal && r.changedRemote);
// commutative and idempotent: every device ends in the same state
assert.deepEqual(M.mergeRecord(b, a).merged, r.merged); assert.deepEqual(M.mergeRecord(r.merged, a).merged, r.merged); assert.deepEqual(M.mergeRecord(r.merged, r.merged).merged, r.merged);
assert.equal(M.mergeRecord(r.merged, r.merged).changedLocal, false);
// a tie on time breaks on the device id, the same way on both sides
const t1 = rec('A', 50, { title: [50, 'from A'] }), t2 = rec('B', 50, { title: [50, 'from B'] });
assert.equal(M.mergeRecord(t1, t2).merged.values.title, 'from B'); assert.equal(M.mergeRecord(t2, t1).merged.values.title, 'from B');
// unknown here, or unknown there
assert.equal(M.mergeRecord(null, a).changedLocal, true); assert.deepEqual(M.mergeRecord(null, a).merged, a);
assert.equal(M.mergeRecord(a, null).changedRemote, true);
// deletion: a tombstone beats an older edit, a newer edit brings the record back
const dead = { rev: { t: 35, d: 'B' }, f: {}, deleted: true };
assert.ok(M.mergeRecord(a, dead).merged.deleted, 'older edit loses'); assert.ok(M.mergeRecord(dead, a).merged.deleted);
assert.ok(!M.mergeRecord(rec('A', 60, { title: [60, 'again'] }), dead).merged.deleted, 'a newer edit wins over the tombstone');
assert.ok(M.mergeRecord(dead, dead).merged.deleted);
// a removed element (stamp without a value) stays removed
const gone = { rev: { t: 70, d: 'B' }, f: { 'tag:x': { t: 70, h: S.hashValue(undefined) } }, values: {} };
const kept = M.mergeRecord(a, gone).merged; assert.ok(!('tag:x' in kept.values), 'the removal at 70 beats the tag at 10');
// the inputs are never changed
assert.equal(a.values.title, 'Old'); assert.equal(b.values.title, 'New');

// ── apply: the round trip with syncFields ──
const compose = (base, turns) => base + turns.filter((t) => t.pinned).map((t) => `<q>${t.q}</q>`).join('');
const count = (h) => String(h || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
const hooks = { compose, count };
const entryA = { id: 'a1', url: 'https://x.test/1', title: 'T', timestamp: '2026-01-01T00:00:00Z', tags: ['One', 'two'], favorite: true, archived: false, summary: 'Base<q>Why?</q>', lastOpened: 'local', qaCount: 1, contentWordCount: 2, summaryWordCount: 1 };
const recA = { content: '<p>full text</p>', summary: 'Base<q>Why?</q>', summaryBase: 'Base', conversation: [{ q: 'Why?', a: 'Because', pinned: true }], description: 'd', suggested: ['local only'], meta: { paper: { doi: '10.1/x' } } };
const fieldsA = S.syncFields('article', entryA, recA);
const stampsOf = (fields) => ({ f: Object.fromEntries(Object.keys(fields).map((k) => [k, { t: 1, h: S.hashValue(fields[k]) }])), values: fields });
// a brand new article arriving from another device is complete
const fresh = A.applyFields('article', { entry: null, rec: null }, stampsOf(fieldsA), { ...hooks, id: 'a1' });
assert.deepEqual(S.syncFields('article', fresh.entry, fresh.rec), fieldsA, 'syncFields(apply(syncFields(x))) = syncFields(x)');
assert.equal(fresh.entry.summary, 'Base<q>Why?</q>', 'the shown summary is rebuilt from base + pinned questions'); assert.equal(fresh.rec.summary, fresh.entry.summary);
assert.equal(fresh.entry.qaCount, 1); assert.equal(fresh.entry.contentWordCount, 2); assert.deepEqual(fresh.entry.tags, ['One', 'two']); assert.equal(fresh.entry.archived, false);
assert.ok(!('suggested' in fresh.rec) && !('lastOpened' in fresh.entry), 'local-only fields do not travel');
// an edit applied to an existing article keeps the local-only fields, and the order of tags
const edit = { f: { title: { t: 9, h: 'x' }, 'tag:one': { t: 9, h: 'x' }, 'tag:three': { t: 9, h: 'x' }, favorite: { t: 9, h: 'x' } }, values: { title: 'Changed', 'tag:three': 'three', 'tag:one': 'One' } };
const ed = A.applyFields('article', { entry: entryA, rec: recA }, edit, hooks);
assert.equal(ed.entry.title, 'Changed'); assert.ok(!('favorite' in ed.entry), 'a stamped field without a value is removed'); assert.deepEqual(ed.entry.tags, ['One', 'two', 'three'], 'a tag the merge does not mention stays; a new one is added');
const rmTag = A.applyFields('article', { entry: entryA, rec: recA }, { f: { 'tag:two': { t: 9, h: 'x' } }, values: {} }, hooks); assert.deepEqual(rmTag.entry.tags, ['One'], 'a stamped tag without a value is removed');
assert.equal(ed.entry.lastOpened, 'local'); assert.deepEqual(ed.rec.suggested, ['local only']); assert.equal(ed.rec.content, '<p>full text</p>', 'the text is untouched when the merge does not mention it');
// inputs are not mutated
assert.equal(entryA.title, 'T'); assert.deepEqual(entryA.tags, ['One', 'two']);
// the other device unpins the question: the summary on this device loses the block, the count goes
const unpin = A.applyFields('article', { entry: entryA, rec: recA }, { f: { conversation: { t: 5, h: 'z' } }, values: { conversation: [{ q: 'Why?', a: 'Because', pinned: false }] } }, hooks);
assert.equal(unpin.entry.summary, 'Base'); assert.equal(unpin.entry.qaCount, 1, 'one turn is still in the conversation');
const noConv = A.applyFields('article', { entry: entryA, rec: recA }, { f: { conversation: { t: 6, h: 'z' } }, values: {} }, hooks);
assert.ok(!('qaCount' in noConv.entry) && noConv.entry.summary === 'Base');
// text arrives for an article that only had the stub: the flags that said "no text" go
const stub = A.applyFields('article', { entry: { id: 'a2', title: 'S', contentPruned: true }, rec: { contentPruned: true } }, { f: { content: { t: 1, h: 'x' } }, values: { content: '<p>now here</p>' } }, hooks);
assert.ok(!stub.entry.contentPruned && !stub.rec.contentPruned && stub.entry.contentWordCount === 2);
// highlights, collections, notes
const hl = { id: 'h1', type: 'user', text: 'quote', url: 'https://x.test/1', color: 'y' };
const hf = S.syncFields('highlight', hl); assert.deepEqual(A.applyFields('highlight', null, stampsOf(hf), { id: 'h1' }), hl);
const coll = { id: 'c1', name: 'Reading', updated: 5, sources: [{ articleId: 'a1', note: 'n' }, { articleId: 'a2' }] };
const cf = S.syncFields('collection', coll); const cr = A.applyFields('collection', null, stampsOf(cf), { id: 'c1' });
assert.deepEqual(S.syncFields('collection', cr), cf, 'collections round trip'); assert.equal(cr.sources.length, 2);
const cdrop = A.applyFields('collection', coll, { f: { 'src:a2': { t: 9, h: 'x' } }, values: {} }); assert.deepEqual(cdrop.sources.map((s) => s.articleId), ['a1'], 'a removed source goes');
const note = { id: 'n1', text: 'Ask Anna', tags: ['todo', 'Later'], url: 'https://x.test/1', created: 1 };
const nf = S.syncFields('note', note); const nr = A.applyFields('note', null, stampsOf(nf), { id: 'n1' });
assert.deepEqual(S.syncFields('note', nr), nf, 'notes round trip'); assert.deepEqual(nr.tags, ['todo', 'Later']);
// the whole way: merge two devices' versions, apply the result, and both devices end with the same synced fields
const devA = { ...stampsOf({ ...fieldsA, title: 'A title' }), rev: { t: 20, d: 'A' } }, devB = { ...stampsOf({ ...fieldsA, title: 'B title', 'tag:new': 'new' }), rev: { t: 20, d: 'B' } };
devA.f.title.t = 10; devB.f.title.t = 12; devB.f['tag:new'].t = 12;
const mAB = M.mergeRecord(devA, devB).merged, mBA = M.mergeRecord(devB, devA).merged;
const onA = A.applyFields('article', { entry: entryA, rec: recA }, mAB, hooks), onB = A.applyFields('article', { entry: entryA, rec: recA }, mBA, hooks);
assert.deepEqual(S.syncFields('article', onA.entry, onA.rec), S.syncFields('article', onB.entry, onB.rec), 'both devices converge');
assert.equal(onA.entry.title, 'B title'); assert.ok(onA.entry.tags.includes('new'));

console.log('TEST 199 OK');
process.exit(0);
