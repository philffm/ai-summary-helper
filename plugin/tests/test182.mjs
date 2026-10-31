// Sync stamps (modules/syncStamps.js): idempotent hash stamping, no deletes inferred, housekeeping never syncs.
import assert from 'assert';
import path from 'path'; import { pathToFileURL } from 'url';
const S = await import(pathToFileURL(path.resolve(process.env.AISH_SRC, 'modules/syncStamps.js')).href);

const ctx = (now, clock = { t: 0 }) => ({ clock, now, device: 'dev-a' });
const entry = { id: 'a1', url: 'https://x.test/1', title: 'T', tags: ['one'], timestamp: '2026-01-01T00:00:00Z', summary: 'S + Q', lastOpened: 'x', qaCount: 1, contentWordCount: 10, favicon: 'f', favorite: true };
const rec = { content: '<p>full</p>', summary: 'S + Q', summaryBase: 'S', conversation: [{ q: 'Why?', a: 'B', pinned: true }], description: 'd', suggested: ['q'] };

// hashing ignores key order and distinguishes values
assert.equal(S.hashValue({ a: 1, b: [1, 2] }), S.hashValue({ b: [1, 2], a: 1 }));
assert.notEqual(S.hashValue({ a: 1 }), S.hashValue({ a: 2 }));
assert.notEqual(S.hashValue(undefined), S.hashValue(null));

// what is synced: derived and local fields stay out, the effective base and the conversation go in
const f = S.syncFields('article', entry, rec);
for (const k of ['lastOpened', 'qaCount', 'contentWordCount', 'favicon', 'summary', 'suggested']) assert.ok(!(k in f), k + ' is not synced');
assert.equal(f.summaryBase, 'S'); assert.equal(f.conversation.length, 1); assert.equal(f.title, 'T'); assert.ok(!('tags' in f) && f['tag:one'] === 'one', 'tags are stamped per element'); assert.equal(f.favorite, true); assert.equal(f.content, '<p>full</p>');
const noConv = S.syncFields('article', { ...entry, summary: 'plain' }, { content: '<p>x</p>', summary: 'plain' });
assert.equal(noConv.summaryBase, 'plain', 'without pinned questions the summary is the base'); assert.ok(!('conversation' in noConv));

// stamping is idempotent: same state twice changes nothing; one field change stamps only that field
const c = { t: 0 };
let r1 = S.stampRecord(undefined, f, ctx(1000, c));
assert.ok(r1.changed && r1.entry.rev.d === 'dev-a' && r1.entry.f.title.t === 1000);
const r2 = S.stampRecord(r1.entry, f, ctx(2000, c));
assert.equal(r2.changed, false); assert.equal(r2.entry, r1.entry);
const edited = S.syncFields('article', { ...entry, tags: ['one', 'two'] }, rec);
const r3 = S.stampRecord(r1.entry, edited, ctx(3000, c));
assert.ok(r3.changed); assert.equal(r3.entry.f['tag:two'].t, 3000); assert.equal(r3.entry.f['tag:one'].t, 1000, 'an existing tag keeps its stamp'); assert.equal(r3.entry.f.title.t, 1000, 'untouched fields keep their stamp');
const removed = S.stampRecord(r3.entry, S.syncFields('article', { ...entry, tags: ['two'] }, rec), ctx(3500, c));
assert.ok(removed.changed && removed.entry.f['tag:one'].t === 3500, 'a removed tag is stamped as removed');
assert.deepEqual(S.collectSet(S.syncFields('article', { ...entry, tags: ['A', 'a', 'B'] }, rec), S.TAG).sort(), ['A', 'B'], 'tags differing only in case are one');
assert.equal(r3.entry.rev.t, 3000);

// an index-only event (record not loaded) says nothing about the record's fields: nothing is cleared
const indexOnly = S.syncFields('article', { ...entry, favorite: true }, null);
for (const k of S.RECORD_SIDE) assert.ok(!(k in indexOnly), k + ' is unknown without the record');
assert.ok(!('summaryBase' in indexOnly), 'the index summary (with pinned questions) is never used as the base');
const idxSkip = { ...ctx(3900, c), skip: S.unknownFields('article', entry, null) };
assert.equal(S.stampRecord(r3.entry, indexOnly, idxSkip).changed, false, 'index-only event: no field cleared');
const favOff = S.stampRecord(r3.entry, S.syncFields('article', { ...entry, favorite: undefined }, null), idxSkip);
assert.ok(favOff.changed && favOff.entry.f.favorite.t > 3000, 'but an index field that was really removed is stamped');

// local-only changes never stamp (opening an article is not a sync event)
const opened = S.syncFields('article', { ...entry, lastOpened: 'later', sentTo: [{ kind: 'kindle' }] }, rec);
assert.equal(S.stampRecord(r1.entry, opened, ctx(4000, c)).changed, false);

