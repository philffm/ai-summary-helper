// Sync service: servers and places, validation, adding (tested first), several folders on one server, publishing, status, errors, removal, migration.
import assert from 'assert';
import path from 'path'; import { pathToFileURL } from 'url';
import { setup, imp } from './harness.mjs';
import { createFakeDav } from './fakeDav.mjs';
const { store: local } = setup({});
const K = await imp('modules/storageKeys.js');
const S = await imp('modules/syncService.js');
const SS = await imp('modules/syncStampStore.js');
const W = await import(pathToFileURL(path.resolve(process.env.AISH_SRC, 'modules/syncWebdav.js')).href);
const { SK, articleRecKey, syncLedgerKey } = K;

const dav = createFakeDav();
const makeStore = (conn, place, secret) => W.createWebdavStore({ url: conn.url, root: place.root, username: conn.username, password: secret.password, allowInsecureLan: conn.allowInsecureLan }, { fetchFn: dav.fetchFn });
const stampStore = SS.createStampStore({ storage: chrome.storage.local });
let soon = 0;
const svc = S.createSyncService({ storage: chrome.storage.local, makeStore, stampStore, scheduleSoon: () => { soon++; } });

local[SK.articlesIndex] = [
    { id: 'a1', url: 'https://x.test/a1', title: 'One', timestamp: '2026-03-01T00:00:00Z', tags: ['public'], summary: 's' },
    { id: 'a2', url: 'https://x.test/a2', title: 'Two', timestamp: '2026-03-02T00:00:00Z', tags: ['private'], summary: 's' },
];
for (const id of ['a1', 'a2']) local[articleRecKey(id)] = { content: 'c', summary: 's' };
const server = { service: 'webdav', name: 'My Nextcloud', url: 'https://cloud.test/dav/', username: 'phil' };
const place = { name: 'Website list', root: '/public/', scope: 'tag', filter: { tag: 'public' } };

// validation: servers
assert.throws(() => S.cleanConnection({ ...server, service: 's3' }), /not available/);
assert.throws(() => S.cleanConnection({ ...server, url: 'not a url' }), /address/);
assert.throws(() => S.cleanConnection({ ...server, url: 'http://cloud.test/dav/' }), /https/);
assert.equal(S.cleanConnection({ ...server, name: '' }).name, 'cloud.test', 'the host names a server without a name');
// validation: places
assert.throws(() => S.cleanPlace({ ...place }), /Choose a server/);
const enc = S.cleanPlace({ ...place, connectionId: 'c', mode: 'encrypted', scope: undefined, filter: undefined, viewer: true, include: { notes: true } });
assert.deepEqual([enc.mode, enc.direction, enc.scope, enc.viewer, enc.include.notes], ['encrypted', 'twoway', 'all', false, false], 'an encrypted place takes everything and never publishes readable extras');
assert.equal(S.cleanPlace({ ...place, connectionId: 'c', mode: 'encrypted', direction: 'push' }).direction, 'push', 'a backup only writes');
assert.throws(() => S.cleanPlace({ ...place, connectionId: 'c', direction: 'twoway' }), /not available/, 'a readable place cannot sync both ways');
assert.equal(S.cleanConnection({ service: 'folder', name: ' Syncthing ' }).service, 'folder');
assert.throws(() => S.cleanPlace({ ...place, connectionId: 'c', scope: undefined, filter: {} }), /Choose which articles/, 'everything is a deliberate choice');
assert.throws(() => S.cleanPlace({ ...place, connectionId: 'c', scope: 'tag', filter: { tag: ' ' } }), /Enter the tag/);
assert.throws(() => S.cleanPlace({ ...place, connectionId: 'c', scope: 'except', filter: {} }), /leave out/);
const everything = S.cleanPlace({ ...place, connectionId: 'c', scope: 'all', filter: { tag: 'ignored' } });
assert.equal(everything.scope, 'all'); assert.deepEqual(everything.filter, {});
const clean = S.cleanPlace({ ...place, connectionId: 'c' });
assert.equal(clean.root, 'public'); assert.deepEqual(clean.include, { highlights: true, qa: false, notes: false, reminders: false, fulltext: false }); assert.ok(/^pl_/.test(clean.id));
assert.equal(S.cleanPlace({ connectionId: 'c', filter: { excludeTag: 'private' } }).scope, 'except', 'an older place with only a filter keeps working');

// preview and tests save nothing
assert.deepEqual(await svc.preview(place), { count: 1 });
assert.deepEqual(await svc.preview({ ...place, scope: 'all' }), { count: 2 });
assert.deepEqual(await svc.preview({ ...place, scope: 'except', filter: { excludeTag: 'public' } }), { count: 1 });
assert.deepEqual(await svc.testServer({ connection: server, secret: { password: 'secret' } }), { ok: true });
let t = await svc.testServer({ connection: server, secret: { password: 'wrong' } });
assert.equal(t.ok, false); assert.equal(t.error.kind, 'auth'); assert.match(t.error.message, /username and password/);
assert.deepEqual(await svc.test({ connection: server, place, secret: { password: 'secret' } }), { ok: true, count: 1 });
assert.ok(!(SK.syncPlaces in local) && !(SK.syncConnections in local), 'testing saves nothing');

