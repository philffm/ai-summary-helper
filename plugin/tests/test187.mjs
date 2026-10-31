// WebDAV store against an in-memory server: folders, put/get/remove/list, conditions, auth, the safe-fetch limits.
import assert from 'assert';
import path from 'path'; import { pathToFileURL } from 'url';
import { createFakeDav } from './fakeDav.mjs';
const W = await import(pathToFileURL(path.resolve(process.env.AISH_SRC, 'modules/syncWebdav.js')).href);

const dav = createFakeDav();
const cfg = { url: 'https://cloud.test/dav/', root: 'aish-sync/v1', username: 'phil', password: 'secret' };
const st = W.createWebdavStore(cfg, { fetchFn: dav.fetchFn });

// ping creates the root; a second store (new process) finds it
assert.equal(await st.ping(), true);
assert.ok(dav.dirs.has('aish-sync') && dav.dirs.has('aish-sync/v1'));
assert.equal(await W.createWebdavStore(cfg, { fetchFn: dav.fetchFn }).ping(), true);

// wrong password: a clear auth error, nothing written
const bad = W.createWebdavStore({ ...cfg, password: 'nope' }, { fetchFn: dav.fetchFn });
await assert.rejects(() => bad.ping(), (e) => e.kind === 'auth' && e.status === 401);

// put creates folders on the way, returns an etag; get returns the same bytes
const a = await st.put('articles/a1.json', '{"id":"a1"}', { contentType: 'application/json' });
assert.ok(a.etag);
assert.ok(dav.dirs.has('aish-sync/v1/articles'));
assert.equal(dav.text('aish-sync/v1/articles/a1.json'), '{"id":"a1"}');
const g = await st.get('articles/a1.json');
assert.equal(new TextDecoder().decode(g.bytes), '{"id":"a1"}'); assert.equal(g.etag, a.etag);
assert.equal(await st.get('articles/nope.json'), null);

// conditions: If-Match with the current etag succeeds, a stale one fails with 412; If-None-Match * refuses to overwrite
const b = await st.put('articles/a1.json', '{"id":"a1","v":2}', { ifMatch: a.etag });
assert.notEqual(b.etag, a.etag);
await assert.rejects(() => st.put('articles/a1.json', 'x', { ifMatch: a.etag }), (e) => e.status === 412);
await assert.rejects(() => st.put('articles/a1.json', 'x', { ifNoneMatch: '*' }), (e) => e.status === 412);
const c = await st.put('articles/a2.json', 'two', { ifNoneMatch: '*' }); assert.ok(c.etag);

// names with spaces and unicode survive the round trip
await st.put('articles/ä ö.json', 'u');
assert.equal(dav.text('aish-sync/v1/articles/ä ö.json'), 'u');

// list: the files directly in a folder, with etag and size; folders and the folder itself are left out
await st.put('library.json', '{}');
const listed = await st.list('articles');
assert.deepEqual(listed.map((f) => f.path).sort(), ['articles/a1.json', 'articles/a2.json', 'articles/ä ö.json']);
assert.ok(listed.every((f) => f.etag && f.size > 0));
assert.deepEqual((await st.list('')).map((f) => f.path), ['library.json'], 'folders are not files');
assert.deepEqual(await st.list('nothing-here'), []);

// remove: true once, false when it is gone
assert.equal(await st.remove('articles/a2.json'), true);
assert.equal(await st.remove('articles/a2.json'), false);

// the safe fetch keeps its rules: plain http is refused
const plain = W.createWebdavStore({ ...cfg, url: 'http://cloud.test/dav/' }, { fetchFn: dav.fetchFn });
await assert.rejects(() => plain.ping(), /HTTPS/);

// the multistatus parser copes with other prefixes and entity-escaped etags
const xml = '<D:multistatus xmlns:D="DAV:"><D:response><D:href>/dav/x/a%20b.json</D:href><D:propstat><D:prop><D:getetag>&quot;abc&quot;</D:getetag><D:getcontentlength>12</D:getcontentlength><D:resourcetype/></D:prop></D:propstat></D:response></D:multistatus>';
assert.deepEqual(W.parseMultistatus(xml), [{ href: '/dav/x/a b.json', etag: 'abc', size: 12, isDir: false }]);

console.log('TEST 187 OK');
process.exit(0);
