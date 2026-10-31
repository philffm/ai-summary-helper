// Two-way encrypted sync: two devices (own storage, own stamp store wired to their storage events) through a fake WebDAV server.
import assert from 'assert';
import path from 'path'; import { pathToFileURL } from 'url';
import { createFakeDav } from './fakeDav.mjs';
import { createFakeFolder } from './fakeFolder.mjs';
import { createFakeS3 } from './fakeS3.mjs';
const imp = (m) => import(pathToFileURL(path.resolve(process.env.AISH_SRC, m)).href);
const { SK, articleRecKey, noteRecKey, syncLedgerKey } = await imp('modules/storageKeys.js');
const { createStampStore } = await imp('modules/syncStampStore.js');
const { createDataAdapter } = await imp('modules/syncDataAdapter.js');
const { syncEncryptedPlace, loadOrCreateMeta } = await imp('modules/syncEngine.js');
const { createMeta, openMeta } = await imp('modules/syncCrypto.js');
const { createWebdavStore } = await imp('modules/syncWebdav.js');
const { createFolderStore } = await imp('modules/syncFolder.js');
const { createS3Store } = await imp('modules/syncS3.js');
const BACKEND = process.env.AISH_STORE || 'webdav', FOLDER = BACKEND === 'folder', S3 = BACKEND === 's3';
const { syncFields } = await imp('modules/syncStamps.js');

const dav = createFakeDav();
const cfg = { url: 'https://cloud.test/dav/', root: 'sync', username: 'phil', password: 'secret' };
const fol = createFakeFolder();
const s3 = createFakeS3();
const mkStore = () => (FOLDER ? createFolderStore({ handle: fol.handle, root: 'sync' }) : S3 ? createS3Store({ endpoint: 'https://s3.test', bucket: 'b', accessKeyId: 'AKIDTEST', secretAccessKey: 's', root: 'sync' }, { fetchFn: s3.fetchFn }) : createWebdavStore(cfg, { fetchFn: dav.fetchFn }));
const files = FOLDER ? fol.files : S3 ? s3.files : dav.files;
const setRaw = (p, body) => (FOLDER ? fol.files.set(p, { body, mt: Date.now() + Math.random() }) : S3 ? s3.files.set(p, { body, etag: 'raw' + Math.random() }) : dav.files.set(p, { body, etag: 'raw' + Math.random() }));
await mkStore().ping();
let clock = 1_000_000;

function device(label) {
  const data = new Map();
  const pending = [];
  const area = {
    get(keys, cb) { let out = {}; if (keys == null) for (const [k, v] of data) out[k] = v; else if (typeof keys === 'string') { if (data.has(keys)) out[keys] = data.get(keys); } else if (Array.isArray(keys)) keys.forEach((k) => { if (data.has(k)) out[k] = data.get(k); }); else for (const [k, d] of Object.entries(keys)) out[k] = data.has(k) ? data.get(k) : d; out = JSON.parse(JSON.stringify(out)); if (cb) { cb(out); return; } return Promise.resolve(out); },
    set(obj, cb) { const ch = {}; for (const [k, v] of Object.entries(obj)) { ch[k] = { oldValue: data.get(k), newValue: JSON.parse(JSON.stringify(v)) }; data.set(k, ch[k].newValue); } pending.push(new Promise((r) => setTimeout(async () => { await st.onChanged(ch); r(); }, 0))); if (cb) cb(); return Promise.resolve(); },
    remove(keys, cb) { const ch = {}; for (const k of [].concat(keys)) { ch[k] = { oldValue: data.get(k) }; data.delete(k); } pending.push(new Promise((r) => setTimeout(async () => { await st.onChanged(ch); r(); }, 0))); if (cb) cb(); return Promise.resolve(); },
  };
  const st = createStampStore({ storage: area, now: () => (clock += 10) });
  area.set({ [SK.syncPlaces]: [{ id: 'p1', enabled: true }] });
  const d = { label, data, area, st, adapter: createDataAdapter({ storage: area }),
    async idle() { await new Promise((r) => setTimeout(r, 5)); while (pending.length) await pending.shift(); await new Promise((r) => setTimeout(r, 5)); },
    index: () => data.get(SK.articlesIndex) || [],
    async addArticle(id, extra = {}, rec = {}) { const idx = d.index().slice(); idx.push({ id, url: 'https://x.test/' + id, title: 'T ' + id, timestamp: '2026-01-01T00:00:00Z', tags: ['one'], summary: 'S', archived: false, ...extra }); await area.set({ [articleRecKey(id)]: { content: '<p>text ' + id + '</p>', summary: 'S', ...rec }, [SK.articlesIndex]: idx }); await d.idle(); },
    async editEntry(id, patch) { await area.set({ [SK.articlesIndex]: d.index().map((e) => (e.id === id ? { ...e, ...patch } : e)) }); await d.idle(); },
    async deleteArticle(id) { await area.set({ [SK.articlesIndex]: d.index().filter((e) => e.id !== id) }); await area.remove(articleRecKey(id)); await st.markDeleted('article', [id]); await d.idle(); },
    async sync(extra = {}) { await d.idle(); const r = await syncEncryptedPlace({ place: { id: 'p1' }, storage: area, store: mkStore(), keys: K.keys, meta: K.meta, stampStore: st, adapter: d.adapter, now: () => Date.now(), ...extra }); await d.idle(); return r; },
    entry: (id) => d.index().find((e) => e.id === id), rec: (id) => data.get(articleRecKey(id)),
    stampsJson: async () => JSON.parse(JSON.stringify(await st.all())) };
  return d;
}

