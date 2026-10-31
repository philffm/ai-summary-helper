// Sync service: validation, adding a place (tested first), publishing, status, errors, removal.
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
const makeStore = (place, secret) => W.createWebdavStore({ url: place.url, root: place.root, username: place.username, password: secret.password, allowInsecureLan: place.allowInsecureLan }, { fetchFn: dav.fetchFn });
const stampStore = SS.createStampStore({ storage: chrome.storage.local });
let soon = 0;
const svc = S.createSyncService({ storage: chrome.storage.local, makeStore, stampStore, scheduleSoon: () => { soon++; } });

local[SK.articlesIndex] = [
    { id: 'a1', url: 'https://x.test/a1', title: 'One', timestamp: '2026-03-01T00:00:00Z', tags: ['public'], summary: 's' },
    { id: 'a2', url: 'https://x.test/a2', title: 'Two', timestamp: '2026-03-02T00:00:00Z', tags: ['private'], summary: 's' },
];
for (const id of ['a1', 'a2']) local[articleRecKey(id)] = { content: 'c', summary: 's' };
const input = { service: 'webdav', name: 'My site', url: 'https://cloud.test/dav/', root: '/site/', username: 'phil', filter: { tag: 'public' } };

// validation
assert.throws(() => S.cleanPlace({ ...input, service: 's3' }), /not available/);
assert.throws(() => S.cleanPlace({ ...input, mode: 'encrypted' }), /Encrypted/);
assert.throws(() => S.cleanPlace({ ...input, direction: 'both' }), /Two-way/);
assert.throws(() => S.cleanPlace({ ...input, url: 'not a url' }), /address/);
assert.throws(() => S.cleanPlace({ ...input, url: 'http://cloud.test/dav/' }), /https/);
assert.throws(() => S.cleanPlace({ ...input, filter: {} }), /Choose which articles/, 'a readable place needs a scope: everything is a deliberate choice');
assert.throws(() => S.cleanPlace({ ...input, scope: 'tag', filter: { tag: ' ' } }), /Enter the tag/);
assert.throws(() => S.cleanPlace({ ...input, scope: 'except', filter: {} }), /leave out/);
const everything = S.cleanPlace({ ...input, scope: 'all', filter: { tag: 'ignored' } });
assert.equal(everything.scope, 'all'); assert.deepEqual(everything.filter, {}, 'scope all has no filter');
assert.deepEqual(S.cleanPlace({ ...input, scope: 'except', filter: { excludeTag: 'private' } }).filter, { excludeTag: 'private' });
assert.equal(S.cleanPlace(input).scope, 'tag', 'an older place with only a filter keeps working');
const clean = S.cleanPlace(input);
assert.equal(clean.root, 'site'); assert.deepEqual(clean.include, { highlights: true, qa: false }); assert.equal(clean.direction, 'publish'); assert.ok(/^pl_/.test(clean.id));

// preview and test: no saving
assert.deepEqual(await svc.preview(input), { count: 1 });
assert.deepEqual(await svc.preview({ ...input, scope: 'all' }), { count: 2 });
assert.deepEqual(await svc.preview({ ...input, scope: 'except', filter: { excludeTag: 'public' } }), { count: 1 });
let t = await svc.test(input, { password: 'secret' });
assert.deepEqual(t, { ok: true, count: 1 });
t = await svc.test(input, { password: 'wrong' });
assert.equal(t.ok, false); assert.equal(t.error.kind, 'auth'); assert.match(t.error.message, /username and password/);
assert.ok(!(SK.syncPlaces in local), 'testing saves nothing');

// add: a wrong login is refused and nothing is stored; a good one is saved with its secret apart, and the library is stamped
await assert.rejects(() => svc.add(input, { password: 'wrong' }), (e) => e.kind === 'auth');
assert.ok(!(SK.syncPlaces in local) && !(SK.syncSecrets in local));
const place = await svc.add(input, { password: 'secret' });
assert.equal(local[SK.syncPlaces].length, 1); assert.equal(local[SK.syncSecrets][place.id].password, 'secret');
assert.ok(!JSON.stringify(local[SK.syncPlaces]).includes('secret'), 'the password is not in the places list');
assert.ok(Object.keys(await stampStore.all()).includes('article:a1'), 'adding a place stamps the existing library');
assert.ok(soon >= 1, 'the first publish is scheduled');

// sync now: publishes, records the status. While it runs, the status says what it is doing.
const seen = [];
const spy = S.createSyncService({ storage: chrome.storage.local, stampStore, scheduleSoon: () => {}, makeStore: (pl, sec) => { const st = makeStore(pl, sec); const put = st.put; st.put = async (...a) => { seen.push(JSON.parse(JSON.stringify(local[SK.syncStatus] || {}))); return put(...a); }; return st; } });
const res = await spy.syncNow();
const mid = seen.find((x) => x[place.id] && x[place.id].running && x[place.id].running.phase === 'uploading');
assert.ok(mid, 'a status with running progress was visible during the upload');
assert.equal(mid[place.id].running.total, 1); assert.equal(mid[place.id].running.done, 0); assert.ok(mid[place.id].running.since);
assert.equal(res[place.id].pushed, 1);
assert.ok(dav.text('site/articles/a1.json') && !dav.text('site/articles/a2.json'));
let st = (await svc.statusNow())[place.id];
assert.ok(st.ok && st.pushed === 1 && st.at);
assert.ok(!('running' in st), 'the run is over: no running flag');
await svc.syncNow(place.id);
st = (await svc.statusNow())[place.id]; assert.equal(st.pushed, 0, 'second run: nothing to do');

// changing the filter republishes on the next run; update keeps the id, the creation time and the login
const upd = await svc.update(place.id, { filter: { tag: 'private' } });
assert.equal(upd.id, place.id); assert.equal(upd.created, place.created); assert.equal(local[SK.syncSecrets][place.id].password, 'secret');
await svc.syncNow(place.id);
assert.ok(dav.text('site/articles/a2.json') && !dav.text('site/articles/a1.json'));
await svc.update(place.id, { filter: { tag: 'public' } }, { password: 'secret' });

// a login that stopped working: the run records an auth error and does not throw
local[SK.syncSecrets][place.id].password = 'changed-on-server';
const bad = await svc.syncNow(place.id);
assert.equal(bad[place.id].error.kind, 'auth');
st = (await svc.statusNow())[place.id]; assert.equal(st.ok, false); assert.equal(st.error.kind, 'auth');
local[SK.syncSecrets][place.id].password = 'secret';

// a place that is switched off is skipped
await svc.update(place.id, { enabled: false });
assert.deepEqual(await svc.syncNow(), {});
await svc.update(place.id, { enabled: true });

// removal forgets the place, its login, status and ledger; the published files stay
assert.ok(local[syncLedgerKey(place.id)]);
await svc.remove(place.id);
assert.deepEqual(local[SK.syncPlaces], []); assert.ok(!(place.id in local[SK.syncSecrets])); assert.ok(!(place.id in local[SK.syncStatus])); assert.ok(!(syncLedgerKey(place.id) in local));
assert.ok(dav.text('site/articles/a2.json') && dav.text('site/library.json'), 'files on the server are left alone');
assert.deepEqual(await svc.syncNow(), {});

console.log('TEST 189 OK');
process.exit(0);
