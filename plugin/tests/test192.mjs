// Viewer page: written once, kept current, never over the user's own index.html; template safety.
import assert from 'assert';
import fs from 'fs'; import path from 'path'; import { pathToFileURL } from 'url';
import { setup, imp } from './harness.mjs';
import { createFakeDav } from './fakeDav.mjs';
const { store: local } = setup({});
const K = await imp('modules/storageKeys.js');
const P = await imp('modules/syncPush.js');
const V = await imp('modules/syncViewer.js');
const S = await imp('modules/syncService.js');
const W = await import(pathToFileURL(path.resolve(process.env.AISH_SRC, 'modules/syncWebdav.js')).href);
const { SK, articleRecKey, syncLedgerKey } = K;

// the real templates in the package carry what the code relies on
const real = { 'index.html': fs.readFileSync(path.join(process.env.AISH_SRC, 'viewer/index.html'), 'utf8'), 'aish-viewer.js': fs.readFileSync(path.join(process.env.AISH_SRC, 'viewer/aish-viewer.js'), 'utf8'), 'aish-sky.js': fs.readFileSync(path.join(process.env.AISH_SRC, 'viewer/aish-sky.js'), 'utf8') };
assert.ok(real['index.html'].includes('{{TITLE}}') && real['index.html'].includes('{{VERSION}}') && V.isOurs(real['index.html']), 'index.html has its placeholders and marker');
assert.ok(/Content-Security-Policy/.test(real['index.html']) && !/innerHTML/.test(real['aish-viewer.js']) && !/innerHTML/.test(real['aish-sky.js']), 'a CSP, and no innerHTML anywhere in the viewer scripts');
assert.ok(/integrity/.test(real['aish-sky.js']) && /sha384-/.test(real['aish-sky.js']), 'three.js is loaded with an integrity hash');
assert.deepEqual(Object.keys(V.renderViewer(real, { title: 't' }).files), Object.keys(V.VIEWER_FILES), 'every viewer file is published');
const v1 = V.renderViewer(real, { title: '<img src=x onerror=1> & "co"' });
assert.ok(!v1.files['index.html'].includes('<img src=x') && v1.files['index.html'].includes('&lt;img src=x onerror=1&gt; &amp; &quot;co&quot;'), 'the place name is escaped into the page');
assert.ok(!v1.files['index.html'].includes('{{'), 'no placeholder is left');

// push with a viewer
const dav = createFakeDav();
const store = W.createWebdavStore({ url: 'https://cloud.test/dav/', root: 'site', username: 'phil', password: 'secret' }, { fetchFn: dav.fetchFn });
local[SK.articlesIndex] = [{ id: 'a1', url: 'https://x.test/a1', title: 'One', timestamp: '2026-03-01T00:00:00Z', tags: ['public'], summary: 's' }];
local[articleRecKey('a1')] = { content: 'c', summary: 's' };
const place = { id: 'p1', mode: 'readable', direction: 'publish', scope: 'tag', filter: { tag: 'public' }, include: { highlights: true, qa: false }, viewer: true };
const tpl = { 'index.html': '<meta name="aish-viewer" content="{{VERSION}}"><title>{{TITLE}}</title>', 'aish-viewer.js': 'console.log(1)', 'aish-sky.js': 'sky()' };
const puts = () => dav.log.filter((l) => l.startsWith('PUT') && /index\.html|aish-viewer\.js/.test(l)).length;

let r = await P.pushPlace({ place, storage: chrome.storage.local, store, viewer: V.renderViewer(tpl, { title: 'Site' }) });
assert.equal(r.viewer, 'written');
assert.equal(dav.text('site/index.html'), '<meta name="aish-viewer" content="' + V.VIEWER_VERSION + '"><title>Site</title>'); assert.equal(dav.text('site/aish-viewer.js'), 'console.log(1)');
assert.ok(local[syncLedgerKey('p1')].viewer.etag && local[syncLedgerKey('p1')].viewer.hash);

// nothing changed: no viewer traffic at all
dav.log.length = 0;
r = await P.pushPlace({ place, storage: chrome.storage.local, store, viewer: V.renderViewer(tpl, { title: 'Site' }) });
assert.equal(r.viewer, 'current'); assert.equal(puts(), 0); assert.ok(!dav.log.some((l) => /index\.html/.test(l)), 'not even a look at the server');

// a new version (or a renamed place) replaces it while the page is untouched
r = await P.pushPlace({ place, storage: chrome.storage.local, store, viewer: V.renderViewer({ ...tpl, 'aish-viewer.js': 'console.log(2)' }, { title: 'Site' }) });
assert.equal(r.viewer, 'written'); assert.equal(dav.text('site/aish-viewer.js'), 'console.log(2)');
r = await P.pushPlace({ place, storage: chrome.storage.local, store, viewer: V.renderViewer({ ...tpl, 'aish-viewer.js': 'console.log(2)' }, { title: 'Renamed' }) });
assert.equal(r.viewer, 'written'); assert.match(dav.text('site/index.html'), /<title>Renamed<\/title>/);

