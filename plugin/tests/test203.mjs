// Encrypted places through the service: create (recovery key), join (wrong passphrase, recovery key, backup first), sync both ways, backup place, restore.
import assert from 'assert';
import path from 'path'; import { pathToFileURL } from 'url';
import { setup, imp } from './harness.mjs';
import { createFakeDav } from './fakeDav.mjs';
const { store: local1 } = setup({});
const { SK, articleRecKey } = await imp('modules/storageKeys.js');
const S = await imp('modules/syncService.js'), SS = await imp('modules/syncStampStore.js');
const W = await import(pathToFileURL(path.resolve(process.env.AISH_SRC, 'modules/syncWebdav.js')).href);
const dav = createFakeDav();
const makeStore = (conn, place, secret) => W.createWebdavStore({ url: conn.url, root: place.root, username: conn.username, password: secret.password }, { fetchFn: dav.fetchFn });
// a second device: its own plain storage
const data2 = new Map();
const area2 = { get: (k) => { const o = {}; if (k == null) data2.forEach((v, kk) => { o[kk] = v; }); else if (typeof k === 'string') { if (data2.has(k)) o[k] = data2.get(k); } else if (Array.isArray(k)) k.forEach((kk) => { if (data2.has(kk)) o[kk] = data2.get(kk); }); else for (const [kk, d] of Object.entries(k)) o[kk] = data2.has(kk) ? data2.get(kk) : d; return Promise.resolve(JSON.parse(JSON.stringify(o))); }, set: (o) => { for (const [k, v] of Object.entries(o)) data2.set(k, JSON.parse(JSON.stringify(v))); return Promise.resolve(); }, remove: (k, cb) => { [].concat(k).forEach((x) => data2.delete(x)); if (cb) cb(); return Promise.resolve(); } };
const svc1 = S.createSyncService({ storage: chrome.storage.local, makeStore, stampStore: SS.createStampStore({ storage: chrome.storage.local }), scheduleSoon: () => {} });
const svc2 = S.createSyncService({ storage: area2, makeStore, stampStore: SS.createStampStore({ storage: area2 }), scheduleSoon: () => {} });

local1[SK.articlesIndex] = [{ id: 'a1', url: 'https://x.test/a1', title: 'One', timestamp: '2026-03-01T00:00:00Z', tags: ['public'], summary: 's' }, { id: 'a2', url: 'https://x.test/a2', title: 'Two', timestamp: '2026-03-02T00:00:00Z', tags: [], summary: 's' }];
for (const id of ['a1', 'a2']) local1[articleRecKey(id)] = { content: '<p>text ' + id + '</p>', summary: 's' };
const server = { service: 'webdav', name: 'Cloud', url: 'https://cloud.test/dav/', username: 'phil' };
const form = { name: 'All devices', root: 'sync', mode: 'encrypted', direction: 'twoway' };

// create: a short passphrase is refused; the first device gets a recovery key, the passphrase is never stored
const t1 = await svc1.test({ connection: server, place: form, secret: { password: 'secret' } }); assert.ok(t1.ok && t1.existing === false);
await assert.rejects(() => svc1.add({ connection: server, place: { ...form, passphrase: 'short' }, secret: { password: 'secret' } }), /at least 12/);
const added = await svc1.add({ connection: server, place: { ...form, passphrase: 'a long passphrase' }, secret: { password: 'secret' } });
assert.match(added.recoveryKey, /^([A-Z2-7]{4}-)+/); assert.equal(added.mode, 'encrypted');
const saved = local1[SK.syncPlaces][0]; assert.ok(!('recoveryKey' in saved) && !('passphrase' in saved), 'neither is saved with the place');
assert.ok(!JSON.stringify(local1[SK.syncPlaces]).includes('long passphrase') && local1[SK.syncSecrets]['k:' + added.id].master, 'the key is kept in the secrets, which backups leave out');
assert.equal(await svc1.recoveryKey(added.id), added.recoveryKey);
let r = (await svc1.syncNow(added.id))[added.id]; assert.ok(r.pushed >= 2 && !r.errors.length, JSON.stringify(r));
assert.equal(local1[SK.syncStatus][added.id].ok, true);

// join from a second device
const t2 = await svc2.test({ connection: server, place: form, secret: { password: 'secret' } }); assert.equal(t2.existing, true, 'the folder already holds a place');
const join = (extra) => svc2.add({ connection: server, place: { ...form, ...extra }, secret: { password: 'secret' } });
await assert.rejects(() => join({ passphrase: 'wrong passphrase', ackBackup: true }), /Wrong passphrase/);
await assert.rejects(() => join({ passphrase: 'a long passphrase' }), /backup of this device first/);
assert.equal((data2.get(SK.syncPlaces) || []).length, 0, 'nothing saved by the failed attempts');
const joined = await join({ recoveryKey: added.recoveryKey, ackBackup: true }); assert.ok(!joined.recoveryKey, 'joining does not make a new recovery key');
r = (await svc2.syncNow(joined.id))[joined.id]; assert.ok(r.pulled >= 2 && !r.errors.length, JSON.stringify(r));
assert.deepEqual((data2.get(SK.articlesIndex) || []).map((e) => e.id).sort(), ['a1', 'a2']); assert.equal(data2.get(articleRecKey('a1')).content, '<p>text a1</p>');

