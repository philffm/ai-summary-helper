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

// form: a new place starts encrypted (the safe choice) and asks for a passphrase twice; Readable is one tap away
let tiles = [...root().querySelectorAll('.mcp-tile')];
assert.equal(tiles.length, 2); assert.equal(tiles[0].getAttribute('aria-pressed'), 'true', 'encrypted is the default');
assert.ok($('syncPassphrase') && $('syncPassphrase2') && !root().querySelector('.sync-danger'), 'a passphrase, repeated, and no readable-only options');
assert.match(text(), /Sync my devices/); assert.match(text(), /Backup only/); assert.ok(!/Which articles/i.test(text()));
click(tiles[1]); await wait(80);
// the readable choice is explained, the tag preview counts matching articles
assert.match(text(), /Anyone who can open this folder can read these files/);
tiles = [...root().querySelectorAll('.mcp-tile')];
assert.equal(tiles[1].getAttribute('aria-pressed'), 'true'); assert.ok(!$('syncPassphrase'));
assert.equal($('syncTag').value, 'public');
await wait(80);
assert.equal($('syncPreviewCount').textContent, '1 article', 'one article carries the tag');
type('syncTag', 'private'); await wait(80);
assert.equal($('syncPreviewCount').textContent, '1 article');
type('syncTag', 'nothing'); await wait(80);
assert.equal($('syncPreviewCount').textContent, '0 articles');
type('syncTag', 'public'); await wait(80);

// the optional viewer page: off by default, explained, and saved with the place
const viewerRow = byText('label.mcp-row', 'Also publish a viewer page');
assert.ok(viewerRow && !viewerRow.querySelector('input').checked, 'off by default');
assert.match(viewerRow.textContent, /Nextcloud shares do not/);

// the danger zone: three switches, all off, with a plain warning
const dz = root().querySelector('.sync-danger');
assert.ok(dz && /Danger zone/i.test(dz.textContent) && /Anyone who can open the folder can read all of this/.test(dz.textContent));
assert.deepEqual([...dz.querySelectorAll('.mcp-row-title')].map((e) => e.textContent), ['My notes and comments', 'Reminders', 'Full article text']);
assert.ok([...dz.querySelectorAll('input[type=checkbox]')].every((i) => !i.checked), 'all off by default');

// which articles: a tag, all except a tag, or everything (with a warning)
assert.equal(root().querySelector('.a11y-seg button.on').textContent, 'With a tag');
click(byText('.a11y-seg button', 'All except a tag')); await wait(100);
assert.match(text(), /Publish everything except articles tagged/); assert.equal($('syncTag').value, 'private');
assert.equal($('syncPreviewCount').textContent, '1 article', 'everything except private');
click([...root().querySelectorAll('.a11y-seg button')].find((b) => b.textContent === 'All')); await wait(100);
assert.ok(!$('syncTag'), 'no tag field for everything'); assert.match(text(), /Every article you saved goes out/);
assert.equal($('syncPreviewCount').textContent, '2 articles');
click(byText('.a11y-seg button', 'With a tag')); await wait(100);
assert.equal($('syncTag').value, 'public', 'switching back restores the tag');

// test connection: a wrong login says so, a right one reports the count
type('syncServerName', 'My site'); type('syncName', 'Website list'); type('syncUrl', 'https://cloud.test/dav/'); type('syncRoot', 'site'); type('syncUser', 'phil'); type('syncPass', 'wrong');
click(byText('button', 'Test connection')); await wait(120);
assert.match(text(), /did not accept the username and password/);
type('syncPass', 'secret');
click(byText('button', 'Test connection')); await wait(120);
assert.match(text(), /Connected\. 1 article matches\./);
assert.ok(!(SK.syncPlaces in store) && !(SK.syncConnections in store), 'testing saves nothing');

// a wrong login blocks saving and keeps what was typed
type('syncPass', 'wrong');
click(byText('button', 'Connect and publish')); await wait(150);
assert.match(text(), /username and password/);
assert.equal($('syncName').value, 'Website list', 'the form keeps its content'); assert.equal($('syncServerName').value, 'My site');
assert.ok(!(SK.syncPlaces in store));

// save: the place is stored (password apart), the list shows it
type('syncPass', 'secret');
click(byText('button', 'Connect and publish')); await wait(200);
assert.equal(store[SK.syncPlaces].length, 1); assert.equal(store[SK.syncConnections].length, 1);
assert.equal(store[SK.syncPlaces][0].filter.tag, 'public'); assert.equal(store[SK.syncPlaces][0].root, 'site'); assert.equal(store[SK.syncPlaces][0].viewer, false); assert.deepEqual(store[SK.syncPlaces][0].include, { highlights: true, qa: false, notes: false, reminders: false, fulltext: false });
assert.ok(!JSON.stringify([store[SK.syncPlaces], store[SK.syncConnections]]).includes('secret'));
const connId = store[SK.syncConnections][0].id;
assert.equal(store[SK.syncSecrets][connId].password, 'secret');
const row = root().querySelector('.settings-row');
assert.ok(row && /Website list/.test(row.textContent) && /My site \/ site/.test(row.textContent) && /Not published yet/.test(row.textContent));
assert.match(document.querySelector('.settings-row-sub[data-sub="sync"]').textContent, /^1 place/);
assert.ok(byText('button', 'Sync now'));

