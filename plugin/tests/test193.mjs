// Notes store: notes and comments, no lost writes, routing, backup, deletion markers; the highlight array is never touched.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
const { store, w } = setup({});
globalThis.document = w.document; globalThis.window = w;
const K = await imp('modules/storageKeys.js');
const N = await imp('modules/notesStore.js');
const SS = await imp('modules/syncStampStore.js');
const SM = (await imp('modules/storageManager.js')).default;
const R = await imp('modules/dataReset.js');
const B = await imp('modules/backupUtils.js');
const { SK, noteRecKey, isNoteRecKey, NOTES_REC } = K;

assert.equal(noteRecKey('x'), 'notes:rec:x'); assert.ok(isNoteRecKey('notes:rec:y')); assert.ok(!isNoteRecKey('notes:index'));
assert.equal(SM.isLocalKey('notes:rec:abc'), true, 'notes are local data, never sync storage');
assert.deepEqual(R.uncoveredKeys(), [], 'the notes index belongs to a delete category');

const ns = N.createNotesStore({ storage: chrome.storage.local });
store[SK.annotations] = [{ id: 'hl_1', url: 'https://x.test/a', text: 'quote', type: 'user', timestamp: '2026-03-01T00:00:00Z' }];
const hlBefore = JSON.stringify(store[SK.annotations]);

// add: cleaned, indexed, empty text refused
assert.equal(await ns.add({ text: '   ' }), null);
const n1 = await ns.add({ text: '  Ask Anna about the cap  ', tags: ['#todo', 'Todo', 'inflation', ''], url: 'https://x.test/a', quote: 'the cap' });
assert.equal(n1.text, 'Ask Anna about the cap'); assert.deepEqual(n1.tags, ['todo', 'inflation'], 'hash removed, duplicates by case dropped');
assert.equal(n1.kind, 'note'); assert.ok(/^n_/.test(n1.id)); assert.equal(n1.created, n1.updated);
assert.deepEqual(store[SK.notesIndex].map((e) => e.id), [n1.id]); assert.equal(store[noteRecKey(n1.id)].text, 'Ask Anna about the cap');
assert.equal((await ns.add({ text: 'x'.repeat(30000) })).text.length, N.MAX_TEXT, 'long text is capped');

// parallel adds: nothing is lost from the index
await Promise.all(Array.from({ length: 12 }, (_, i) => ns.add({ text: 'parallel ' + i })));
assert.equal(store[SK.notesIndex].length, 14); assert.equal(new Set(store[SK.notesIndex].map((e) => e.id)).size, 14);

// update: text, tags, link; a note cannot be emptied (delete it instead)
let u = await ns.update(n1.id, { text: 'Changed', tags: ['x'] });
assert.equal(u.text, 'Changed'); assert.deepEqual(u.tags, ['x']); assert.ok(u.updated >= u.created);
assert.equal((await ns.update(n1.id, { text: '  ' })).text, 'Changed', 'empty text keeps the note');
assert.equal(await ns.update('nope', { text: 'x' }), null);

// comments belong to a highlight by id and are their own record
assert.equal(await ns.setComment('hl_1', { text: '   ' }), null, 'nothing to save');
let c = await ns.setComment('hl_1', { text: 'Check against chart 3', tags: ['wages'] });
assert.equal(c.id, 'c_hl_1'); assert.equal(c.kind, 'comment'); assert.equal(c.highlightId, 'hl_1'); assert.equal(c.text, 'Check against chart 3');
const c2 = await ns.setComment('hl_1', { text: 'Edited comment' });
assert.equal(c2.id, c.id); assert.equal(c2.created, c.created, 'one comment per highlight: editing keeps it'); assert.equal(c2.text, 'Edited comment');
assert.equal(store[SK.notesIndex].filter((e) => e.id === 'c_hl_1').length, 1);
assert.equal(JSON.stringify(store[SK.annotations]), hlBefore, 'the highlight array was never written');

// list: notes newest first, comments keyed by highlight
let all = await ns.list();
assert.equal(all.notes.length, 14); assert.ok(all.notes.every((x) => x.kind === 'note'));
assert.deepEqual(all.notes.map((x) => x.created), [...all.notes.map((x) => x.created)].sort().reverse());
assert.equal(all.comments.hl_1.text, 'Edited comment');

// emptying a comment removes it
assert.equal(await ns.setComment('hl_1', { text: '', tags: [] }), null);
assert.ok(!('c_hl_1' in (await ns.list()).comments)); assert.ok(!(noteRecKey('c_hl_1') in store));

// backup includes notes by default; a partial delete never names them
const data = { [SK.notesIndex]: store[SK.notesIndex], [noteRecKey(n1.id)]: store[noteRecKey(n1.id)], [SK.articlesIndex]: [] };
const out = B.filterBackupSecrets(data, false);
assert.ok(SK.notesIndex in out && noteRecKey(n1.id) in out, 'notes are part of a backup');
const env = { local: { get: (k, cb) => cb({ ...store }), remove: (k, cb) => { [].concat(k).forEach((x) => delete store[x]); cb(); }, clear: (cb) => cb(), set: (o, cb) => cb() }, sync: { get: (k, cb) => cb({}), remove: (k, cb) => cb(), clear: (cb) => cb(), set: (o, cb) => cb() }, session: { clear: (cb) => cb() }, alarms: { clearAll: (cb) => cb() }, action: { setBadgeText: () => {} }, localStorage: { clear() {} } };
await R.deleteData(['articles', 'highlights', 'feeds', 'send', 'prefs'], env).catch(() => {});
assert.ok(store[SK.notesIndex] && store[noteRecKey(n1.id)], 'Delete history and the other partial deletes leave notes alone');

// sync: stamps follow notes, deleting writes a marker, nothing happens with sync off
const stamps = SS.createStampStore({ storage: chrome.storage.local });
assert.deepEqual(await stamps.all(), {});
store[SK.syncPlaces] = [{ id: 'p1', enabled: true }];
await stamps.onChanged({ [noteRecKey(n1.id)]: { oldValue: undefined, newValue: store[noteRecKey(n1.id)] } });
let st = await stamps.all();
assert.ok(st['note:' + n1.id].f.text && st['note:' + n1.id].f['tag:x'] && st['note:' + n1.id].f.kind, 'text, kind and tags are stamped');
assert.ok(!('updated' in st['note:' + n1.id].f), 'the edit time is derived, not a field');
const ns2 = N.createNotesStore({ storage: chrome.storage.local });
assert.equal(await ns2.remove(n1.id), true); assert.equal(await ns2.remove(n1.id), false);
st = await stamps.all(); assert.ok(st['note:' + n1.id].deleted, 'deleting a note writes a deletion marker');
assert.ok(!(noteRecKey(n1.id) in store) && !store[SK.notesIndex].some((e) => e.id === n1.id));
// a scan after missed events stamps what is there, and makes no markers
for (const k of Object.keys(store)) if (k.startsWith('sync:stamps:')) delete store[k];
await stamps.scan();
st = await stamps.all(); assert.equal(Object.keys(st).filter((k) => k.startsWith('note:')).length, 13);
assert.ok(Object.values(st).every((e) => !e.deleted));

console.log('TEST 193 OK');
process.exit(0);
