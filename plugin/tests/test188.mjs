// Publish-only push: first publish, idempotence, filter changes, highlights, config changes, removal guard, errors, resume.
import assert from 'assert';
import path from 'path'; import { pathToFileURL } from 'url';
import { setup, imp } from './harness.mjs';
import { createFakeDav } from './fakeDav.mjs';
const { store: local } = setup({});
const K = await imp('modules/storageKeys.js');
const P = await imp('modules/syncPush.js');
const R = await imp('modules/syncReadable.js');
const W = await import(pathToFileURL(path.resolve(process.env.AISH_SRC, 'modules/syncWebdav.js')).href);
const { SK, articleRecKey, syncLedgerKey } = K;

const dav = createFakeDav();
const mk = () => W.createWebdavStore({ url: 'https://cloud.test/dav/', root: 'site', username: 'phil', password: 'secret' }, { fetchFn: dav.fetchFn });
const store = mk();
const place = { id: 'p1', mode: 'readable', direction: 'publish', filter: { tag: 'public' }, include: { highlights: true, qa: false } };
const storage = chrome.storage.local;

const art = (id, tags, i) => ({ id, url: 'https://x.test/' + id, title: 'T ' + id, timestamp: `2026-03-0${i}T00:00:00Z`, tags, summary: 'S ' + id });
const seed = () => {
    local[SK.articlesIndex] = [art('a1', ['public'], 1), art('a2', ['public', 'ai'], 2), art('a3', ['private'], 3)];
    for (const id of ['a1', 'a2', 'a3']) local[articleRecKey(id)] = { content: 'FULL ' + id, summary: 'S ' + id };
    local[SK.annotations] = [{ id: 'hl_1', url: 'https://x.test/a1', text: 'quote', type: 'user', timestamp: '2026-03-01T00:00:00Z' }];
};
seed();
let lastStamps = {};   // the engine always passes the current stamps: a call without them reuses the last ones
const run = (extra = {}, stamps) => { if (stamps) lastStamps = stamps; return P.pushPlace({ place, storage, store, stamps: lastStamps, ...extra }); };
const remote = (p) => dav.text('site/' + p);
const lib = () => JSON.parse(remote('library.json'));

// first publish: matching articles only, never the full text, and the list
let r = await run();
assert.equal(r.pushed, 2); assert.equal(r.removed, 0); assert.ok(r.libraryWritten);
assert.ok(remote('articles/a1.json') && remote('articles/a2.json') && !remote('articles/a3.json'), 'only tagged articles');
assert.ok(!remote('articles/a1.json').includes('FULL a1'), 'no full text');
assert.deepEqual(lib().articles.map((a) => a.id), ['a2', 'a1']); assert.equal(lib().count, 2);
assert.equal(lib().articles.find((a) => a.id === 'a1').highlights.length, 1, 'highlights are in the list');
assert.ok(local[syncLedgerKey('p1')].items.a1.hash);

// nothing changed: nothing uploaded
dav.log.length = 0;
r = await run();
assert.equal(r.pushed, 0); assert.equal(r.removed, 0); assert.equal(r.libraryWritten, false);
assert.ok(!dav.log.some((l) => l.startsWith('PUT')), 'no uploads when nothing changed');

// an article without stamps is rebuilt, but identical content is not uploaded again
dav.log.length = 0;
r = await run({}, {});
assert.equal(r.pushed, 0);

// first run with stamps: the file now carries its revision, so both are uploaded once; then it is quiet again
r = await run({}, { 'article:a1': { rev: { t: 10, d: 'x' } }, 'article:a2': { rev: { t: 50, d: 'x' } } });
assert.equal(r.pushed, 2); assert.deepEqual(JSON.parse(remote('articles/a1.json'))._sync.rev, { t: 10, d: 'x' });
r = await run({}, { 'article:a1': { rev: { t: 10, d: 'x' } }, 'article:a2': { rev: { t: 50, d: 'x' } } });
assert.equal(r.pushed, 0);

// a change with a newer stamp is pushed; the list is patched, not rebuilt from nothing
local[SK.articlesIndex][0].title = 'Renamed';
r = await run({}, { 'article:a1': { rev: { t: 100, d: 'x' } }, 'article:a2': { rev: { t: 50, d: 'x' } } });
assert.equal(r.pushed, 1); assert.ok(remote('articles/a1.json').includes('Renamed'));
assert.equal(lib().articles.find((a) => a.id === 'a1').title, 'Renamed'); assert.equal(lib().count, 2);

