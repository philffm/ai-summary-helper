// Before publishing, the engine looks at what is really in the folder: restores what went missing or was changed,
// finds leftovers (only if they are ours), notices a missing list or viewer, and does not ask the server more than needed.
import assert from 'assert';
import path from 'path'; import { pathToFileURL } from 'url';
import { setup, imp } from './harness.mjs';
import { createFakeDav } from './fakeDav.mjs';
const { store: local } = setup({});
const K = await imp('modules/storageKeys.js');
const P = await imp('modules/syncPush.js');
const V = await imp('modules/syncViewer.js');
const W = await import(pathToFileURL(path.resolve(process.env.AISH_SRC, 'modules/syncWebdav.js')).href);
const { SK, articleRecKey, syncLedgerKey } = K;

const dav = createFakeDav();
const store = W.createWebdavStore({ url: 'https://cloud.test/dav/', root: 'site', username: 'phil', password: 'secret' }, { fetchFn: dav.fetchFn });
const place = { id: 'p1', mode: 'readable', direction: 'publish', scope: 'tag', filter: { tag: 'public' }, include: { highlights: true, qa: false }, viewer: true };
const tpl = { 'index.html': '<meta name="aish-viewer" content="{{VERSION}}"><title>{{TITLE}}</title>', 'aish-viewer.js': 'v()', 'aish-sky.js': 'sky()' };
const viewer = () => V.renderViewer(tpl, { title: 'Site' });
const N = 6;
local[SK.articlesIndex] = Array.from({ length: N }, (_, i) => ({ id: 'a' + i, url: 'https://x.test/' + i, title: 'T' + i, timestamp: `2026-03-0${i + 1}T00:00:00Z`, tags: ['public'], summary: 's' }));
for (let i = 0; i < N; i++) local[articleRecKey('a' + i)] = { content: 'c', summary: 's' };
const storage = chrome.storage.local;
const run = (extra = {}) => P.pushPlace({ place, storage, store, viewer: viewer(), ...extra });
const has = (p) => dav.text('site/' + p) !== null;
const lib = () => JSON.parse(dav.text('site/library.json'));
const lists = () => dav.log.filter((l) => l.startsWith('PROPFIND') && /site(\/articles)?$/.test(l)).length;

// first run: everything goes up, and the folder is looked at once
let r = await run();
assert.equal(r.pushed, N); assert.equal(r.repaired, 0); assert.ok(local[syncLedgerKey('p1')].checkedAt);
assert.ok(local[syncLedgerKey('p1')].items.a0.size > 0, 'the size of each file is remembered');

// a quiet run right after does not ask the server again; "verify" does
dav.log.length = 0; r = await run(); assert.equal(lists(), 0, 'no listing within the half hour'); assert.equal(r.pushed, 0);
dav.log.length = 0; r = await run({ verify: true }); assert.ok(lists() >= 2, 'a manual publish looks at the folder (articles and top level)'); assert.equal(r.pushed, 0); assert.equal(r.repaired, 0, 'nothing to repair when all is as we left it');

// a file deleted by hand comes back; a file edited by hand is put back to what we wrote
dav.files.delete('site/articles/a1.json');
dav.files.get('site/articles/a2.json').body = new TextEncoder().encode('{"aish":"article/1","id":"a2","title":"tampered"}');
r = await run({ verify: true });
assert.equal(r.repaired, 2, 'two files restored'); assert.ok(has('articles/a1.json')); assert.ok(!dav.text('site/articles/a2.json').includes('tampered'));
assert.equal(lib().count, N, 'the list is consistent');

// the list and the viewer page are noticed when they are gone, and the script copy too
dav.files.delete('site/library.json'); dav.files.delete('site/library.js'); dav.files.delete('site/index.html');
r = await run({ verify: true });
assert.ok(has('library.json') && has('library.js') && has('index.html'), 'list, script copy and viewer page are written again');
assert.equal(lib().count, N);

// leftovers: files of articles that are no longer in the place. Only ours are removed.
await store.put('articles/old_gone.json', JSON.stringify({ aish: 'article/1', id: 'old_gone', title: 'an old one' }));
await store.put('articles/not_ours.json', JSON.stringify({ hello: 'this belongs to someone else' }));
await store.put('articles/notes.txt', 'plain text, not even an article file');
r = await run({ verify: true });
assert.equal(r.orphans, 1, 'one leftover found'); assert.equal(r.removed, 1);
assert.ok(!has('articles/old_gone.json'), 'ours: removed'); assert.ok(has('articles/not_ours.json') && has('articles/notes.txt'), 'not ours: left alone');
assert.equal(lib().count, N);

// a lost ledger (reinstall, cleared data): the files are recognised, pushed again without harm, and leftovers are still found
await store.put('articles/old2.json', JSON.stringify({ aish: 'article/1', id: 'old2', title: 'another old one' }));
delete local[syncLedgerKey('p1')];
r = await run();
assert.equal(r.pushed, N, 'everything is written once more (same content)'); assert.equal(r.orphans, 1); assert.ok(!has('articles/old2.json'));
assert.equal(lib().count, N);

// many leftovers: held back by the removal guard, like any large removal
for (let i = 0; i < 20; i++) await store.put(`articles/stale${i}.json`, JSON.stringify({ aish: 'article/1', id: 'stale' + i }));
r = await run({ verify: true });
assert.ok(r.needsConfirm >= 20 && r.removed === 0, 'a large cleanup waits for a yes');
assert.ok(has('articles/stale0.json'));
r = await run({ verify: true, confirmRemovals: true });
assert.ok(r.removed >= 20); assert.ok(!has('articles/stale0.json'));

// a server that cannot list does not stop publishing
const noList = { ...store, list: async () => { const { TargetError } = await import(pathToFileURL(path.resolve(process.env.AISH_SRC, 'modules/targets/targetError.js')).href); throw new TargetError({ kind: 'permanent', status: 405, message: 'no PROPFIND here' }); } };
local['sync:ledger:p1'] = { ...local[syncLedgerKey('p1')], checkedAt: 0 };
local[SK.articlesIndex].push({ id: 'z9', url: 'https://x.test/z9', title: 'New', timestamp: '2026-04-01T00:00:00Z', tags: ['public'], summary: 's' }); local[articleRecKey('z9')] = { content: 'c', summary: 's' };
r = await P.pushPlace({ place, storage, store: noList, viewer: viewer(), verify: true });
assert.equal(r.pushed, 1, 'it still published the new article');

console.log('TEST 196 OK');
process.exit(0);
