// Sync keeps every question: two devices that each asked something about an article both end with all of them, a question that was
// continued is not doubled, a second round writes nothing, and the files on the server look as before.
import assert from 'assert';
import { createStampStore } from '../src/modules/syncStampStore.js';
import { createSyncService } from '../src/modules/syncService.js';
import { keepAllQuestions } from '../src/modules/syncQuestions.js';
import { mergeRecord } from '../src/modules/syncMerge.js';
import { hashValue } from '../src/modules/syncStamps.js';
import { TargetError } from '../src/modules/targets/targetError.js';
import { withQuestions } from '../src/modules/conversation.js';

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
async function device() {
    const storage = memoryStorage(), stampStore = createStampStore({ storage });
    storage.onChanged.addListener((c) => stampStore.onChanged(c));
    const service = createSyncService({ storage, makeStore: async () => server(), stampStore, dataHooks: { compose: (base, turns) => withQuestions(base, turns, { all: false }) } });
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

const a = await device(), b = await device();
await a.storage.set({ 'hl:schema': 2, 'articles:index': [{ id: 'a1', url: 'https://example.org/a', title: 'A', timestamp: '2026-11-28T09:00:00.000Z', archived: false }],
    'articles:rec:a1': { content: '<p>Text.</p>', summary: '<p>Short.</p>', summaryBase: '<p>Short.</p>', conversation: [{ id: 'q0', q: 'first?', a: 'short', sources: [], pinned: false, ts: '2026-11-28T09:30:00.000Z' }] } });
await a.sync(); await b.sync();
assert.deepEqual(await b.asked(), ['q0']);

// both ask before either syncs
await a.ask('qa', '01'); await b.ask('qb', '02', { noted: true });
await a.sync(); await b.sync(); await a.sync();
assert.deepEqual(await a.asked(), ['q0', 'qa', 'qb'], 'in the order they were asked');
assert.deepEqual(await b.asked(), ['q0', 'qa', 'qb']);
assert.equal((await a.record()).conversation[2].noted, true);
const before = puts; await a.sync(); await b.sync(); await a.sync();
assert.equal(puts, before, 'a round with nothing new writes nothing');

// one continues an answer (the same question), the other asks: both, and no double
await b.ask('qc', '03');
await a.write((c) => c.map((t) => (t.id === 'q0' ? { ...t, a: 'a longer answer' } : t)));
await b.sync(); await a.sync(); await b.sync();
for (const d of [a, b]) {
    assert.deepEqual(await d.asked(), ['q0', 'qa', 'qb', 'qc']);
    assert.equal((await d.record()).conversation[0].a, 'a longer answer');
}
// a pinned one of either side is in the summary of both
await a.write((c) => c.map((t) => (t.id === 'qa' ? { ...t, pinned: true } : t)));
await a.sync(); await b.sync();
assert.ok((await b.record()).summary.includes('answer qa'));

// pure: nothing to add leaves the merge as it is
const rec = (t, conversation) => ({ rev: { t, d: 'x' }, f: { conversation: { t, h: hashValue(conversation) } }, values: { conversation } });
const local = rec(5, [{ id: '1' }]), remote = rec(9, [{ id: '1' }, { id: '2' }]), plain = mergeRecord(local, remote);
assert.equal(keepAllQuestions(local, remote, plain, { device: 'd', now: 100 }), plain);
assert.equal(keepAllQuestions(null, remote, plain, { device: 'd', now: 100 }), plain);
console.log('ok: questions merged');
process.exit(0);