// add: a wrong login is refused and nothing is stored; a good one saves server, login (apart) and place; the library is stamped
await assert.rejects(() => svc.add({ connection: server, place, secret: { password: 'wrong' } }), (e) => e.kind === 'auth');
assert.ok(!(SK.syncPlaces in local) && !(SK.syncSecrets in local));
const pub = await svc.add({ connection: server, place, secret: { password: 'secret' } });
assert.equal(local[SK.syncPlaces].length, 1); assert.equal(local[SK.syncConnections].length, 1);
const connId = local[SK.syncConnections][0].id;
assert.equal(pub.connectionId, connId); assert.equal(local[SK.syncSecrets][connId].password, 'secret');
assert.ok(!JSON.stringify([local[SK.syncPlaces], local[SK.syncConnections]]).includes('secret'), 'the password is in the secrets only');
assert.ok(!('url' in local[SK.syncPlaces][0]), 'a place has no address of its own');
assert.ok(Object.keys(await stampStore.all()).includes('article:a1'), 'adding a place stamps the existing library');
assert.ok(soon >= 1);

// a second folder on the same server: no login typed again, its own scope
const bak = await svc.add({ connectionId: connId, place: { name: 'Everything', root: 'backup', scope: 'all' } });
assert.equal(local[SK.syncConnections].length, 1, 'the server is shared'); assert.equal(bak.connectionId, connId);
assert.equal(local[SK.syncPlaces].length, 2);
assert.deepEqual(await svc.test({ connectionId: connId, place: { root: 'backup', scope: 'all' } }), { ok: true, count: 2 });

// sync now: each place publishes into its own folder; the status is recorded
const res = await svc.syncNow();
assert.equal(res[pub.id].pushed, 1); assert.equal(res[bak.id].pushed, 2);
assert.ok(dav.text('public/articles/a1.json') && !dav.text('public/articles/a2.json'), 'public holds only the tagged article');
assert.ok(dav.text('backup/articles/a1.json') && dav.text('backup/articles/a2.json'), 'backup holds everything');
let st = (await svc.statusNow())[pub.id];
assert.ok(st.ok && st.pushed === 1 && st.at && !('running' in st));

// while it runs, the status says what it is doing
const seen = [];
const spy = S.createSyncService({ storage: chrome.storage.local, stampStore, scheduleSoon: () => {}, makeStore: (c, pl, sec) => { const s = makeStore(c, pl, sec); const put = s.put; s.put = async (...a) => { seen.push(JSON.parse(JSON.stringify(local[SK.syncStatus] || {}))); return put(...a); }; return s; } });
local[syncLedgerKey(pub.id)] = {};
await spy.syncNow(pub.id);
const mid = seen.find((x) => x[pub.id] && x[pub.id].running && x[pub.id].running.phase === 'uploading');
assert.ok(mid && mid[pub.id].running.total === 1 && mid[pub.id].running.since, 'running progress was visible during the upload');

// changing a place: the scope republishes; update keeps ids and the login
const upd = await svc.update(pub.id, { filter: { tag: 'private' } });
assert.equal(upd.id, pub.id); assert.equal(upd.created, pub.created); assert.equal(local[SK.syncSecrets][connId].password, 'secret');
await svc.syncNow(pub.id);
assert.ok(dav.text('public/articles/a2.json') && !dav.text('public/articles/a1.json'));
await svc.update(pub.id, { filter: { tag: 'public' } });

// changing the server's login applies to every place on it; a wrong one shows as an auth error and does not throw
await svc.updateServer(connId, {}, { password: 'changed-on-server' });
assert.equal(local[SK.syncSecrets][connId].password, 'changed-on-server');
const bad = await svc.syncNow(pub.id);
assert.equal(bad[pub.id].error.kind, 'auth');
st = (await svc.statusNow())[pub.id]; assert.equal(st.ok, false); assert.equal(st.error.kind, 'auth');
await svc.updateServer(connId, {}, { password: 'secret' });
assert.equal((await svc.syncNow(pub.id))[pub.id].error, undefined);

// a place that is switched off is skipped
await svc.update(bak.id, { enabled: false });
assert.deepEqual(Object.keys(await svc.syncNow()), [pub.id]);
await svc.update(bak.id, { enabled: true });

// removing a place keeps the server while another place uses it; the last one takes the server and its login with it
await svc.remove(bak.id);
assert.equal(local[SK.syncPlaces].length, 1); assert.equal(local[SK.syncConnections].length, 1); assert.ok(connId in local[SK.syncSecrets]);
assert.ok(!(syncLedgerKey(bak.id) in local) && !(bak.id in local[SK.syncStatus]));
await svc.remove(pub.id);
assert.deepEqual(local[SK.syncPlaces], []); assert.deepEqual(local[SK.syncConnections], []); assert.ok(!(connId in local[SK.syncSecrets]));
assert.ok(dav.text('public/library.json'), 'files on the server are left alone');
assert.deepEqual(await svc.syncNow(), {});

// places made before servers were split out are migrated: own server, login moves along
local[SK.syncPlaces] = [{ id: 'pl_old', name: 'Old', service: 'webdav', url: 'https://cloud.test/dav/', root: 'site', username: 'phil', mode: 'readable', direction: 'publish', scope: 'tag', filter: { tag: 'public' }, include: { highlights: true, qa: false }, enabled: true, created: '2026-10-30T00:00:00Z' }];
local[SK.syncSecrets] = { pl_old: { password: 'secret' } };
local[SK.syncConnections] = [];
const migrated = await svc.placesNow();
assert.equal(migrated[0].connectionId, 'cn_old'); assert.ok(!('url' in migrated[0]) && !('username' in migrated[0]));
assert.equal(local[SK.syncConnections][0].url, 'https://cloud.test/dav/'); assert.equal(local[SK.syncSecrets].cn_old.password, 'secret'); assert.ok(!('pl_old' in local[SK.syncSecrets]));
const ran = await svc.syncNow('pl_old');
assert.ok(ran.pl_old.pushed >= 1, 'a migrated place still publishes');
assert.deepEqual((await svc.placesNow()).map((p) => p.id), ['pl_old'], 'migrating twice changes nothing');

console.log('TEST 189 OK');
process.exit(0);