// the place: first device creates meta.json, second joins it with the passphrase
const created = await loadOrCreateMeta(mkStore(), { createMeta, passphrase: 'pw', iterations: 1000 });
assert.ok(created.created);
const K = { meta: created.meta, keys: created.keys };
const second = await loadOrCreateMeta(mkStore(), { createMeta, passphrase: 'pw', iterations: 1000 });
assert.ok(!second.created && second.meta.salt === created.meta.salt, 'a second device reads the meta file, it never creates another');
assert.ok((await openMeta(second.meta, { passphrase: 'pw' })).keys);

const A = device('A'), B = device('B');
const puts = () => (FOLDER ? fol.log : S3 ? s3.log : dav.log).filter((l) => /^(PUT|WRITE)/.test(l) && l.includes('/r/')).length;

// ── disjoint edits converge; nothing readable on the server ──
await A.addArticle('a1', { tags: ['alpha'] }); await A.addArticle('a2');
await B.addArticle('b1');
let r = await A.sync(); assert.equal(r.pushed, 2, 'A pushes its two articles'); assert.equal(r.errors.length, 0);
r = await B.sync(); assert.equal(r.pulled, 2); assert.equal(r.pushed, 1); assert.equal(r.errors.length, 0);
r = await A.sync(); assert.equal(r.pulled, 1);
for (const dev of [A, B]) assert.deepEqual(dev.index().map((e) => e.id).sort(), ['a1', 'a2', 'b1']);
assert.equal(B.rec('a1').content, '<p>text a1</p>', 'the full text came along');
const raw = [...files.values()].map((f) => new TextDecoder('latin1').decode(f.body)).join('');
assert.ok(!raw.includes('text a1') && !raw.includes('x.test'), 'the server holds nothing readable');
assert.equal([...files.keys()].filter((p) => p.startsWith('sync/r/')).length, 3);

// ── the echo guard: a second round after convergence does nothing ──
const before = [await A.stampsJson(), await B.stampsJson()], p0 = puts();
await A.sync(); await B.sync(); await A.sync();
assert.equal(puts(), p0, 'no PUT when nothing changed'); assert.deepEqual([await A.stampsJson(), await B.stampsJson()], before, 'the stamps did not move');

// ── the same field edited on both sides: one winner, the same one ──
await A.editEntry('a1', { title: 'from A' }); await B.editEntry('a1', { title: 'from B' });   // B is later
await A.sync(); await B.sync(); await A.sync(); await B.sync();
assert.equal(A.entry('a1').title, 'from B'); assert.equal(B.entry('a1').title, 'from B');
// different fields of one record merge; tags added on both sides both stay
await A.editEntry('a2', { favorite: true, tags: ['one', 'fromA'] }); await B.editEntry('a2', { tags: ['one', 'fromB'], title: 'B renamed' });
await A.sync(); await B.sync(); await A.sync(); await B.sync();
for (const dev of [A, B]) { assert.equal(dev.entry('a2').favorite, true); assert.equal(dev.entry('a2').title, 'B renamed'); assert.deepEqual([...dev.entry('a2').tags].sort(), ['fromA', 'fromB', 'one']); }
assert.deepEqual(await A.stampsJson(), await B.stampsJson(), 'identical stamps on both devices');

// ── delete beats an older edit; a newer edit beats the delete ──
await B.deleteArticle('b1');
await A.sync(); await A.editEntry('b1', { title: 'edited before the delete arrives' });   // edit AFTER B's delete (later stamp)
await B.sync(); await A.sync(); await B.sync(); await A.sync();
assert.ok(A.entry('b1') && B.entry('b1') && B.entry('b1').title === 'edited before the delete arrives', 'a newer edit brings the article back');
await A.deleteArticle('a2');
await A.sync(); await B.sync();
assert.ok(!B.entry('a2') && !B.rec('a2'), 'a delete reaches the other device (data removed, no new stamps made)');
const stampsAfter = await B.stampsJson(); await B.sync(); await A.sync(); await B.sync(); assert.deepEqual(await B.stampsJson(), stampsAfter, 'applying a delete made no stamps of its own');