// the user edits index.html: a newer viewer leaves it alone, and does not keep asking the server
dav.files.get('site/index.html').body = new TextEncoder().encode('MY OWN PAGE'); dav.files.get('site/index.html').etag = 'user-edit';
const v3 = V.renderViewer({ ...tpl, 'aish-viewer.js': 'console.log(3)' }, { title: 'Renamed' });
r = await P.pushPlace({ place, storage: chrome.storage.local, store, viewer: v3 });
assert.equal(r.viewer, 'customized'); assert.equal(dav.text('site/index.html'), 'MY OWN PAGE'); assert.equal(dav.text('site/aish-viewer.js'), 'console.log(2)');
dav.log.length = 0;
r = await P.pushPlace({ place, storage: chrome.storage.local, store, viewer: v3 });
assert.equal(r.viewer, 'customized'); assert.ok(!dav.log.some((l) => /index\.html/.test(l)), 'remembered: no repeated check');

// someone else's index.html is there from the start: never overwritten
const dav2 = createFakeDav(); const store2 = W.createWebdavStore({ url: 'https://cloud.test/dav/', root: 'site', username: 'phil', password: 'secret' }, { fetchFn: dav2.fetchFn });
await store2.put('index.html', 'THE SITE HOMEPAGE');
local[syncLedgerKey('p2')] = {};
r = await P.pushPlace({ place: { ...place, id: 'p2' }, storage: chrome.storage.local, store: store2, viewer: V.renderViewer(tpl, { title: 'Site' }) });
assert.equal(r.viewer, 'blocked'); assert.equal(dav2.text('site/index.html'), 'THE SITE HOMEPAGE'); assert.equal(dav2.text('site/aish-viewer.js'), null);

// without the switch nothing is written
const dav3 = createFakeDav(); const store3 = W.createWebdavStore({ url: 'https://cloud.test/dav/', root: 'site', username: 'phil', password: 'secret' }, { fetchFn: dav3.fetchFn });
local[syncLedgerKey('p3')] = {};
r = await P.pushPlace({ place: { ...place, id: 'p3', viewer: false }, storage: chrome.storage.local, store: store3 });
assert.equal(r.viewer, undefined); assert.equal(dav3.text('site/index.html'), null);

// library.js: the list as a script, written with the viewer (a page opened from disk cannot fetch library.json)
{
    const d = createFakeDav(); const st = W.createWebdavStore({ url: 'https://cloud.test/dav/', root: 'site', username: 'phil', password: 'secret' }, { fetchFn: d.fetchFn });
    local[syncLedgerKey('p5')] = {};
    await P.pushPlace({ place: { ...place, id: 'p5', viewer: false }, storage: chrome.storage.local, store: st });
    assert.equal(d.text('site/library.js'), null, 'no viewer: no script copy');
    const withV = { ...place, id: 'p5', viewer: true };
    await P.pushPlace({ place: withV, storage: chrome.storage.local, store: st, viewer: V.renderViewer(tpl, { title: 'Site' }) });
    const js = d.text('site/library.js');
    assert.ok(js && js.startsWith('window.AISH_LIBRARY = ') && js.endsWith(';\n'), 'the script sets one global');
    assert.deepEqual(JSON.parse(js.slice('window.AISH_LIBRARY = '.length, -2)).articles.map((a) => a.id), JSON.parse(d.text('site/library.json')).articles.map((a) => a.id), 'same list as library.json');
    // a change rewrites both
    local[SK.articlesIndex][0].title = 'Renamed again';
    await P.pushPlace({ place: withV, storage: chrome.storage.local, store: st, viewer: V.renderViewer(tpl, { title: 'Site' }), stamps: { 'article:a1': { rev: { t: 500, d: 'x' } } } });
    assert.ok(d.text('site/library.js').includes('Renamed again') && d.text('site/library.json').includes('Renamed again'));
}

// the service passes the flag and the rendered viewer through, and keeps the status
assert.equal(S.cleanPlace({ connectionId: 'c', scope: 'all', viewer: true }).viewer, true);
assert.equal(S.cleanPlace({ connectionId: 'c', scope: 'all' }).viewer, false);

// end to end through the service: the switch, the rendered page with the place name, the status
const dav4 = createFakeDav();
local[SK.syncPlaces] = [{ id: 'p4', name: 'My <b>site</b>', connectionId: 'cn1', root: 'site', mode: 'readable', direction: 'publish', scope: 'tag', filter: { tag: 'public' }, include: { highlights: true, qa: false }, viewer: true, enabled: true, created: 'x' }];
local[SK.syncConnections] = [{ id: 'cn1', name: 'Cloud', service: 'webdav', url: 'https://cloud.test/dav/', username: 'phil' }];
local[SK.syncSecrets] = { cn1: { password: 'secret' } };
const svc = S.createSyncService({ storage: chrome.storage.local, scheduleSoon: () => {}, makeStore: (c, pl, sec) => W.createWebdavStore({ url: c.url, root: pl.root, username: c.username, password: sec.password }, { fetchFn: dav4.fetchFn }), viewerSource: async (pl) => V.renderViewer(tpl, { title: pl.name }) });
await svc.syncNow('p4');
assert.match(dav4.text('site/index.html'), /<title>My &lt;b&gt;site&lt;\/b&gt;<\/title>/);
assert.equal((await svc.statusNow()).p4.viewer, 'written');

console.log('TEST 192 OK');
process.exit(0);
