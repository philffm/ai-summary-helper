// Backup and sync: a full backup carries when what was changed, so a restored library sends nothing back that the server has,
// and what was deleted since the backup stays deleted. Backups without that information no longer send everything either, nor
// bring deleted things back; past the usual guard they ask.
import assert from 'assert';
import { createStampStore } from '../src/modules/syncStampStore.js';
import { createSyncService } from '../src/modules/syncService.js';
import { createHighlightStore } from '../src/modules/highlightStore.js';
import { filterBackupSecrets, prepareImportedData, writeRestored, backupStamps, restoreStamps } from '../src/modules/backupUtils.js';
import { withQuestions } from '../src/modules/conversation.js';
import { countWords } from '../src/modules/textUtils.js';
import { TargetError } from '../src/modules/targets/targetError.js';

globalThis.chrome = { runtime: {} };
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
function memoryStorage() {
    const data = new Map(), listeners = [];
    const names = (q) => (q == null ? [...data.keys()] : typeof q === 'string' ? [q] : Array.isArray(q) ? q : Object.keys(q));
    // events arrive after the write, as in a browser
    const tell = (changes) => { for (const fn of listeners) setTimeout(() => fn(changes), 0); };
    return {
        async get(q) { const out = q && typeof q === 'object' && !Array.isArray(q) ? { ...q } : {}; for (const k of names(q)) if (data.has(k)) out[k] = clone(data.get(k)); return out; },
        set(items, done) { const changes = {}; for (const [k, v] of Object.entries(items)) { changes[k] = { oldValue: data.get(k), newValue: clone(v) }; data.set(k, clone(v)); } tell(changes); if (done) setTimeout(done, 0); return Promise.resolve(); },
        async remove(keys) { for (const k of [].concat(keys)) data.delete(k); },
        async getKeys() { return [...data.keys()]; },
        onChanged: { addListener: (fn) => listeners.push(fn) },
    };
}
let files = new Map(), version = 0, puts = 0, gets = 0;
const server = () => ({
    async ping() { return true; },
    async put(file, body, { ifMatch, ifNoneMatch } = {}) {
        const old = files.get(file);
        if ((ifNoneMatch === '*' && old) || (ifMatch && (!old || old.etag !== ifMatch))) throw new TargetError({ kind: 'permanent', status: 412, message: 'changed' });
        if (file.startsWith('r/')) puts++;
        files.set(file, { bytes: typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body), etag: 'v' + (++version) });
        return { etag: 'v' + version };
    },
    async get(file) { const f = files.get(file); if (f && file.startsWith('r/')) gets++; return f ? { bytes: f.bytes, etag: f.etag } : null; },
    async remove(file) { return files.delete(file); },
    async list(prefix) { return [...files].filter(([f]) => f.startsWith(prefix + '/')).map(([f, v]) => ({ path: f, etag: v.etag, size: v.bytes.length })); },
});
const settle = () => new Promise((r) => setTimeout(r, 60));
const connection = { connection: { service: 'webdav', url: 'https://dav.test/f/', username: 'u' }, secret: { password: 'p' },
    place: { mode: 'encrypted', direction: 'twoway', root: 'q', passphrase: 'abandon ability able about above', ackBackup: true } };
function device() {
    const storage = memoryStorage(), stampStore = createStampStore({ storage });
    storage.onChanged.addListener((c) => stampStore.onChanged(c));
    const service = createSyncService({ storage, makeStore: async () => server(), stampStore, dataHooks: { count: countWords, compose: (b, t) => withQuestions(b, t, { all: false }) } });
    const d = { storage, stampStore, service, id: '' };
    d.sync = async (options) => {
        await settle();
        if (!d.id) d.id = (await service.placesNow())[0]?.id || (await service.add(connection)).id;
        puts = 0; gets = 0;
        const r = (await service.syncNow(d.id, options))[d.id];
        assert.ok(r && !r.error && !r.errors.length, JSON.stringify(r));
        await settle();
        return { ...r, puts, gets };
    };
    d.ids = async () => ((await storage.get('articles:index'))['articles:index'] || []).map((e) => e.id);
    d.remove = async (ids) => {
        const list = (await storage.get('articles:index'))['articles:index'].filter((e) => !ids.includes(e.id));
        await stampStore.markDeleted('article', ids);
        await storage.set({ 'articles:index': list });
        await storage.remove(ids.map((i) => 'articles:rec:' + i));
    };
    return d;
}