// space pruning (content blanked, contentPruned set) is neither an edit nor a delete: the text is "unknown", its stamp stays
const prunedEntry = { ...entry, contentPruned: true }, prunedRec = { ...rec, content: '', contentPruned: true };
const pruned = S.syncFields('article', prunedEntry, prunedRec);
assert.ok(!('content' in pruned));
assert.deepEqual(S.unknownFields('article', prunedEntry, prunedRec), ['content']);
assert.deepEqual(S.unknownFields('article', entry, rec), []);
const afterPrune = S.stampRecord(r1.entry, pruned, { ...ctx(5000, c), skip: S.unknownFields('article', prunedEntry, prunedRec) });
assert.equal(afterPrune.changed, false, 'pruning the text does not stamp anything');
assert.equal(afterPrune.entry.f.content.t, r1.entry.f.content.t, 'the content stamp is kept');
// without the skip the blanked field would look like a deletion: that is exactly what skip prevents
assert.equal(S.stampRecord(r1.entry, pruned, ctx(5000, { t: 4000 })).changed, true);

// the clock is monotonic and follows remote stamps
const clk = { t: 0 };
assert.equal(S.tick(clk, 100), 100); assert.equal(S.tick(clk, 50), 101, 'a slow clock never goes backwards');
S.observe(clk, 5000); assert.equal(S.tick(clk, 200), 5001, 'above everything seen from other devices');
assert.ok(S.compareRev({ t: 1, d: 'a' }, { t: 2, d: 'a' }) < 0); assert.ok(S.compareRev({ t: 2, d: 'b' }, { t: 2, d: 'a' }) > 0);

// tombstones only from the explicit call; stay dead unless resurrected on purpose
const dead = S.tombstone(r1.entry, ctx(6000, c));
assert.ok(dead.changed && dead.entry.deleted);
assert.equal(S.tombstone(dead.entry, ctx(7000, c)).changed, false);
assert.equal(S.stampRecord(dead.entry, f, ctx(8000, c)).changed, false, 'a restore or scan does not resurrect');
const back = S.stampRecord(dead.entry, f, { ...ctx(9000, c), resurrect: true });
assert.ok(back.changed && !back.entry.deleted);

// a scan never creates tombstones: a restored OLDER, SMALLER state gives zero deletions
const stamps = {};
const wrap = (fields) => ({ fields });
const full = { a1: wrap(f), a2: wrap(S.syncFields('article', { id: 'a2', title: 'Two' }, {})), a3: wrap(S.syncFields('article', { id: 'a3', title: 'Three' }, {})) };
const s1 = S.scan(stamps, full, ctx(10000, { t: 0 }));
assert.deepEqual(s1.changedIds.sort(), ['a1', 'a2', 'a3']);
const s2 = S.scan(s1.stamps, { a1: wrap(f) }, ctx(11000, { t: 20000 }));
assert.deepEqual(s2.changedIds, [], 'older, smaller state: nothing changed');
assert.ok(Object.values(s2.stamps).every((e) => !e.deleted), 'and no tombstones');
assert.deepEqual(S.orphans(s2.stamps, ['a1']).sort(), ['a2', 'a3'], 'the engine can ask about them');

// replay and rescan: event path == scan path, and re-running changes nothing
const evClock = { t: 0 }; let viaEvents = {};
for (const [id, fl] of Object.entries(full)) { const r = S.stampRecord(viaEvents[id], fl.fields, ctx(10000, evClock)); if (r.changed) viaEvents[id] = r.entry; }
const viaScan = S.scan({}, full, ctx(10000, { t: 0 })).stamps;
assert.deepEqual(viaEvents, viaScan, 'a full scan after dropped events gives the same stamps');
assert.deepEqual(S.scan(viaScan, full, ctx(99999, { t: 0 })).changedIds, [], 'replaying is a no-op');

// highlights and collections
const hl = { id: 'hl_1', url: 'https://x.test/1', text: 'quote', type: 'user', timestamp: '2026-01-01T00:00:00Z', v: 1 };
const h1 = S.stampRecord(undefined, S.syncFields('highlight', hl), ctx(1, { t: 0 }));
assert.ok(h1.entry.f.text);
assert.equal(S.stampRecord(h1.entry, S.syncFields('highlight', { ...hl, dismissed: true }), ctx(2, { t: 1 })).changed, true, 'dismissed is a change');
const col = { id: 'c1', name: 'N', question: 'Q', created: 'x', updated: 'y', sources: [{ articleId: 'a1' }] };
const cf = S.syncFields('collection', col);
assert.ok(!('updated' in cf) && !('sources' in cf) && cf['src:a1'].articleId === 'a1', 'collection sources are stamped per article');
assert.deepEqual(S.collectSet(cf, S.SRC).map((x) => x.articleId), ['a1']);
// stubs sync: both flags are needed on every device to clean one up
assert.ok(S.syncFields('article', { id: 's', feedStub: true, savedOnly: true }, null).feedStub === true);

console.log('TEST 182 OK');
process.exit(0);
