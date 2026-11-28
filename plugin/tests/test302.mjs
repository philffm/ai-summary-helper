// The feed list travels with the library: one encrypted document beside the records. It joins the lists of the devices,
// carries removals, never wipes the others after a reset, a lost list or a restored backup, and leaves what it cannot read.
import assert from 'assert';
import { createStampStore } from '../src/modules/syncStampStore.js';
import { createSyncService } from '../src/modules/syncService.js';
import { feedSyncAdapter } from '../src/modules/feedSyncStore.js';
import { FEED_LIST_FILE } from '../src/modules/syncFeedList.js';
import { forgetFeedLists } from '../src/modules/backupUtils.js';
import { keysToRemove, TRANSIENT_PREFIXES } from '../src/modules/dataReset.js';
import { decryptJson, encryptJson, openMeta } from '../src/modules/syncCrypto.js';
import { TargetError } from '../src/modules/targets/targetError.js';

globalThis.chrome = { runtime: {} };
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
function memoryStorage() {
    const data = new Map(), listeners = [];
    const names = (q) => (q == null ? [...data.keys()] : typeof q === 'string' ? [q] : Array.isArray(q) ? q : Object.keys(q));
    const tell = (changes) => { for (const fn of listeners) setTimeout(() => fn(changes), 0); };
    return {
        async get(q) { const out = q && typeof q === 'object' && !Array.isArray(q) ? { ...q } : {}; for (const k of names(q)) if (data.has(k)) out[k] = clone(data.get(k)); return out; },
        async set(items) { const changes = {}; for (const [k, v] of Object.entries(items)) { changes[k] = { oldValue: data.get(k), newValue: clone(v) }; data.set(k, clone(v)); } tell(changes); },
        async remove(keys) { for (const k of [].concat(keys)) data.delete(k); },
        async getKeys() { return [...data.keys()]; },
        onChanged: { addListener: (fn) => listeners.push(fn) },
    };
}
const files = new Map(); let version = 0, feedPuts = 0, meanwhile = null;
const server = () => ({
    async ping() { return true; },
    async put(file, body, { ifMatch, ifNoneMatch } = {}) {
        if (file === FEED_LIST_FILE && meanwhile) { const other = meanwhile; meanwhile = null; await other(); }
        const old = files.get(file);
        if ((ifNoneMatch === '*' && old) || (ifMatch && (!old || old.etag !== ifMatch))) throw new TargetError({ kind: 'permanent', status: 412, message: 'changed' });
        if (file === FEED_LIST_FILE) feedPuts++;
        files.set(file, { bytes: typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body), etag: 'v' + (++version) });
        return { etag: 'v' + version };
    },
    async get(file) { const f = files.get(file); return f ? { bytes: f.bytes, etag: f.etag } : null; },
    async remove(file) { return files.delete(file); },
    async list(prefix) { return [...files].filter(([f]) => f.startsWith(prefix + '/')).map(([f, v]) => ({ path: f, etag: v.etag, size: v.bytes.length })); },
});
const words = 'abandon ability able about above';
const settle = () => new Promise((r) => setTimeout(r, 25));
let clock = Date.now();
function device(direction = 'twoway') {
    const storage = memoryStorage(), stampStore = createStampStore({ storage });
    storage.onChanged.addListener((c) => stampStore.onChanged(c));
    const service = createSyncService({ storage, makeStore: async () => server(), stampStore, feeds: feedSyncAdapter(storage), now: () => (clock += 1000) });
    const d = { storage, service, id: '' };
    d.sync = async () => {
        await settle();
        if (!d.id) d.id = (await service.add({ connection: { service: 'webdav', url: 'https://dav.test/f/', username: 'u' }, secret: { password: 'p' },
            place: { mode: 'encrypted', direction, root: 'q', passphrase: words, ackBackup: true } })).id;
        const r = (await service.syncNow(d.id))[d.id];
        assert.ok(r && !r.error && !r.errors.length, JSON.stringify(r));
        await settle();
        return r.feeds;
    };
    d.subs = async () => (await storage.get('feeds:subs'))['feeds:subs'] || [];
    d.urls = async () => (await d.subs()).map((s) => s.url).sort();
    d.setSubs = (list) => storage.set({ 'feeds:subs': list });
    d.add = async (...names) => d.setSubs([...(await d.subs()), ...names.map((n) => ({ id: n, url: `https://${n}.example/feed`, title: n, tags: ['news'] }))]);
    d.drop = async (...names) => d.setSubs((await d.subs()).filter((s) => !names.includes(s.id)));
    return d;
}
const url = (...n) => n.map((x) => `https://${x}.example/feed`).sort();
const onServer = async () => {
    const meta = JSON.parse(new TextDecoder().decode(files.get('meta.json').bytes));
    const { keys } = await openMeta(meta, { passphrase: words });
    return { keys, doc: await decryptJson(keys, files.get(FEED_LIST_FILE).bytes) };
};

// a library without feeds gets no document
const a = device(), b = device();
await a.sync();
assert.ok(!files.has(FEED_LIST_FILE), 'nothing to write');