const N = 60, id = (i) => `article_${1790000000000 + i * 1000}_aaaaaa`;
async function library() {
    files = new Map();
    const a = device(), recs = {};
    await a.storage.set({ 'hl:schema': 2, 'articles:index': Array.from({ length: N }, (_, i) => ({ id: id(i), url: 'https://example.org/' + i, title: 'T' + i, tags: ['x'], timestamp: new Date(1790000000000 + i * 1000).toISOString(), archived: false })),
        ...Object.fromEntries(Array.from({ length: N }, (_, i) => ['articles:rec:' + id(i), recs['articles:rec:' + id(i)] = { content: '<p>text ' + i + '</p>', summary: '<p>s</p>', description: '' }])) });
    await createHighlightStore({ storage: a.storage }).apply(Array.from({ length: 12 }, (_, i) => ({ op: 'add', hl: { id: 'hl_' + i, url: 'https://example.org/' + i, text: 'words ' + i, type: 'user', timestamp: '2026-11-01T10:00:00.000Z', v: 2 } })));
    await a.sync();
    return a;
}
/** A full backup file, as settings/backup.js writes it (`stamps: false`: as earlier versions did). */
async function backup(d, { stamps = true } = {}) {
    const local = await d.storage.get(null);
    return clone({ ...filterBackupSecrets(local, true), ...(stamps ? backupStamps(local) : {}) });
}
/** The import, in the order settings/backup.js takes. */
async function restore(file, into = device()) {
    const current = await into.storage.get(['sync:connections', 'sync:places', 'sync:secrets', 'config:services']);
    const rows = prepareImportedData(clone(file), current);
    const taken = await restoreStamps(file, rows, { area: into.storage });
    await writeRestored(rows, { area: into.storage });
    await settle();
    const [place] = await into.service.placesNow();
    if (place && place.enabled === false) await into.service.update(place.id, { enabled: true });
    into.taken = taken;
    return into;
}

// what goes into the file: stamps, and nothing else of the sync's bookkeeping
let a = await library();
let file = await backup(a);
assert.ok(Object.keys(file).some((k) => k.startsWith('sync:stamps:')));
for (const k of ['sync:deviceId', 'sync:clock', 'sync:status']) assert.ok(!(k in file), k);
assert.ok(!Object.keys(file).some((k) => k.startsWith('sync:ledger:')));
// a version that does not know them drops them on import
assert.ok(!Object.keys(prepareImportedData(clone(file), {})).some((k) => k.startsWith('sync:stamps:')));

// 1. restored into an empty profile: read once, nothing sent, nothing for the others to fetch
let b = await restore(file);
assert.equal(b.taken, N + 12);
let r = await b.sync();
assert.deepEqual([r.puts, r.pushed], [0, 0], JSON.stringify(r));
assert.equal(r.gets, N + 12, 'every file is read once');
r = await a.sync(); assert.deepEqual([r.gets, r.puts], [0, 0]);

// 2. deleted since the backup: stays deleted; edited since: the newer words arrive
a = await library(); file = await backup(a);
await a.remove([id(0), id(1)]);
await a.storage.set({ ['articles:rec:' + id(2)]: { content: '<p>newer</p>', summary: '<p>s</p>', description: '' } });
await a.sync();
b = await restore(file); r = await b.sync();
assert.equal(r.puts, 0); assert.equal((await b.ids()).length, N - 2);
assert.equal((await b.storage.get('articles:rec:' + id(2)))['articles:rec:' + id(2)].content, '<p>newer</p>');
await a.sync(); assert.equal((await a.ids()).length, N - 2);