// restore: an article lost on device 2 (removed without a delete, as a reset or pruning would) comes back; nothing is deleted
data2.set(SK.articlesIndex, data2.get(SK.articlesIndex).filter((e) => e.id !== 'a1')); data2.delete(articleRecKey('a1'));
const rr = await svc2.restore(joined.id); assert.ok(rr.applied >= 1, JSON.stringify(rr));
assert.deepEqual((data2.get(SK.articlesIndex) || []).map((e) => e.id).sort(), ['a1', 'a2'], 'restored'); assert.equal(data2.get(articleRecKey('a1')).content, '<p>text a1</p>');
await assert.rejects(() => svc2.restore('nope'), /encrypted place/);

// a backup place only writes: a change on the server does not come back
const bk = await svc1.add({ connectionId: (await svc1.connectionsNow())[0].id, place: { name: 'Backup', root: 'backup', mode: 'encrypted', direction: 'push', passphrase: 'another passphrase' } });
assert.equal(bk.direction, 'push'); r = (await svc1.syncNow(bk.id))[bk.id]; assert.ok(r.pushed >= 2 && !r.pulled, JSON.stringify(r));

// removing a place takes its key with it
await svc1.remove(added.id); assert.ok(!local1[SK.syncSecrets]['k:' + added.id]);
// a place whose key is gone says so and does nothing
local1[SK.syncSecrets] = { ...local1[SK.syncSecrets] }; delete local1[SK.syncSecrets]['k:' + bk.id];
r = (await svc1.syncNow(bk.id))[bk.id]; assert.match(r.error.message, /key for this place is not on this device/);
// an S3 server: bucket and access key are required, the place works like any other
const { createFakeS3 } = await import('./fakeS3.mjs'); const { createS3Store } = await import(pathToFileURL(path.resolve(process.env.AISH_SRC, 'modules/syncS3.js')).href);
const fs3 = createFakeS3({ bucket: 'bucket1' });
assert.throws(() => S.cleanConnection({ service: 's3', url: 'https://s3.test', bucket: 'b' }), /access key ID/); assert.throws(() => S.cleanConnection({ service: 's3', url: 'https://s3.test', username: 'k', bucket: 'x' }), /bucket name/);
const s3c = S.cleanConnection({ service: 's3', name: 'R2', url: 'https://s3.test', username: 'AKIDTEST', bucket: 'bucket1', region: '' }); assert.equal(s3c.region, 'us-east-1');
const s3svc = S.createSyncService({ storage: area2, makeStore: async (c, p, sec) => createS3Store({ endpoint: c.url, region: c.region, bucket: c.bucket, accessKeyId: c.username, secretAccessKey: sec.password, root: p.root }, { fetchFn: fs3.fetchFn }), stampStore: SS.createStampStore({ storage: area2 }), scheduleSoon: () => {} });
const s3add = await s3svc.add({ connection: s3c, place: { name: 'S3 backup', root: 'bk', mode: 'encrypted', direction: 'push', passphrase: 'an s3 passphrase' }, secret: { password: 'k' } });
assert.ok(s3add.recoveryKey); r = (await s3svc.syncNow(s3add.id))[s3add.id]; assert.ok(r.pushed >= 1 && !r.errors.length, JSON.stringify(r));
assert.ok([...fs3.files.keys()].some((k) => k.startsWith('bk/r/')) && fs3.files.has('bk/meta.json'));
const bad = await s3svc.testServer({ connection: { ...s3c, bucket: 'nope' }, secret: { password: 'k' } }); assert.ok(!bad.ok && /bucket was not found/.test(bad.error.message));
// a folder whose permission lapsed says so (not "wrong password")
const { createFakeFolder } = await import('./fakeFolder.mjs');
const { createFolderStore } = await import(pathToFileURL(path.resolve(process.env.AISH_SRC, 'modules/syncFolder.js')).href);
const lapsed = S.createSyncService({ storage: area2, makeStore: async () => createFolderStore({ handle: createFakeFolder({ permission: 'prompt' }).handle, root: 'x' }), scheduleSoon: () => {} });
const lt = await lapsed.test({ connection: { service: 'folder', name: 'F' }, place: { mode: 'encrypted', root: 'x', name: 'n' } });
assert.ok(!lt.ok && /Allow access to the folder again/.test(lt.error.message) && !/password/.test(lt.error.message));
console.log('TEST 203 OK'); process.exit(0);
