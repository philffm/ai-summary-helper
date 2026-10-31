// Housekeeping of two-way sync: a deletion marker is removed once it is old, a device that was away longer than that does not push
// old records back, and a flood of deletions from another device is asked about instead of applied.
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

// ── an old deletion marker goes: the remote file and the local stamp, once nothing else is wrong ──
await reset();
{
  const A = device('A'), B = device('B');
  await A.addArticle('keep'); await A.addArticle('gone');
  await A.sync(); await B.sync(); assert.ok(B.entry('gone'));
  await A.deleteArticle('gone');                       // the marker is 200 days old by the stamp clock
  const stampsBefore = Object.keys(await A.st.all()).length;
  let r = await A.sync({ tombstoneTtlMs: 400 * DAY }); assert.equal(r.purged, 0, 'a young marker stays'); assert.equal(serverFiles(), 2);
  r = await A.sync({ tombstoneTtlMs: 90 * DAY });
  assert.equal(r.purged, 1, 'an old one goes'); assert.equal(serverFiles(), 1, 'its file is removed from the server');
  assert.equal(Object.keys(await A.st.all()).length, stampsBefore - 1, 'and its stamp from this device'); assert.ok(!(await A.st.all())['article:gone']);
  assert.ok(A.entry('keep'), 'live records are never purged');
  await A.sync({ tombstoneTtlMs: 90 * DAY }); assert.equal(serverFiles(), 1);
}

// ── a device that was away longer than the markers are kept does not push its old, unchanged records back ──
await reset();
{
  const A = device('A'), S = device('S');
  await A.addArticle('current');
  await S.addArticle('old-on-S');                      // exists only here; it may have been deleted elsewhere and the marker forgotten
  await S.area.set({ [syncLedgerKey('p1')]: { joined: 1, salt: created.meta.salt, items: {}, dirty: [], lastSync: Date.now() - 120 * DAY } });
  await A.sync();
  let r = await S.sync({ tombstoneTtlMs: 90 * DAY });
  assert.ok(r.stale, 'S knows it was away'); assert.equal(serverFiles(), 1, 'its old record was not pushed'); assert.ok(S.entry('old-on-S'), 'and it is not deleted either');
  assert.ok(S.entry('current'), 'it still receives what the server has');
  await S.editEntry('old-on-S', { title: 'edited again' });   // a real change since then is pushed
  r = await S.sync({ tombstoneTtlMs: 90 * DAY }); assert.ok(!r.stale, 'a completed run ends the absence'); assert.equal(serverFiles(), 2, 'edited records are sent');
}

// ── another device deletes a lot: a few are applied, the rest wait for a yes ──
await reset();
{
  const A = device('A'), B = device('B');
  for (let i = 0; i < 24; i++) await A.addArticle('x' + i);
  await A.sync(); await B.sync(); assert.equal(B.index().length, 24);
  for (let i = 0; i < 18; i++) await B.deleteArticle('x' + i);
  await B.sync();
  let r = await A.sync();
  assert.equal(r.needsConfirm, 18 - 10, 'ten are applied, the rest are asked about'); assert.equal(A.index().length, 24 - 10, 'nothing beyond the limit is deleted');
  r = await A.sync(); assert.equal(r.needsConfirm, 8, 'still waiting, still not deleted: asking again does not wear the limit down'); assert.equal(A.index().length, 14);
  r = await A.sync(); assert.equal(r.needsConfirm, 8); assert.equal(A.index().length, 14);
  r = await A.sync({ confirmDeletes: true }); assert.equal(r.needsConfirm, 0); assert.equal(A.index().length, 6, 'confirmed: they are deleted');
  await B.sync(); await A.sync(); assert.deepEqual(await A.stampsJson(), await B.stampsJson());
  // a handful of deletions is not questioned
  await B.deleteArticle('x20'); await B.deleteArticle('x21'); await B.sync(); r = await A.sync(); assert.equal(r.needsConfirm, 0); assert.ok(!A.entry('x20'));
}
console.log('TEST 207 OK');
process.exit(0);