// open it: status, publish now, remove; the saved password is not shown
click(row); await wait(100);
assert.match(text(), /Not published yet/);
assert.ok(byText('button', 'Publish now'));
assert.ok(!$('syncPass'), 'the server login is not open while you edit the folder');
assert.match(text(), /1 place uses this server/);
click(byText('button', 'Edit server')); await wait(80);
assert.equal($('syncPass').value, '', 'a saved password is never shown again');
assert.equal($('syncPass').placeholder, 'Unchanged');
assert.equal($('syncUrl').value, 'https://cloud.test/dav/');
type('syncName', 'Renamed site');
click([...root().querySelectorAll('button')].find((b) => b.textContent === 'Save')); await wait(200);
assert.equal(store[SK.syncPlaces][0].name, 'Renamed site');
assert.equal(store[SK.syncSecrets][connId].password, 'secret', 'an empty password field keeps the saved login');

// a second folder on the same server: pick the server, no login typed, everything for a backup
click(byText('button', 'Add a place')); await wait(80);
click(root().querySelectorAll('.settings-row')[0]); await wait(120);
assert.ok(root().querySelector('.mcp-chip.is-selected').textContent.includes('My site'), 'the server you already have is preselected');
assert.ok(!$('syncPass'), 'no login fields for an existing server');
click(root().querySelectorAll('.mcp-tile')[1]); await wait(80);   // Readable
type('syncName', 'Backup'); type('syncRoot', 'backup');
click([...root().querySelectorAll('.a11y-seg button')].find((b) => b.textContent === 'All')); await wait(100);
click(byText('button', 'Connect and publish')); await wait(250);
assert.equal(store[SK.syncPlaces].length, 2); assert.equal(store[SK.syncConnections].length, 1, 'one server, two folders');
assert.deepEqual(store[SK.syncPlaces].map((p) => p.root), ['site', 'backup']); assert.equal(store[SK.syncPlaces][1].scope, 'all');
const idsNow = () => store[SK.syncPlaces].map((p) => p.id);
const id = store[SK.syncPlaces][0].id;

// an error from the last run is shown on the place
store[SK.syncStatus] = { [id]: { at: new Date().toISOString(), ok: false, error: { kind: 'auth', message: 'The server did not accept the username and password.' } } };
V.initSyncView(); await wait();
assert.match(root().querySelector('.settings-row').textContent, /did not accept/);

// live progress: the row says what it is doing, the form's status card follows without touching what is typed
store[SK.syncStatus] = { [id]: { at: new Date().toISOString(), ok: true, pushed: 1, running: { phase: 'uploading', done: 12, total: 340, since: Date.now(), at: Date.now() } } };
V.initSyncView(); await wait();
assert.match(root().querySelector('.settings-row').textContent, /Uploading 12 of 340/);
assert.ok(byText('button', 'Syncing…').disabled, 'Sync now is off while a run is going');
click(root().querySelector('.settings-row')); await wait(100);
assert.match($('syncHero').textContent, /Uploading 12 of 340/);
const bar = $('syncHero').querySelector('progress'); assert.equal(bar.max, 340); assert.equal(bar.value, 12);
assert.ok(byText('button', 'Publishing…').disabled);
type('syncName', 'Typed while syncing');
store[SK.syncStatus] = { [id]: { at: new Date().toISOString(), ok: true, pushed: 1, running: { phase: 'uploading', done: 200, total: 340, since: Date.now(), at: Date.now() } } };
for (const f of globalThis.__chL || []) f({ [SK.syncStatus]: { newValue: store[SK.syncStatus] } }, 'local');
await wait(80);
assert.equal($('syncHero').querySelector('progress').value, 200, 'the bar moved');
assert.equal($('syncName').value, 'Typed while syncing', 'the form was not re-rendered');
// a run that stopped writing progress (worker killed) stops looking busy
store[SK.syncStatus] = { [id]: { at: new Date().toISOString(), ok: true, pushed: 1, running: { phase: 'uploading', done: 5, total: 340, since: Date.now() - 600000, at: Date.now() - 600000 } } };
for (const f of globalThis.__chL || []) f({ [SK.syncStatus]: { newValue: store[SK.syncStatus] } }, 'local');
await wait(80);
assert.ok(!$('syncHero').querySelector('progress'), 'a stale run is not shown as running');
click(byText('button', '‹ Sync')); await wait(80);

// remove
click(root().querySelector('.settings-row')); await wait(100);
click(byText('button', 'Remove this place')); await wait(150);
assert.equal(store[SK.syncPlaces].length, 1); assert.equal(store[SK.syncConnections].length, 1, 'the server stays while another folder uses it');
click(root().querySelector('.settings-row')); await wait(100);
click(byText('button', 'Remove this place')); await wait(150);
assert.deepEqual(store[SK.syncPlaces], []); assert.deepEqual(store[SK.syncConnections], []);
assert.ok(!(connId in store[SK.syncSecrets]), 'the last place takes the server and its login with it');
assert.ok(!root().querySelector('.settings-row'));
void idsNow;

console.log('TEST 190 OK');
process.exit(0);
