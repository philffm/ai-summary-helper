// Library sync: the questions prepared with a summary travel with the article, and those that were there before they
// did are sent once, without counting as a change.
import assert from 'assert';
import { createStampStore } from '../src/modules/syncStampStore.js';
import { createSyncService } from '../src/modules/syncService.js';
import { syncFields, unknownFields, stampRecord, preparedOf, questionsOf } from '../src/modules/syncStamps.js';
import { applyFields } from '../src/modules/syncApply.js';
import { createHighlightStore } from '../src/modules/highlightStore.js';
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
        quiet(items) { for (const [k, v] of Object.entries(items)) data.set(k, clone(v)); },
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

// ── the field ────────────────────────────────────────────────────────────
const rec = { content: '<p>x</p>', suggested: ['Why?', ' ', 'How?'], suggestedAnswers: { 'Why?': 'Because.', 'Gone?': 'x' } };
const field = [{ q: 'Why?', a: 'Because.' }, { q: 'How?' }];
assert.deepEqual(syncFields('article', { id: 'a' }, rec).prepared, field);
assert.ok(!('suggested' in syncFields('article', { id: 'a' }, rec)) && !('suggestedAnswers' in syncFields('article', { id: 'a' }, rec)));
assert.deepEqual(questionsOf(field), { suggested: ['Why?', 'How?'], suggestedAnswers: { 'Why?': 'Because.' } });
assert.deepEqual(preparedOf(questionsOf(field)), field, 'there and back gives the same value');
assert.deepEqual(preparedOf({ suggested: ['constructor'] }), [{ q: 'constructor' }]);
const many = preparedOf({ suggested: Array.from({ length: 12 }, (_, i) => 'q'.repeat(300) + i), suggestedAnswers: {} });
assert.ok(many.length === 8 && many[0].q.length === 200);
assert.equal(preparedOf({ suggested: ['Long?'], suggestedAnswers: { 'Long?': 'a'.repeat(900) } })[0].a.length, 500);
for (const none of [{ content: 'x' }, { content: 'x', suggested: [] }, null]) {
    assert.ok(!('prepared' in syncFields('article', { id: 'a', prepared: field }, none)), 'a list entry never speaks for the field');
    assert.ok(unknownFields('article', { id: 'a' }, none).includes('prepared'));
}
// a list that was emptied here removes nothing
const clock = { t: 0 };
const first = stampRecord(undefined, syncFields('article', { id: 'a' }, rec), { clock, now: 10, device: 'd' });
const emptied = stampRecord(first.entry, syncFields('article', { id: 'a' }, { ...rec, suggested: [] }), { clock, now: 20, device: 'd', skip: unknownFields('article', { id: 'a' }, { ...rec, suggested: [] }) });
assert.equal(emptied.changed, false);
const merged = (values) => ({ f: { prepared: { t: 1, h: 'h' } }, values });
let out = applyFields('article', { entry: { id: 'a', prepared: [{ q: 'old' }] }, rec: { content: 'x' } }, merged({ prepared: field }));
assert.deepEqual(out.rec.suggested, ['Why?', 'How?']); assert.ok(!('prepared' in out.entry) && !('prepared' in out.rec));
out = applyFields('article', { entry: { id: 'a' }, rec: { content: 'x', suggested: ['kept'] } }, merged({}));
assert.deepEqual(out.rec.suggested, ['kept'], 'a value that went missing takes nothing away');

// ── two devices ──────────────────────────────────────────────────────────
const id = 'article_1790000000000_aaaaaa', recKey = 'articles:rec:' + id;
const record = async (d) => (await d.storage.get(recKey))[recKey];
const change = async (d, fields) => { await d.storage.set({ [recKey]: { ...(await record(d)), ...fields } }); await settle(); };
const stampsOf = async (d) => (await d.stampStore.all())['article:' + id];
async function pair(extra = {}) {
    files = new Map();
    const a = device(), b = device();
    await a.storage.set({ 'hl:schema': 2, 'articles:index': [{ id, url: 'https://example.org/a', title: 'A', timestamp: '2026-11-28T09:00:00.000Z', archived: false }],
        [recKey]: { content: '<p>t</p>', summary: '<p>s</p>', ...extra } });
    await a.sync(); await b.sync();
    return [a, b];
}
let [a, b] = await pair({ suggested: ['Why?', 'How?'], suggestedAnswers: { 'Why?': 'Because.' } });
assert.deepEqual((await record(b)).suggested, ['Why?', 'How?']);
assert.deepEqual((await record(b)).suggestedAnswers, { 'Why?': 'Because.' });
assert.equal((await a.sync()).puts + (await b.sync()).puts, 0, 'then nothing is written any more');
// asked on one: the list that is left, with what came new, reaches the other
await change(b, { suggested: ['New?', 'How?'], suggestedAnswers: {} });
await b.sync(); await a.sync();
assert.deepEqual((await record(a)).suggested, ['New?', 'How?']);
// all used up on one: the others keep theirs
await change(a, { suggested: [] });
await a.sync(); await b.sync();
assert.deepEqual((await record(b)).suggested, ['New?', 'How?']);
// and a change to something else there takes the server's list along
await change(a, { summaryBase: '<p>again</p>' });
await a.sync(); await b.sync();
assert.deepEqual((await record(b)).suggested, ['New?', 'How?']);

