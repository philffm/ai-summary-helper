// Sync order: a device that fetches takes what the server wrote last first, and a library is uploaded with the newest article last,
// so a device that joins gets the newest articles first. A listing without times keeps working.
import assert from 'assert';
import { createStampStore } from '../src/modules/syncStampStore.js';
import { createSyncService } from '../src/modules/syncService.js';
import { parseMultistatus } from '../src/modules/syncWebdav.js';
import { TargetError } from '../src/modules/targets/targetError.js';

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
const files = new Map(); let clock = 0, timed = true; const read = [];
const server = () => ({
    async ping() { return true; },
    async put(file, body, { ifMatch, ifNoneMatch } = {}) {
        const old = files.get(file);
        if ((ifNoneMatch === '*' && old) || (ifMatch && (!old || old.etag !== ifMatch))) throw new TargetError({ kind: 'permanent', status: 412, message: 'changed' });
        files.set(file, { bytes: typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body), etag: 'v' + (++clock), modified: clock * 1000 });
        return { etag: 'v' + clock };
    },
    async get(file) { const f = files.get(file); if (f && file.startsWith('r/')) read.push(file); return f ? { bytes: f.bytes, etag: f.etag } : null; },
    async remove(file) { return files.delete(file); },
    // in the order of the names, as a server may answer
    async list(prefix) { return [...files].filter(([f]) => f.startsWith(prefix + '/')).sort(([a], [b]) => a.localeCompare(b)).map(([f, v]) => ({ path: f, etag: v.etag, size: v.bytes.length, ...(timed ? { modified: v.modified } : {}) })); },
});
async function device() {
    const storage = memoryStorage(), stampStore = createStampStore({ storage });
    storage.onChanged.addListener((c) => stampStore.onChanged(c));
    const service = createSyncService({ storage, makeStore: async () => server(), stampStore });
    let id = '';
    return { storage, sync: async () => {
        if (!id) id = (await service.add({ connection: { service: 'webdav', url: 'https://dav.test/f/', username: 'u' }, secret: { password: 'p' },
            place: { mode: 'encrypted', direction: 'twoway', root: 'q', passphrase: 'abandon ability able about above', ackBackup: true } })).id;
        const r = (await service.syncNow(id))[id];
        assert.ok(r && !r.error && !r.errors.length, JSON.stringify(r));
    } };
}
// twenty articles, kept in an order that is not the order of their age
const ages = Array.from({ length: 20 }, (_, i) => (i * 7) % 20);
const id = (age) => `article_${1790000000000 + age * 86400000}_aaaaaa`;
const a = await device();
await a.storage.set({ 'hl:schema': 2, 'articles:index': ages.map((n) => ({ id: id(n), url: 'https://example.org/' + n, title: 'N' + n, timestamp: new Date(1790000000000 + n * 86400000).toISOString(), archived: false })),
    ...Object.fromEntries(ages.map((n) => ['articles:rec:' + id(n), { content: '<p>' + n + '</p>', summary: '' }])) });
await a.sync();
const byTime = [...files].filter(([f]) => f.startsWith('r/')).sort(([, x], [, y]) => y.modified - x.modified).map(([f]) => f);
assert.equal(byTime.length, 20);

// a device that joins reads the files the newest first, and so the newest articles
const b = await device(); read.length = 0; await b.sync();
assert.deepEqual(read.slice(0, 20), byTime);
const arrived = (await b.storage.get('articles:index'))['articles:index'].map((e) => Number(e.title.slice(1)));
assert.equal(arrived.length, 20);
// which is: by age. The first article read is the newest one that was saved
const c = await device(); read.length = 0;
const first = [];
c.storage.onChanged.addListener((changes) => { const v = changes['articles:index']; if (v && !first.length) first.push(...v.newValue.map((e) => Number(e.title.slice(1)))); });
await c.sync();
await new Promise((r) => setTimeout(r, 20));
assert.deepEqual(first.slice().sort((x, y) => y - x), Array.from({ length: first.length }, (_, i) => 19 - i), 'what arrives first is the newest: ' + first);

timed = false;
const d = await device(); await d.sync();
assert.equal((await d.storage.get('articles:index'))['articles:index'].length, 20, 'without times everything arrives all the same');

const xml = '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/f/r/x</d:href><d:propstat><d:prop><d:getetag>"1"</d:getetag><d:getlastmodified>Sat, 28 Nov 2026 10:00:00 GMT</d:getlastmodified></d:prop></d:propstat></d:response></d:multistatus>';
assert.equal(parseMultistatus(xml)[0].modified, Date.parse('2026-11-28T10:00:00Z'));
console.log('ok: newest first');
process.exit(0);
