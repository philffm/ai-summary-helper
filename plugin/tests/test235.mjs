// Deletions from another device, answered one by one: "Delete" applies just those beyond the guard, "Keep" stamps the record
// again here so it wins over the marker and comes back on the device that deleted it. The rest keep waiting.
import assert from 'assert';
import path from 'path'; import { pathToFileURL } from 'url';
import { createFakeDav } from './fakeDav.mjs';
const imp = (m) => import(pathToFileURL(path.resolve(process.env.AISH_SRC, m)).href);
const { SK, articleRecKey, collRecKey } = await imp('modules/storageKeys.js');
const { createStampStore } = await imp('modules/syncStampStore.js');
const { createDataAdapter } = await imp('modules/syncDataAdapter.js');
const { syncEncryptedPlace, loadOrCreateMeta } = await imp('modules/syncEngine.js');
const { createMeta } = await imp('modules/syncCrypto.js');
const { createWebdavStore } = await imp('modules/syncWebdav.js');
const { syncLedgerKey } = await imp('modules/storageKeys.js');

const dav = createFakeDav();
const cfg = { url: 'https://cloud.test/dav/', root: 'sync', username: 'phil', password: 'secret' };
const mkStore = () => createWebdavStore(cfg, { fetchFn: dav.fetchFn });
await mkStore().ping();
const DAY = 86400e3; let clock = Date.now() - 200 * DAY;   // stamps are made 200 days ago; the engine runs at the real time
const created = await loadOrCreateMeta(mkStore(), { createMeta, passphrase: 'pw', iterations: 1000 });
const K = { meta: created.meta, keys: created.keys };
const puts = () => dav.log.filter((l) => l.startsWith('PUT') && l.includes('/r/')).length;

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
    async addColl(id, sources) { await area.set({ [collRecKey(id)]: { id, name: 'Coll ' + id, sources: sources.map((a) => ({ articleId: a, addedAt: '2026-01-01' })), updated: 1, overview: { text: 'o', ids: sources } }, [SK.collIndex]: [...(data.get(SK.collIndex) || []), { id, name: 'Coll ' + id, n: sources.length }] }); await d.idle(); },
    async addHl(id, url) { await area.set({ [SK.annotations]: [...(data.get(SK.annotations) || []), { id, url, text: 'quoted', type: 'user' }] }); await d.idle(); },
    async editRec(id, patch) { await area.set({ [articleRecKey(id)]: { ...d.rec(id), ...patch } }); await d.idle(); },
    async deleteArticle(id) { await area.set({ [SK.articlesIndex]: d.index().filter((e) => e.id !== id) }); await area.remove(articleRecKey(id)); await st.markDeleted('article', [id]); await d.idle(); },
    async sync(extra = {}) { await d.idle(); const r = await syncEncryptedPlace({ place: { id: 'p1' }, storage: area, store: mkStore(), keys: K.keys, meta: K.meta, stampStore: st, adapter: d.adapter, now: () => Date.now(), tombstoneTtlMs: 400 * DAY, ...extra }); await d.idle(); return r; },
    entry: (id) => d.index().find((e) => e.id === id), rec: (id) => data.get(articleRecKey(id)),
    stampsJson: async () => JSON.parse(JSON.stringify(await st.all())) };
  return d;
}



const reset = async () => { dav.files.clear(); dav.dirs.clear(); dav.dirs.add(''); await mkStore().ping(); await mkStore().put('meta.json', JSON.stringify(created.meta)); };
const serverFiles = () => [...dav.files.keys()].filter((k) => k.includes('/r/')).length;

await reset();
{
  const A = device('A'), B = device('B');
  for (let i = 0; i < 24; i++) await A.addArticle('x' + i);
  await A.sync(); await B.sync(); assert.equal(B.index().length, 24);
  for (let i = 0; i < 18; i++) await B.deleteArticle('x' + i);
  await B.sync();
  let r = await A.sync();
  assert.equal(r.needsConfirm, 8, 'ten applied, eight asked about');
  assert.equal(r.pending.length, 8, 'the ones asked about are listed');
  assert.ok(r.pending.every((p) => /^article:x\d+$/.test(p.key) && p.at > 0), 'by record key, with the time of the deletion');
  const waiting = r.pending.map((p) => p.key);
  for (const k of waiting) assert.ok(A.entry(k.slice(8)), 'still here: ' + k);

  const [d1, d2, k1, k2] = waiting;
  r = await A.sync({ remove: [d1, d2], keep: [k1, k2] });
  assert.equal(r.needsConfirm, 4, 'the unanswered four still wait');
  assert.equal(r.kept, 2, 'two kept');
  assert.ok(!A.entry(d1.slice(8)) && !A.entry(d2.slice(8)), 'the two answered "delete" are gone');
  assert.ok(A.entry(k1.slice(8)) && A.entry(k2.slice(8)), 'the two answered "keep" stay');
  assert.deepEqual(r.pending.map((p) => p.key).sort(), waiting.slice(4).sort(), 'only the unanswered are listed again');

  await B.sync();
  assert.ok(B.entry(k1.slice(8)) && B.entry(k2.slice(8)), 'kept here: back on the device that deleted them');
  assert.ok(!B.entry(d1.slice(8)), 'deleted ones stay deleted there');

  r = await A.sync(); assert.equal(r.needsConfirm, 4, 'kept ones are not asked about again');
  r = await A.sync({ remove: waiting.slice(4) }); assert.equal(r.needsConfirm, 0); assert.equal(r.pending.length, 0);
  await B.sync(); await A.sync();
  assert.deepEqual(await A.stampsJson(), await B.stampsJson(), 'both devices agree in the end');
  assert.equal(A.index().length, B.index().length);
  assert.equal(A.index().length, 24 - 18 + 2, 'six that were never deleted plus the two kept');
}

// keep on something that is not waiting changes nothing; an unknown key is ignored
await reset();
{
  const A = device('A');
  await A.addArticle('a1'); await A.sync();
  const before = await A.stampsJson();
  const r = await A.sync({ keep: ['article:a1', 'article:nope'], remove: ['article:nope'] });
  assert.equal(r.kept, 0); assert.equal(r.needsConfirm, 0);
  assert.deepEqual(await A.stampsJson(), before, 'no new stamps');
}
console.log('TEST 235 OK');
process.exit(0);
