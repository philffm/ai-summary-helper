// Joining a place when a run breaks off half-way: what was not written must not count as seen, and older data here must
// never replace the newer data on the server. Also repairs the state earlier versions left behind (ledger without `v`).
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
let fail = false;
const hooks = { compose: (base) => { if (fail && String(base).includes('_breaks')) throw new Error('broke off'); return base; }, count: (h) => String(h).split(/\s+/).length };

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
  const d = { label, data, area, st, adapter: createDataAdapter({ storage: area, hooks }),
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

const created = await loadOrCreateMeta(mkStore(), { createMeta, passphrase: 'pw', iterations: 1000 });
const K = { meta: created.meta, keys: created.keys };
const ids = ['a_same', 'b_breaks', 'c_differs', 'd_onlycloud', 'e_breaks', 'f_differs'];
const add = (d, id, old) => { const t = (old ? 'old ' : 'cloud ') + id; return d.addArticle(id, { title: t }, { content: '<p>' + t + '</p>', summaryBase: t, summary: t }); };
const view = (d) => Object.fromEntries(d.index().map((e) => [e.id, [e.title, (d.rec(e.id) || {}).content, (d.rec(e.id) || {}).summary].join(' | ')]).sort());
const small = { chunk: 1, concurrency: 1 };

async function cloudAndDevice() {
  files.clear(); fail = false;
  const A = device('A'), B = device('B');
  for (const id of ids) await add(A, id, false);
  await A.sync();
  for (const id of ids.filter((x) => x !== 'd_onlycloud')) await add(B, id, id.includes('differs'));
  await add(B, 'z_onlyhere', true); await B.st.scan({ full: true }); await B.idle();
  return { A, B };
}
async function finish(A, B, label) {
  for (let i = 0; i < 3; i++) await B.sync(small);
  await A.sync(); await A.sync();
  for (const id of ids) {
    const cloud = `cloud ${id} | <p>cloud ${id}</p> | cloud ${id}`;
    assert.equal(view(A)[id], cloud, `${label}: the server keeps its data (${id})`);
    assert.equal(view(B)[id], cloud, `${label}: this device has the server's data (${id})`);
  }
  assert.ok(view(A).z_onlyhere, `${label}: what only this device had goes up`);
}

// ── runs that break off while writing ──
for (const broken of [1, 2, 3]) {
  const { A, B } = await cloudAndDevice();
  fail = true;
  for (let i = 0; i < broken; i++) { await assert.rejects(B.sync(small), /broke off/); await B.idle(); await B.st.scan(); }
  assert.equal(B.data.get(syncLedgerKey('p1')) && B.data.get(syncLedgerKey('p1')).joined, B.data.get(syncLedgerKey('p1')) && 0, 'a join that broke off does not count as joined');
  fail = false;
  await finish(A, B, `${broken} broken run(s)`);
  assert.equal(B.data.get(syncLedgerKey('p1')).joined, 1);
}

// ── what an earlier version left: stamps taken over for data that was never written, a ledger that says "joined" ──
{
  const { A, B } = await cloudAndDevice();
  const theirs = await A.st.all();
  await B.st.adopt({ 'article:c_differs': theirs['article:c_differs'], 'article:f_differs': theirs['article:f_differs'] });
  B.st.release(['article:c_differs', 'article:f_differs']);
  await B.area.set({ [syncLedgerKey('p1')]: { joined: 1, salt: K.meta.salt, items: {}, dirty: ['article:c_differs'], lastSync: 0 } }); await B.idle();
  await B.st.scan(); await B.idle();
  await finish(A, B, 'an unfinished join from before');
}

// ── a file that cannot be read during the join is joined later, and nothing is pushed over it ──
{
  const { A, B } = await cloudAndDevice();
  const path = [...files.keys()].find((p) => p.startsWith('sync/r/'));
  const good = files.get(path); setRaw(path, new TextEncoder().encode('not readable'));
  const r = await B.sync(small); assert.equal(r.errors.length, 1);
  assert.equal(new TextDecoder().decode(files.get(path).body), 'not readable', 'left alone');
  files.set(path, { ...good, etag: 'again' + Math.random() });
  await finish(A, B, 'a read error during the join');
}
// ── a long join: every record is read once, again only after a run that did not stop on purpose ──
{
  const { A, B } = await cloudAndDevice();
  const scans = []; const scan = B.st.scan; B.st.scan = (o) => { scans.push(!!(o && o.full)); return scan(o); };
  const outOfTime = { ...small, budgetMs: 0, now: (() => { let t = 0; return () => (t += 1); })() };
  let r = await B.sync({ ...small, budgetMs: 2, now: outOfTime.now });
  assert.ok(r.more && r.pulled > 0, 'the run stopped on its time budget');
  assert.equal(B.data.get(syncLedgerKey('p1')).clean, 1);
  r = await B.sync({ ...small, budgetMs: 2, now: outOfTime.now });
  assert.deepEqual(scans, [true, false], 'the following run does not read everything again');
  fail = true; await assert.rejects(B.sync(small), /broke off/); await B.idle();
  assert.equal(B.data.get(syncLedgerKey('p1')).clean, 0, 'a run that broke off leaves no clean mark');
  fail = false; scans.length = 0;
  await finish(A, B, 'a join in several runs');
  assert.equal(scans[0], true, 'after a break everything is read again');
}
console.log('test286 passed');
