// A larger library over a slow server: uploads run in parallel, a run that runs out of time says how much is left and the next one
// finishes it, and two overlapping runs on one place do not step on each other.
import assert from 'assert';
import path from 'path'; import { pathToFileURL } from 'url';
import { setup, imp } from './harness.mjs';
import { createFakeDav } from './fakeDav.mjs';
const { store: local } = setup({});
const K = await imp('modules/storageKeys.js');
const P = await imp('modules/syncPush.js');
const S = await imp('modules/syncService.js');
const W = await import(pathToFileURL(path.resolve(process.env.AISH_SRC, 'modules/syncWebdav.js')).href);
const { SK, articleRecKey } = K;

const dav = createFakeDav();
let inflight = 0, maxInflight = 0;
const slowFetch = async (url, init) => { const put = ((init && init.method) || '') === 'PUT'; if (put) { inflight++; maxInflight = Math.max(maxInflight, inflight); } await new Promise((r) => setTimeout(r, 8)); try { return await dav.fetchFn(url, init); } finally { if (put) inflight--; } };   // only uploads are counted: the folder check lists in parallel
const N = 300;
local[SK.articlesIndex] = Array.from({ length: N }, (_, i) => ({ id: 'a' + i, url: 'https://x.test/' + i, title: 'T' + i, timestamp: new Date(1767225600000 + i * 1000).toISOString(), tags: ['public'], summary: 's' }));
for (let i = 0; i < N; i++) local[articleRecKey('a' + i)] = { content: 'x'.repeat(2000), summary: 's' };
const store = W.createWebdavStore({ url: 'https://cloud.test/dav/', root: 'site', username: 'phil', password: 'secret' }, { fetchFn: slowFetch });
const place = { id: 'p1', mode: 'readable', direction: 'publish', scope: 'tag', filter: { tag: 'public' }, include: { highlights: true, qa: false } };
const storage = chrome.storage.local;
const count = () => [...dav.files.keys()].filter((k) => k.startsWith('site/articles/')).length;
const lib = () => JSON.parse(dav.text('site/library.json'));

// parallel: several uploads are in flight at once, and everything arrives
let r = await P.pushPlace({ place, storage, store });
assert.equal(r.pushed, N); assert.ok(!r.more); assert.equal(r.remaining, 0);
assert.ok(maxInflight >= 3 && maxInflight <= 4, 'uploads overlap, but not without limit (max ' + maxInflight + ')');
assert.equal(count(), N); assert.equal(lib().count, N);

// one at a time really is one at a time
dav.files.clear(); dav.dirs.clear(); dav.dirs.add('');
local['sync:ledger:p1'] = {};
maxInflight = 0;
await P.pushPlace({ place, storage, store, concurrency: 1 });
assert.equal(maxInflight, 1, 'concurrency 1 never overlaps uploads');

// out of time: the run says how much is left, the next one finishes it, nothing is uploaded twice
dav.files.clear(); dav.dirs.clear(); dav.dirs.add('');
local['sync:ledger:p1'] = {};
let clock = 0; const tick = () => (clock += 1);
local['sync:ledger:p1'] = { checkedAt: Number.MAX_SAFE_INTEGER };
r = await P.pushPlace({ place, storage, store, now: tick, budgetMs: 40, chunk: 20 });
assert.ok(r.more && r.remaining > 0 && r.remaining < N, 'stopped early with ' + r.remaining + ' left');
const first = r.pushed; assert.equal(first + r.remaining, N, 'pushed + remaining = all');
r = await P.pushPlace({ place, storage, store });
assert.equal(r.pushed, N - first, 'the next run uploads only what was left'); assert.ok(!r.more);
assert.equal(count(), N); assert.equal(lib().count, N);

// two runs at the same time on one place: the second is skipped, not run in parallel
dav.files.clear(); dav.dirs.clear(); dav.dirs.add('');
local['sync:ledger:p1'] = {}; delete local[SK.syncStatus];
local[SK.syncPlaces] = [{ id: 'p1', name: 'Site', connectionId: 'cn1', root: 'site', mode: 'readable', direction: 'publish', scope: 'tag', filter: { tag: 'public' }, include: { highlights: true, qa: false }, enabled: true, created: 'x' }];
local[SK.syncConnections] = [{ id: 'cn1', name: 'Cloud', service: 'webdav', url: 'https://cloud.test/dav/', username: 'phil' }];
local[SK.syncSecrets] = { cn1: { password: 'secret' } };
const svc = S.createSyncService({ storage, makeStore: (c, pl, sec) => W.createWebdavStore({ url: c.url, root: pl.root, username: c.username, password: sec.password }, { fetchFn: slowFetch }), scheduleSoon: () => {} });
const [a, b] = await Promise.all([svc.syncNow('p1'), svc.syncNow('p1')]);
const ran = [a, b].filter((x) => x.p1 && x.p1.pushed !== undefined), skipped = [a, b].filter((x) => x.p1 && x.p1.skipped === 'running');
assert.equal(ran.length, 1); assert.equal(skipped.length, 1, 'the overlapping run was skipped');
assert.equal(ran[0].p1.pushed, N); assert.equal(count(), N);
const st = (await svc.statusNow()).p1; assert.ok(st.ok && !st.running && st.remaining === 0);

console.log('TEST 191 OK');
process.exit(0);
