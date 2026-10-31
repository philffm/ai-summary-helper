// The same URL saved on several devices becomes one article: same winner on every device and in every order, fields filled with
// their original stamps, collections follow, highlights stay, different query strings stay apart, nothing is rewritten afterwards.
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
const { articleKey } = await imp('modules/syncIdentity.js');

// identity: tracking and decoration are ignored, anything that names a different page is not
assert.equal(articleKey('https://www.Example.com/post/?utm_source=x&fbclid=1#top'), articleKey('http://example.com/post'));
assert.notEqual(articleKey('https://example.com/post.php?p=12'), articleKey('https://example.com/post.php?p=13'), 'a different query is a different page');
assert.equal(articleKey('https://example.com/p?b=2&a=1'), articleKey('https://example.com/p?a=1&b=2'), 'parameter order does not matter');
assert.equal(articleKey('https://example.com/'), '', 'a site address alone is not an article'); assert.equal(articleKey('chrome://settings'), ''); assert.equal(articleKey('not a url'), '');
assert.equal(articleKey('https://web.archive.org/web/20240101000000/https://example.com/post'), articleKey('https://example.com/post'), 'an archive copy is the original');

const dav = createFakeDav();
const cfg = { url: 'https://cloud.test/dav/', root: 'sync', username: 'phil', password: 'secret' };
const mkStore = () => createWebdavStore(cfg, { fetchFn: dav.fetchFn });
await mkStore().ping();
let clock = 1_000_000;
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
    async sync(extra = {}) { await d.idle(); const r = await syncEncryptedPlace({ place: { id: 'p1' }, storage: area, store: mkStore(), keys: K.keys, meta: K.meta, stampStore: st, adapter: d.adapter, now: () => Date.now(), ...extra }); await d.idle(); return r; },
    entry: (id) => d.index().find((e) => e.id === id), rec: (id) => data.get(articleRecKey(id)),
    stampsJson: async () => JSON.parse(JSON.stringify(await st.all())) };
  return d;
}


const U = 'https://news.example/story';
const live = (dev, url = U) => dev.index().filter((e) => articleKey(e.url) === articleKey(url));
const settle = async (...devs) => { for (let i = 0; i < 3; i++) for (const d of devs) await d.sync(); };
const same = async (A, B) => assert.deepEqual(await A.stampsJson(), await B.stampsJson(), 'identical stamps');

for (const order of ['A first', 'B first']) {
  dav.files.clear(); dav.dirs.clear(); dav.dirs.add(''); await mkStore().ping(); await mkStore().put('meta.json', JSON.stringify(created.meta));
  const A = device('A'), B = device('B');
  await A.addArticle('a-1', { url: U, timestamp: '2026-01-01T00:00:00Z', tags: ['x'], title: 'From A' }, { content: '<p>A text</p>' });
  await B.addArticle('b-1', { url: U + '?utm_source=mail', timestamp: '2026-02-01T00:00:00Z', tags: ['y'], title: 'From B' }, { content: '<p>B text</p>', conversation: [{ q: 'Why?', a: 'Because', pinned: false }] });
  await A.addArticle('a-2', { url: 'https://news.example/q.php?p=1' }); await B.addArticle('b-2', { url: 'https://news.example/q.php?p=2' });
  await A.addColl('cA', ['a-1']); await B.addColl('cB', ['b-1']);
  await A.addHl('h-a', U); await B.addHl('h-b', U);
  if (order === 'A first') await settle(A, B); else await settle(B, A);
  for (const dev of [A, B]) {
    assert.equal(live(dev).length, 1, order + ': one article for the URL on ' + dev.label); assert.equal(live(dev)[0].id, 'a-1', 'the earliest saved stays, on every device');
    assert.deepEqual([...dev.entry('a-1').tags].sort(), ['x', 'y'], 'tags from both');
    assert.equal(dev.entry('a-1').title, 'From A', 'the winner keeps its own identity fields'); assert.equal(dev.rec('a-1').content, '<p>A text</p>');
    assert.equal(dev.rec('a-1').conversation.length, 1, 'what only the other copy had is filled in');
    assert.ok(!dev.rec('b-1'), 'the other copy is gone');
    assert.deepEqual(dev.index().map((e) => e.id).sort(), ['a-1', 'a-2', 'b-2'], 'different query strings stay apart');
    assert.deepEqual(dev.data.get(collRecKey('cB')).sources.map((x) => x.articleId), ['a-1'], 'the collection follows'); assert.deepEqual(dev.data.get(collRecKey('cB')).overview.ids, ['a-1']);
    assert.deepEqual(dev.data.get(collRecKey('cA')).sources.map((x) => x.articleId), ['a-1']);
    assert.deepEqual((dev.data.get(SK.annotations) || []).map((h) => h.id).sort(), ['h-a', 'h-b'], 'highlights belong to the URL and stay');
  }
  await same(A, B);
  const before = puts(); await settle(A, B); assert.equal(puts(), before, order + ': nothing is rewritten after convergence');

  // a third device with its own copy of the same URL joins: still one, still the same one
  const C = device('C'); await C.addArticle('c-1', { url: U, timestamp: '2026-03-01T00:00:00Z', tags: ['z'] });
  await settle(C, A, B);
  for (const dev of [A, B, C]) { assert.equal(live(dev).length, 1); assert.equal(live(dev)[0].id, 'a-1'); assert.deepEqual([...dev.entry('a-1').tags].sort(), ['x', 'y', 'z']); }
  await same(A, C); const b2 = puts(); await settle(A, B, C); assert.equal(puts(), b2);
}

// a real edit made elsewhere before the fill arrives beats the fill, because the fill keeps the stamp it had
dav.files.clear(); dav.dirs.clear(); dav.dirs.add(''); await mkStore().ping(); await mkStore().put('meta.json', JSON.stringify(created.meta));
{
  const A = device('A'), B = device('B'), C = device('C');
  await A.addArticle('a-1', { url: U, timestamp: '2026-01-01T00:00:00Z' });
  await B.addArticle('b-1', { url: U, timestamp: '2026-02-01T00:00:00Z' }, { description: 'from the other copy' });
  await A.sync(); await C.sync();
  await C.editRec('a-1', { description: 'C real edit' });   // later than the other copy's value, not synced yet
  await B.sync();                                            // B merges the twins and fills the description from its own copy
  await settle(C, A, B);
  for (const dev of [A, B, C]) assert.equal(dev.rec('a-1').description, 'C real edit', dev.label + ': the real edit survives the automatic fill');
  await same(A, C);
}

// repeated saves of one URL on a single device are left alone until another device is involved; then the group collapses like any other
dav.files.clear(); dav.dirs.clear(); dav.dirs.add(''); await mkStore().ping(); await mkStore().put('meta.json', JSON.stringify(created.meta));
{
  const A = device('A'), B = device('B'), T = 'https://x.example/t';
  await A.addArticle('t-1', { url: T, timestamp: '2026-01-01T00:00:00Z' }); await A.addArticle('t-2', { url: T, timestamp: '2026-01-02T00:00:00Z' });
  await A.sync(); assert.equal(live(A, T).length, 2, 'alone, nothing is merged');
  await settle(B, A, B);
  for (const dev of [A, B]) { assert.equal(live(dev, T).length, 1, dev.label + ': one copy once a second device has seen both'); assert.equal(live(dev, T)[0].id, 't-1'); }
  await same(A, B);
}
console.log('TEST 206 OK');
process.exit(0);
