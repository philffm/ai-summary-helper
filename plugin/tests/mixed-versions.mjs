// A released browser beside the code of this tree: both sync one library and both keep every question asked about an article,
// and the released one does not lose the prepared questions, which it does not know as a synced field.
//     node plugin/tests/mixed-versions.mjs [ref]      ref: the released code, default origin/main
// Not run by `npm test`: it needs git and unpacks the released sources into a temporary folder.
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import assert from 'assert';
import { createStampStore } from '../src/modules/syncStampStore.js';
import { createSyncService } from '../src/modules/syncService.js';
import { hashValue } from '../src/modules/syncStamps.js';
import { TargetError } from '../src/modules/targets/targetError.js';
import { withQuestions } from '../src/modules/conversation.js';
import { feedSyncAdapter } from '../src/modules/feedSyncStore.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const released = fs.mkdtempSync(path.join(os.tmpdir(), 'kaivo-released-'));
execFileSync('tar', ['-x', '-C', released], { input: execFileSync('git', ['-C', repo, 'archive', process.argv[2] || 'origin/main', 'plugin/src', 'package.json'], { maxBuffer: 1 << 30 }) });
const fromReleased = (name) => import(pathToFileURL(path.join(released, 'plugin/src/modules', name)).href);
const { createStampStore: oldStamps } = await fromReleased('syncStampStore.js');
const { createSyncService: oldService } = await fromReleased('syncService.js');

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
function memoryStorage() {
    const data = new Map(), listeners = [];
    const names = (q) => (q == null ? [...data.keys()] : typeof q === 'string' ? [q] : Array.isArray(q) ? q : Object.keys(q));
    // after the write, as storage events arrive: a listener may need the lock the writer holds
    const tell = (changes) => { for (const fn of listeners) setTimeout(() => fn(changes), 0); };
    return {
        async get(q) { const out = q && typeof q === 'object' && !Array.isArray(q) ? { ...q } : {}; for (const k of names(q)) if (data.has(k)) out[k] = clone(data.get(k)); return out; },
        async set(items) { const changes = {}; for (const [k, v] of Object.entries(items)) { changes[k] = { oldValue: data.get(k), newValue: clone(v) }; data.set(k, clone(v)); } tell(changes); },
        async remove(keys) { for (const k of [].concat(keys)) data.delete(k); },
        async getKeys() { return [...data.keys()]; },
        onChanged: { addListener: (fn) => listeners.push(fn) },
        // an update of the extension: the old code is gone, the data stays
        detach() { listeners.length = 0; },
    };
}
const files = new Map(); let version = 0, puts = 0;
const server = () => ({
    async ping() { return true; },
    async put(file, body, { ifMatch, ifNoneMatch } = {}) {
        const old = files.get(file);
        if ((ifNoneMatch === '*' && old) || (ifMatch && (!old || old.etag !== ifMatch))) throw new TargetError({ kind: 'permanent', status: 412, message: 'changed' });
        puts++; files.set(file, { bytes: typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body), etag: 'v' + (++version) });
        return { etag: 'v' + version };
    },
    async get(file) { const f = files.get(file); return f ? { bytes: f.bytes, etag: f.etag } : null; },
    async remove(file) { return files.delete(file); },
    async list(prefix) { return [...files].filter(([f]) => f.startsWith(prefix + '/')).map(([f, v]) => ({ path: f, etag: v.etag, size: v.bytes.length })); },
});
async function device(older = false, storage = memoryStorage()) {
    const stampStore = (older ? oldStamps : createStampStore)({ storage });
    storage.onChanged.addListener((c) => stampStore.onChanged(c));
    // the new one also puts its feed list beside the records, where the released one must not mind it
    const service = (older ? oldService : createSyncService)({ storage, makeStore: async () => server(), stampStore, ...(older ? {} : { feeds: feedSyncAdapter(storage) }), dataHooks: { compose: (base, turns) => withQuestions(base, turns, { all: false }) } });
    let id = '';
    const sync = async () => {
        if (!id) id = (await service.add({ connection: { service: 'webdav', url: 'https://dav.test/f/', username: 'u' }, secret: { password: 'p' },
            place: { mode: 'encrypted', direction: 'twoway', root: 'q', passphrase: 'abandon ability able about above', ackBackup: true } })).id;
        const r = (await service.syncNow(id))[id];
        assert.ok(r && !r.error && !r.errors.length, JSON.stringify(r));
    };
    const record = async () => (await storage.get('articles:rec:a1'))['articles:rec:a1'];
    const asked = async () => ((await record()).conversation || []).map((t) => t.id);
    const write = async (change) => { const r = await record(); await storage.set({ 'articles:rec:a1': { ...r, conversation: change(r.conversation || []) } }); await new Promise((x) => setTimeout(x, 40)); };
    const ask = (turnId, minute, more = {}) => write((c) => [...c, { id: turnId, q: turnId + '?', a: 'answer ' + turnId, sources: [], pinned: false, ts: `2026-11-28T10:${minute}:00.000Z`, ...more }]);
    return { storage, sync, record, asked, write, ask };
}


