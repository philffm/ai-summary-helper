// Settings → Sync & backup: an encrypted place (passphrase twice, recovery key shown once), then a join of an existing folder.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
import { createFakeDav } from './fakeDav.mjs';
const { store, w } = setup({});
globalThis.document = w.document; globalThis.window = w;
const dav = createFakeDav(); globalThis.fetch = dav.fetchFn;
const { SK, articleRecKey } = await imp('modules/storageKeys.js');
const V = await imp('modules/syncView.js');
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (fn()) return; } catch (_) { /* not yet */ } await wait(30); } };   // the key derivation is slow on purpose
const $ = (id) => document.getElementById(id);
const root = () => $('syncSettings');
const text = () => root().textContent.replace(/\s+/g, ' ');
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const byText = (sel, t) => [...root().querySelectorAll(sel)].find((e) => e.textContent.includes(t));
const type = (id, v) => { const i = $(id); i.value = v; i.dispatchEvent(new w.Event('input', { bubbles: true })); };
store[SK.articlesIndex] = [{ id: 'a1', url: 'https://x.test/a1', title: 'One', timestamp: '2026-03-01T00:00:00Z', tags: [], summary: 's' }];
store[articleRecKey('a1')] = { content: 'c', summary: 's' };
V.initSyncView(); await until(() => byText('button', 'Add a place'));
click(byText('button', 'Add a place')); await until(() => root().querySelectorAll('.settings-row').length); click(root().querySelectorAll('.settings-row')[0]); await until(() => $('syncServerName'));

// the server, then the choices: encrypted is on, "Sync my devices" is the default
type('syncServerName', 'Cloud'); type('syncUrl', 'https://cloud.test/dav/'); type('syncUser', 'phil'); type('syncPass', 'secret');
type('syncName', 'My devices'); type('syncRoot', 'sync');
assert.equal(byText('.a11y-seg button', 'Sync my devices').getAttribute('aria-checked'), 'true');
// two different passphrases are refused, a short one too, nothing is saved
type('syncPassphrase', 'a long passphrase'); type('syncPassphrase2', 'another one here');
click(byText('button', 'Connect')); await until(() => /not the same/.test(text()));
assert.match(text(), /two passphrases are not the same/); assert.ok(!(SK.syncPlaces in store));
type('syncPassphrase', 'short'); type('syncPassphrase2', 'short'); click(byText('button', 'Connect')); await until(() => /at least 8/.test(text()));
assert.match(text(), /at least 8 characters/); assert.ok(!(SK.syncPlaces in store));
// a good one: the place is saved and the recovery key is shown once, with the exit locked until it is acknowledged
type('syncPassphrase', 'a long passphrase'); type('syncPassphrase2', 'a long passphrase'); click(byText('button', 'Connect')); await until(() => /Save your recovery key/.test(text()));
assert.match(text(), /Save your recovery key/);
const key = root().querySelector('.sync-recovery').textContent; assert.match(key, /^([A-Z2-7]{4}-)+[A-Z2-7]{1,4}$/);
const done = byText('button', 'Done'); assert.ok(done.disabled, 'Done waits for the box');
const box = root().querySelector('input[type=checkbox]'); box.checked = true; box.dispatchEvent(new w.Event('change', { bubbles: true }));
assert.ok(!done.disabled); click(done); await until(() => root().querySelector('.settings-row'));
assert.equal(store[SK.syncPlaces].length, 1); assert.equal(store[SK.syncPlaces][0].mode, 'encrypted');
assert.ok(!JSON.stringify(store[SK.syncPlaces]).includes(key) && !JSON.stringify(store[SK.syncPlaces]).includes('long passphrase'), 'neither the key nor the passphrase sits with the place');
assert.ok(root().querySelector('.settings-row'), 'back at the list');

// a second place in the same folder name: the folder already holds a library, so it is joined, not created
click(byText('button', 'Add a place')); await until(() => root().querySelectorAll('.settings-row').length === 3); click(root().querySelectorAll('.settings-row')[0]); await until(() => $('syncName') && $('syncPassphrase'));
type('syncName', 'Again'); type('syncRoot', 'sync');
click(byText('button', 'Test connection')); await until(() => /already holds/.test(text()));
assert.match(text(), /already holds an encrypted library/);
assert.ok($('syncRecovery') && !$('syncPassphrase2'), 'asks for the passphrase or the recovery key, once');
assert.match(text(), /Make a backup of this device first/);
type('syncPassphrase', 'not the passphrase'); click(byText('button', 'Connect')); await until(() => root().querySelector('.phone-inbox-error'));
assert.match(root().querySelector('.phone-inbox-error').textContent, /backup of this device first/, 'the backup box is required');
const ack = [...root().querySelectorAll('label.mcp-row')].find((l) => /I made a backup/.test(l.textContent)).querySelector('input'); ack.checked = true; ack.dispatchEvent(new w.Event('change', { bubbles: true }));
click(byText('button', 'Connect')); await until(() => /Wrong passphrase/.test(text()));
assert.match(root().querySelector('.phone-inbox-error').textContent, /Wrong passphrase/); assert.equal(store[SK.syncPlaces].length, 1, 'a wrong passphrase saves nothing');
type('syncPassphrase', ''); type('syncRecovery', key); click(byText('button', 'Connect')); await until(() => store[SK.syncPlaces].length === 2);
assert.equal(store[SK.syncPlaces].length, 2, 'the recovery key joins it'); assert.ok(!/Save your recovery key/.test(text()), 'a joined place shows no new key');
// the list shows both as encrypted
assert.equal(root().querySelectorAll('.settings-row').length, 2);
console.log('TEST 204 OK'); process.exit(0);
