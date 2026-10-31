// Settings → Sync & backup: the list, the add flow, the form with test and save, editing and removing a place.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
import { createFakeDav } from './fakeDav.mjs';
const { store, w } = setup({});
globalThis.document = w.document; globalThis.window = w;
w.confirm = () => true;
const dav = createFakeDav();
globalThis.fetch = dav.fetchFn;
const K = await imp('modules/storageKeys.js');
const V = await imp('modules/syncView.js');
const { SK, articleRecKey } = K;

const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);
const root = () => $('syncSettings');
const text = () => root().textContent.replace(/\s+/g, ' ');
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const byText = (sel, t) => [...root().querySelectorAll(sel)].find((e) => e.textContent.includes(t));
const type = (id, v) => { const i = $(id); i.value = v; i.dispatchEvent(new w.Event('input', { bubbles: true })); };

store[SK.articlesIndex] = [
    { id: 'a1', url: 'https://x.test/a1', title: 'One', timestamp: '2026-03-01T00:00:00Z', tags: ['public'], summary: 's' },
    { id: 'a2', url: 'https://x.test/a2', title: 'Two', timestamp: '2026-03-02T00:00:00Z', tags: ['private'], summary: 's' },
];
for (const id of ['a1', 'a2']) store[articleRecKey(id)] = { content: 'c', summary: 's' };

// start: explains itself, offers one thing, the Settings row says Off
V.initSyncView(); await wait();
assert.match(text(), /Nothing leaves this device until you add one/);
assert.ok(byText('button', 'Add a place'));
assert.ok(!root().querySelector('.settings-row'), 'no places yet');
assert.equal(document.querySelector('.settings-row-sub[data-sub="sync"]').textContent, 'Off');

// add: WebDAV is available, S3 and a folder are shown as coming
click(byText('button', 'Add a place')); await wait();
const rows = [...root().querySelectorAll('.settings-row')];
assert.equal(rows.length, 3);
assert.ok(!rows[0].disabled && rows[1].disabled && rows[2].disabled);
assert.match(rows[1].textContent, /Soon/);
click(rows[0]); await wait(80);

// form: the readable choice is explained, encrypted is "Soon", the tag preview counts matching articles
assert.match(text(), /Anyone who can open this folder can read these files/);
const tiles = [...root().querySelectorAll('.mcp-tile')];
assert.equal(tiles.length, 2); assert.ok(tiles[0].disabled && /Soon/.test(tiles[0].textContent)); assert.equal(tiles[1].getAttribute('aria-pressed'), 'true');
assert.equal($('syncTag').value, 'public');
await wait(80);
assert.equal($('syncPreviewCount').textContent, '1 article', 'one article carries the tag');
type('syncTag', 'private'); await wait(80);
assert.equal($('syncPreviewCount').textContent, '1 article');
type('syncTag', 'nothing'); await wait(80);
assert.equal($('syncPreviewCount').textContent, '0 articles');
type('syncTag', 'public'); await wait(80);

// test connection: a wrong login says so, a right one reports the count
type('syncName', 'My site'); type('syncUrl', 'https://cloud.test/dav/'); type('syncRoot', 'site'); type('syncUser', 'phil'); type('syncPass', 'wrong');
click(byText('button', 'Test connection')); await wait(120);
assert.match(text(), /did not accept the username and password/);
type('syncPass', 'secret');
click(byText('button', 'Test connection')); await wait(120);
assert.match(text(), /Connected\. 1 article matches\./);
assert.ok(!(SK.syncPlaces in store), 'testing saves nothing');

// a wrong login blocks saving and keeps what was typed
type('syncPass', 'wrong');
click(byText('button', 'Connect and publish')); await wait(150);
assert.match(text(), /username and password/);
assert.equal($('syncName').value, 'My site', 'the form keeps its content');
assert.ok(!(SK.syncPlaces in store));

// save: the place is stored (password apart), the list shows it
type('syncPass', 'secret');
click(byText('button', 'Connect and publish')); await wait(200);
assert.equal(store[SK.syncPlaces].length, 1);
assert.equal(store[SK.syncPlaces][0].filter.tag, 'public');
assert.ok(!JSON.stringify(store[SK.syncPlaces]).includes('secret'));
assert.equal(store[SK.syncSecrets][store[SK.syncPlaces][0].id].password, 'secret');
const row = root().querySelector('.settings-row');
assert.ok(row && /My site/.test(row.textContent) && /Not published yet/.test(row.textContent));
assert.match(document.querySelector('.settings-row-sub[data-sub="sync"]').textContent, /^1 place/);
assert.ok(byText('button', 'Sync now'));

// open it: status, publish now, remove; the saved password is not shown
click(row); await wait(100);
assert.match(text(), /Not published yet/);
assert.ok(byText('button', 'Publish now'));
assert.equal($('syncPass').value, '', 'a saved password is never shown again');
assert.equal($('syncPass').placeholder, 'Unchanged');
type('syncName', 'Renamed site');
click(byText('button', 'Save')); await wait(200);
assert.equal(store[SK.syncPlaces][0].name, 'Renamed site');
assert.equal(store[SK.syncSecrets][store[SK.syncPlaces][0].id].password, 'secret', 'an empty password field keeps the saved login');

// an error from the last run is shown on the place
const id = store[SK.syncPlaces][0].id;
store[SK.syncStatus] = { [id]: { at: new Date().toISOString(), ok: false, error: { kind: 'auth', message: 'The server did not accept the username and password.' } } };
V.initSyncView(); await wait();
assert.match(root().querySelector('.settings-row').textContent, /did not accept/);

// remove
click(root().querySelector('.settings-row')); await wait(100);
click(byText('button', 'Remove this place')); await wait(150);
assert.deepEqual(store[SK.syncPlaces], []);
assert.ok(!root().querySelector('.settings-row'));

console.log('TEST 190 OK');
process.exit(0);