// ── both devices delete the same article on their own: they settle on one marker and stop writing
await A.addArticle('x1'); await A.sync(); await B.sync(); assert.ok(B.entry('x1'));
await A.deleteArticle('x1'); await B.deleteArticle('x1');
for (let i = 0; i < 2; i++) { await A.sync(); await B.sync(); }
const settled = puts(); await A.sync(); await B.sync(); await A.sync(); await B.sync();
assert.equal(puts(), settled, 'two tombstones for one record do not overwrite each other forever');
assert.deepEqual(await A.stampsJson(), await B.stampsJson());

// ── pruned text on one device never erases the text on the other ──
await A.area.set({ [articleRecKey('a1')]: { ...A.rec('a1'), content: '', contentPruned: true } }); await A.editEntry('a1', { contentPruned: true, favorite: true });
await A.sync(); await B.sync();
assert.equal(B.rec('a1').content, '<p>text a1</p>', 'B keeps its text');
const onServer = await (async () => { const { bytes } = await mkStore().get('r/' + (await (await imp('modules/syncCrypto.js')).nameOf(K.keys, 'article', 'a1'))); return (await (await imp('modules/syncCrypto.js')).decryptJson(K.keys, bytes)); })();
assert.ok(onServer.values.content === '<p>text a1</p>', 'and so does the server');

// ── a damaged file is skipped and never overwritten ──
const { nameOf } = await imp('modules/syncCrypto.js');
const victim = 'sync/r/' + await nameOf(K.keys, 'article', 'a1'); const good = files.get(victim).body;
setRaw(victim, new Uint8Array(40).fill(7));
await A.editEntry('a1', { title: 'A after damage' });
r = await B.sync(); assert.ok(r.errors.length >= 1, 'reported');
r = await A.sync(); assert.ok(r.errors.length >= 1 && /not overwriting|decrypt/.test(r.errors.join()), 'A does not push over a file it cannot read');
assert.deepEqual([...files.get(victim).body], new Array(40).fill(7), 'the damaged file is untouched');
setRaw(victim, good);

// ── a wrong place (re-created on the server) stops the run ──
const fresh = await createMeta('other', { iterations: 1000 });
await assert.rejects(() => A.sync({ meta: fresh.meta, keys: fresh.keys }), /set up again/);

// ── joining a place that already has data: remote wins conflicts, local-only records are pushed ──
const C = device('C');
await C.addArticle('a1', { title: 'C local title' }); await C.addArticle('c-only');
let backups = 0;
r = await C.sync({ backup: async () => { backups++; } });
assert.equal(backups, 1, 'the local backup ran before the first sync');
assert.notEqual(C.entry('a1').title, 'C local title', 'the server value won the conflict');
assert.ok(files.has('sync/r/' + await nameOf(K.keys, 'article', 'c-only')), 'a local-only article was pushed');
await C.sync({ backup: async () => { backups++; } }); assert.equal(backups, 1, 'the backup runs once, not on every sync');
// a failing backup stops the join before anything is written
const D = device('D'); await D.addArticle('d1'); const putsBefore = puts();
await assert.rejects(() => D.sync({ backup: async () => { throw new Error('disk full'); } }), /disk full/);
assert.equal(puts(), putsBefore); assert.equal(D.index().length, 1, 'nothing changed on D');

// ── 412: the server copy changed between our listing and our PUT ──
await A.editEntry('a1', { title: 'A wants this' });
let raced = false, store412;
if (FOLDER || S3) { const base = mkStore(); store412 = { ...base, put: async (p, b, o = {}) => { if (!raced && /^r\//.test(p) && o.ifMatch) { raced = true; o = { ...o, ifMatch: 'stale' }; } return base.put(p, b, o); } }; }
else { const realPut = dav.fetchFn; const racing = (url, init = {}) => { if (!raced && init.method === 'PUT' && /\/r\//.test(url)) { raced = true; return realPut(url, { ...init, headers: { ...init.headers, 'if-match': '"stale"' } }); } return realPut(url, init); }; store412 = createWebdavStore(cfg, { fetchFn: racing }); }
r = await syncEncryptedPlace({ place: { id: 'p1' }, storage: A.area, store: store412, keys: K.keys, meta: K.meta, stampStore: A.st, adapter: A.adapter }); await A.idle();
assert.ok(raced, 'the PUT was refused with 412'); assert.equal(r.errors.length, 0, 'a 412 is merged and retried: ' + r.errors.join());
await B.sync(); assert.equal(B.entry('a1').title, 'A wants this');

// ── the time budget: stops, remembers, finishes next time ──
const E = device('E'); for (let i = 0; i < 6; i++) await E.addArticle('e' + i);
let tick = 0; r = await E.sync({ chunk: 2, budgetMs: 3, now: () => (tick += 2) });
assert.ok(r.more && r.pushed < 6, 'stopped early: ' + JSON.stringify(r));
r = await E.sync({ chunk: 2 }); assert.ok(!r.more);
await B.sync(); assert.ok(['e0', 'e5'].every((id) => B.entry(id)), 'everything arrived after the resume');
console.log('TEST 200 OK');
process.exit(0);