// 3. a backup without stamps (an earlier version's): nothing identical is sent, and nothing deleted comes back
a = await library(); file = await backup(a, { stamps: false });
await a.remove([id(0), id(1)]); await a.sync();
b = await restore(file); assert.equal(b.taken, 0);
r = await b.sync();
assert.deepEqual([r.puts, (await b.ids()).length], [0, N - 2], JSON.stringify(r));
r = await b.sync(); assert.equal(r.puts, 0);
await a.sync(); assert.equal((await a.ids()).length, N - 2);

// 4. many deleted since: the guard holds the rest back and asks, and no later run sends them back
for (const answer of ['remove', 'keep']) {
    a = await library(); file = await backup(a, { stamps: false });
    const gone = Array.from({ length: 40 }, (_, i) => id(i));
    await a.remove(gone); await a.sync();
    b = await restore(file); r = await b.sync();
    const waiting = r.needsConfirm;
    assert.ok(waiting > 0 && r.puts === 0, JSON.stringify(r));
    assert.equal((await b.ids()).length, N - 40 + waiting);
    for (let i = 0; i < 2; i++) { r = await b.sync(); assert.deepEqual([r.needsConfirm, r.puts], [waiting, 0], 'still asked, nothing sent'); }
    await a.sync(); assert.equal((await a.ids()).length, N - 40);
    if (answer === 'remove') {
        r = await b.sync({ confirmRemovals: true });
        assert.deepEqual([r.needsConfirm, (await b.ids()).length], [0, N - 40]);
        r = await b.sync(); assert.equal(r.puts, 0);
    } else {
        const keys = (await b.service.statusNow())[b.id].pending.map((p) => p.key);
        r = await b.sync({ decide: { keep: keys, remove: [] } });
        assert.equal(r.needsConfirm, 0, JSON.stringify(r));
        await b.sync(); await a.sync();
        assert.equal((await a.ids()).length, N - 40 + waiting, 'kept on purpose: back everywhere');
    }
}

// 5. into a library that has data: stamps only for what is written; and where a place is joined already, none at all
a = await library(); file = await backup(a);
const c = device();
await c.storage.set({ 'sync:places': [{ id: 'unused', enabled: true }] });
await c.storage.set({ 'articles:index': [{ id: 'article_1800000000000_bbbbbb', url: 'https://example.org/only-here', title: 'Only here', timestamp: '2027-01-01T00:00:00.000Z' }] });
await settle();
const own = (await c.stampStore.all())['article:article_1800000000000_bbbbbb'];
assert.ok(own);
await restoreStamps(file, prepareImportedData(clone(file), {}), { area: c.storage });
assert.deepEqual((await c.stampStore.all())['article:article_1800000000000_bbbbbb'], own, 'what the backup does not write keeps its stamp');
assert.equal(await restoreStamps(file, prepareImportedData(clone(file), {}), { area: a.storage }), 0, 'a joined profile: a restore is a change made now');

// 6. stamps from a clock that was ahead: a later edit is still newer
a = await library(); file = await backup(a);
const ahead = Date.now() + 86400000;
for (const shard of Object.keys(file).filter((k) => k.startsWith('sync:stamps:'))) for (const e of Object.values(file[shard])) { e.rev.t = ahead; }
b = await restore(file); await b.sync();
await b.storage.set({ ['articles:rec:' + id(3)]: { content: '<p>after the restore</p>', summary: '<p>s</p>', description: '' } });
await settle();
assert.ok((await b.stampStore.all())['article:' + id(3)].rev.t > ahead);
// the settings page takes the same steps: the stamps go into the full file, and into storage before the records
const page = (await import('fs')).readFileSync(new URL('../src/modules/settings/backup.js', import.meta.url), 'utf8');
assert.ok(page.includes('local: { ...safeLocalData, ...backupStamps(localData) }'), 'export');
const first = page.indexOf('await restoreStamps(importedData.local, rows)'), then = page.indexOf('await writeRestored(rows');
assert.ok(first > 0 && first < then, 'import: the stamps first');
assert.equal(page.split('backupStamps(').length, 2, 'a settings-only backup takes none');
console.log('ok: backup carries the stamps');
process.exit(0);