// the lists of two devices become one, with the categories
await a.add('one', 'two'); await a.sync();
assert.ok(![...files.keys()].some((f) => f.startsWith('r/') && f.includes('feeds')), 'not a record');
await b.add('mine'); await b.sync(); await a.sync();
assert.deepEqual(await a.urls(), url('mine', 'one', 'two'));
assert.deepEqual(await b.urls(), url('mine', 'one', 'two'));
assert.deepEqual((await b.subs()).find((s) => s.title === 'one').tags, ['news']);
const quiet = feedPuts; await a.sync(); await b.sync(); assert.equal(feedPuts, quiet, 'nothing new: nothing written');

// a changed category and a removal travel
await a.setSubs((await a.subs()).map((s) => (s.url === url('one')[0] ? { ...s, tags: ['tech'] } : s)));
await a.drop('two'); await a.sync(); await b.sync();
assert.deepEqual(await b.urls(), url('mine', 'one'));
assert.deepEqual((await b.subs()).find((s) => s.url === url('one')[0]).tags, ['tech']);
// and an address added again comes back everywhere
await b.add('two'); await b.sync(); await a.sync();
assert.deepEqual(await a.urls(), url('mine', 'one', 'two'));

// a reset of the feeds forgets what the place had: the feeds come back, nothing is removed elsewhere
const all = await a.storage.getKeys();
const gone = keysToRemove(['feeds'], all);
assert.ok(gone.some((k) => k.startsWith('sync:feedlist:')), gone.join());
assert.ok(TRANSIENT_PREFIXES.includes('sync:feedlist:'), 'and it is in no backup');
await a.storage.remove(gone); await a.sync(); await b.sync();
assert.deepEqual(await a.urls(), url('mine', 'one', 'two'));
assert.deepEqual(await b.urls(), url('mine', 'one', 'two'));

// a restored backup removes nothing: the older list is joined with the library's
await b.add('later'); await b.sync(); await a.sync();
await forgetFeedLists({ area: a.storage });
await a.setSubs((await a.subs()).filter((s) => s.id !== 'later' && s.url !== url('later')[0]));
await a.sync(); await b.sync();
assert.deepEqual(await a.urls(), url('later', 'mine', 'one', 'two'));
assert.deepEqual(await b.urls(), url('later', 'mine', 'one', 'two'));

// many removals at once are held back where they arrive
const many = Array.from({ length: 30 }, (_, i) => 'm' + i);
await a.add(...many); await a.sync(); await b.sync();
assert.equal((await b.urls()).length, 34);
await a.drop(...many.slice(0, 20)); await a.setSubs((await a.subs()).filter((s) => !many.slice(0, 20).some((n) => s.url === url(n)[0])));
await a.sync();
let r = await b.sync();
assert.equal(r.held, 20); assert.equal((await b.urls()).length, 34, 'still here');
r = await b.sync(); assert.equal(r.held, 20, 'and held again, not pushed back'); await a.sync(); assert.equal((await a.urls()).length, 14);

// a list that vanished as a whole is taken for lost
const before = await a.urls();
await a.setSubs([]); await a.sync();
assert.deepEqual(await a.urls(), before);

// another device writes in between: read, join, write once more
const c = device(); await c.sync();
await a.add('x'); meanwhile = async () => { await c.add('y'); await c.sync(); };
await a.sync(); await c.sync();
assert.ok((await a.urls()).includes(url('y')[0]) && (await c.urls()).includes(url('x')[0]));

// a backup place keeps the list on the server and takes nothing from it
files.clear();
const only = device('push'); await only.add('kept'); await only.sync();
assert.equal((await onServer()).doc.entries.length, 1);
// restoring from it adds what is missing, and removes nothing
const fresh = device(); await fresh.add('own');
fresh.id = (await fresh.service.add({ connection: { service: 'webdav', url: 'https://dav.test/f/', username: 'u' }, secret: { password: 'p' }, place: { mode: 'encrypted', direction: 'twoway', root: 'q', passphrase: words, ackBackup: true } })).id;
assert.equal((await fresh.service.restore(fresh.id)).feeds.added, 1);
assert.deepEqual(await fresh.urls(), url('kept', 'own'));
assert.deepEqual((await fresh.service.feedList(fresh.id)).map((e) => e.url), url('kept'));

// a document of a newer kind stays as it is, and the records go on
const { keys } = await onServer();
files.set(FEED_LIST_FILE, { bytes: await encryptJson(keys, { aish: 'feeds/2', entries: [] }), etag: 'newer' });
r = await fresh.sync();
assert.ok(/newer version/.test(r.error), JSON.stringify(r));
assert.equal(files.get(FEED_LIST_FILE).etag, 'newer');
assert.deepEqual(await fresh.urls(), url('kept', 'own'));

// the document both phones are tested against
const vector = JSON.parse((await import('fs')).readFileSync(new URL('./fixtures/feed-list-vector.json', import.meta.url), 'utf8'));
const vk = (await openMeta(vector.meta, { passphrase: vector.passphrase })).keys;
const doc = await decryptJson(vk, new Uint8Array(Buffer.from(vector.file, 'base64')));
assert.deepEqual([doc.aish, doc.entries], ['feeds/1', vector.entries]);

console.log('ok 302: feed list in the library');
process.exit(0);