const young = await device(), old = await device(true);
await young.storage.set({ 'hl:schema': 2, 'articles:index': [{ id: 'a1', url: 'https://example.org/a', title: 'A', timestamp: '2026-11-28T09:00:00.000Z', archived: false }],
    'articles:rec:a1': { content: '<p>Text.</p>', summary: '<p>Short.</p>', summaryBase: '<p>Short.</p>', conversation: [{ id: 'q0', q: 'first?', a: 'a', sources: [], pinned: false, ts: '2026-11-28T09:30:00.000Z' }] } });
await young.storage.set({ 'feeds:subs': [{ id: 'f', url: 'https://example.org/feed', title: 'F', tags: ['news'] }] });
await young.sync(); await old.sync();
assert.ok(files.has('feeds.bin'), 'the feed list is there');
const settle = async () => { for (const d of [young, old, young, old]) await d.sync(); };
// the old one asks later (its list wins on the server for a moment)
await young.ask('n1', '01'); await young.sync(); await old.ask('o1', '02'); await old.sync(); await settle();
assert.deepEqual(await young.asked(), ['q0', 'n1', 'o1'], 'new keeps both'); assert.deepEqual(await old.asked(), ['q0', 'n1', 'o1'], 'old gets both back');
// the other way round: the new one asks later
await old.ask('o2', '03'); await old.sync(); await young.ask('n2', '04'); await young.sync(); await settle();
assert.deepEqual(await young.asked(), ['q0', 'n1', 'o1', 'o2', 'n2']); assert.deepEqual(await old.asked(), ['q0', 'n1', 'o1', 'o2', 'n2']);
// both before either syncs, old syncs first
await old.ask('o3', '05'); await young.ask('n3', '06'); await old.sync(); await young.sync(); await settle();
assert.equal((await young.asked()).length, 7); assert.equal((await old.asked()).length, 7);
const before = puts; await settle(); assert.equal(puts, before, 'then nothing is written any more');
for (const d of [young, old]) {
    const entry = (await d.storage.get('articles:index'))['articles:index'][0];
    assert.ok(!('conversation' in entry) && !Object.keys(entry).some((k) => k.startsWith('qa:')), JSON.stringify(Object.keys(entry)));
    assert.equal(entry.qaCount, 7);
}

// ── prepared questions ───────────────────────────────────────────────────
const rec = async (d) => (await d.storage.get('articles:rec:a1'))['articles:rec:a1'];
const entryOf = async (d) => (await d.storage.get('articles:index'))['articles:index'][0];
const patch = async (d, change) => { await d.storage.set({ 'articles:rec:a1': { ...(await rec(d)), ...change } }); await new Promise((r) => setTimeout(r, 40)); };
const archive = async (d, archived) => { await d.storage.set({ 'articles:index': [{ ...(await entryOf(d)), archived }] }); await new Promise((r) => setTimeout(r, 40)); };
const article = (record) => ({ 'hl:schema': 2, 'articles:index': [{ id: 'a1', url: 'https://example.org/a', title: 'A', timestamp: '2026-11-28T09:00:00.000Z', archived: false }],
    'articles:rec:a1': { content: '<p>Text.</p>', summary: '<p>Short.</p>', ...record } });
const questions = ['Why?', 'How?'], answers = { 'Why?': 'Because.' };

// the new one has them, the released one receives the article and changes it
files.clear();
const fresh = await device(), held = await device(true);
await fresh.storage.set(article({ suggested: questions, suggestedAnswers: answers }));
await fresh.sync(); await held.sync();
assert.equal((await rec(held)).suggested, undefined, 'the released one does not show them');
await archive(held, true); await held.sync(); await fresh.sync(); await held.sync(); await fresh.sync();
assert.equal((await entryOf(fresh)).archived, true, 'its change arrived');
assert.deepEqual((await rec(fresh)).suggested, questions, 'and took nothing away'); assert.deepEqual((await rec(fresh)).suggestedAnswers, answers);
const third = await device(); await third.sync();
assert.deepEqual((await rec(third)).suggested, questions, 'the library still holds them');
const stamped = Object.values(await createStampStore({ storage: held.storage }).all())[0].f;
assert.ok('prepared' in stamped && !('suggested' in stamped) && !('suggestedAnswers' in stamped), Object.keys(stamped).join());
// it is updated: what it was holding shows, and nothing is sent back and forth
held.storage.detach();
const updated = await device(false, held.storage);
await updated.sync();
assert.deepEqual((await rec(updated)).suggested, questions); assert.deepEqual((await rec(updated)).suggestedAnswers, answers);
assert.ok(!('prepared' in (await entryOf(updated))));
await fresh.sync(); await updated.sync();
let writes = puts; await fresh.sync(); await updated.sync(); await third.sync(); assert.equal(puts, writes, 'then nothing is written any more');

// the released one has its own, from before: they go out after its update
files.clear();
const had = await device(true), other = await device();
await had.storage.set(article({ suggested: questions, suggestedAnswers: answers }));
await had.sync(); await other.sync();
assert.equal((await rec(other)).suggested, undefined);
had.storage.detach();
const now = await device(false, had.storage);
await now.sync(); await other.sync();
assert.deepEqual((await rec(other)).suggested, questions); assert.deepEqual((await rec(other)).suggestedAnswers, answers);
writes = puts; await now.sync(); await other.sync(); assert.equal(puts, writes);
fs.rmSync(released, { recursive: true, force: true });
console.log('ok: released and new version side by side');
process.exit(0);