// a new highlight republishes its article (its stamp is newer than the ledger)
local[SK.annotations].push({ id: 'hl_2', url: 'https://x.test/a2', text: 'second', type: 'user', timestamp: '2026-03-02T00:00:00Z' });
r = await run({}, { 'article:a1': { rev: { t: 100, d: 'x' } }, 'article:a2': { rev: { t: 50, d: 'x' } }, 'hl:hl_2': { rev: { t: 200, d: 'x' } } });
assert.equal(r.pushed, 1); assert.ok(remote('articles/a2.json').includes('second'));

// leaving the filter removes the file and the list entry; the article itself stays local
local[SK.articlesIndex][1].tags = ['ai'];
r = await run({}, { 'article:a1': { rev: { t: 100, d: 'x' } }, 'article:a2': { rev: { t: 300, d: 'x' } } });
assert.equal(r.removed, 1); assert.equal(remote('articles/a2.json'), null);
assert.deepEqual(lib().articles.map((a) => a.id), ['a1']);
assert.ok(local[SK.articlesIndex].some((a) => a.id === 'a2'), 'still in the library');

// a config change (include Q&A) rewrites everything
local[articleRecKey('a1')].conversation = [{ q: 'Why?', a: 'Because.', pinned: true }];
r = await run();
assert.equal(r.pushed, 0, 'a pinned Q&A is not published while Q&A is off, and nothing is re-uploaded');
place.include = { highlights: true, qa: true };
r = await run();
assert.equal(r.pushed, 1, 'the config change is noticed without any new stamp'); assert.ok(remote('articles/a1.json').includes('Because.'));
place.include = { highlights: true, qa: false };
r = await run();
assert.equal(r.pushed, 1); assert.ok(!remote('articles/a1.json').includes('Because.'), 'switching Q&A off takes it off the site again');
r = await run(); assert.equal(r.pushed, 0);

// removal guard: an empty index (restore of a smaller library) must not empty the site
seed();
for (let i = 4; i <= 16; i++) { local[SK.articlesIndex].push(art('b' + i, ['public'], 1)); local[articleRecKey('b' + i)] = { content: 'c', summary: 's' }; }
await run();
const beforeCount = lib().count; assert.ok(beforeCount >= 14);
local[SK.articlesIndex] = [art('b4', ['public'], 1)];
r = await run();
assert.ok(r.needsConfirm >= 10 && r.removed === 0, 'many removals are held back');
assert.equal(lib().count, beforeCount, 'the site is untouched');
r = await run({ confirmRemovals: true });
assert.ok(r.removed >= 10); assert.equal(lib().count, 1);

// the time budget stops a run and the next one continues (nothing is lost, nothing repeated)
seed();
let ticks = 0;
const slow = () => (ticks += 1000);
local[syncLedgerKey('p1')] = {};
dav.files.clear();
r = await run({ now: slow, budgetMs: 1500, chunk: 2, concurrency: 1 });
assert.ok(r.more && r.pushed >= 1 && r.pushed < 2, 'stopped early');
r = await run();
assert.ok(!r.more); assert.equal(lib().count, 2);
assert.ok(remote('articles/a1.json') && remote('articles/a2.json'));

// a lost library.json is rebuilt from the records
dav.files.delete('site/library.json');
local[SK.articlesIndex][0].title = 'Again';
r = await run({}, { 'article:a1': { rev: { t: 999, d: 'x' } } });
assert.ok(r.libraryWritten); assert.equal(lib().count, 2, 'rebuilt, not just the one changed entry');

// a wrong login stops the run with an auth error and keeps what was done
const wrong = W.createWebdavStore({ url: 'https://cloud.test/dav/', root: 'site', username: 'phil', password: 'nope' }, { fetchFn: dav.fetchFn });
await assert.rejects(() => P.pushPlace({ place: { ...place, filter: { tag: 'ai' } }, storage, store: wrong }), (e) => e.kind === 'auth');

console.log('TEST 188 OK');
process.exit(0);