// ── questions that were there before ─────────────────────────────────────
/** As an update finds it: synced without the field, the questions only here, the ledger without its mark. */
async function asBefore(d, fields) {
    d.storage.quiet({ [recKey]: { ...(await record(d)), ...fields } });
    const key = 'sync:ledger:' + d.id, { questions: _, ...ledger } = (await d.storage.get(key))[key];
    d.storage.quiet({ [key]: ledger });
}
[a, b] = await pair();
await asBefore(a, { suggested: ['Why?'], suggestedAnswers: { 'Why?': 'Because.' } });
const rev = (await stampsOf(a)).rev;
let run = await a.sync();
assert.equal(run.puts, 1, 'sent once'); assert.deepEqual((await stampsOf(a)).rev, rev, 'and not as a change');
assert.equal((await a.sync()).puts, 0);
await b.sync();
assert.deepEqual((await record(b)).suggested, ['Why?']); assert.deepEqual((await record(b)).suggestedAnswers, { 'Why?': 'Because.' });
assert.equal((await b.sync()).puts, 0);
// both have them from before: whoever comes first sends, the other takes them, then it is quiet
[a, b] = await pair();
await asBefore(a, { suggested: ['From A?'] }); await asBefore(b, { suggested: ['From B?'] });
await a.sync(); await b.sync(); await a.sync(); await b.sync();
assert.deepEqual((await record(a)).suggested, ['From A?']); assert.deepEqual((await record(b)).suggested, ['From A?']);
assert.equal((await a.sync()).puts + (await b.sync()).puts, 0);
// a device that only fetches after the update, and sends later (the iPhone), sends back nothing of what it received
[a, b] = await pair();
await asBefore(b, {});
await asBefore(a, { suggested: ['Why?'] });
await a.sync();
puts = 0;
await createSyncService({ storage: b.storage, makeStore: async () => server(), stampStore: b.stampStore, engine: { pullOnly: true } }).syncNow(b.id);
await settle();
assert.equal(puts, 0);
assert.deepEqual((await record(b)).suggested, ['Why?']);
assert.equal((await b.sync()).puts, 0, 'it came from the server: nothing to send');
assert.equal((await a.sync()).puts, 0);
// deleted elsewhere in the meantime: it stays deleted
[a, b] = await pair();
await asBefore(a, { suggested: ['Why?'] });
await b.remove([id]); await b.sync();
await a.sync();
assert.deepEqual(await a.ids(), []); await b.sync(); assert.deepEqual(await b.ids(), []);
// gone from the server altogether (its marker long purged): not brought back
[a, b] = await pair();
await asBefore(a, { suggested: ['Why?'] });
for (const file of [...files.keys()]) if (file.startsWith('r/')) files.delete(file);
assert.equal((await a.sync()).puts, 0);
assert.equal([...files.keys()].filter((f) => f.startsWith('r/')).length, 0);
// what a version without the field kept on the list entry goes to the record
[a, b] = await pair();
await change(b, { suggested: ['Kept?'] }); await b.sync(); await a.sync();
const { suggested: _s, suggestedAnswers: _a, ...bare } = await record(a);
const entry = (await a.storage.get('articles:index'))['articles:index'][0];
a.storage.quiet({ [recKey]: bare, 'articles:index': [{ ...entry, prepared: [{ q: 'Kept?' }] }] });
const key = 'sync:ledger:' + a.id, { questions: _q, ...ledger } = (await a.storage.get(key))[key];
a.storage.quiet({ [key]: ledger });
await a.sync();
assert.deepEqual((await record(a)).suggested, ['Kept?']);
assert.ok(!('prepared' in (await a.storage.get('articles:index'))['articles:index'][0]));
await b.sync(); assert.deepEqual((await record(b)).suggested, ['Kept?']);
assert.equal((await a.sync()).puts + (await b.sync()).puts, 0);

console.log('✓ prepared questions travel with the article, earlier ones are sent once and revive nothing');
process.exit(0);
