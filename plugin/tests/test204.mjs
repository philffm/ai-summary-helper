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
// a new place starts with six random words: strong and easy to type elsewhere; nothing to repeat
const WORDS = (await import(new URL('../src/modules/syncWordlist.js', import.meta.url).href)).WORDS;
const first = $('syncWords').textContent; assert.equal(first.split(' ').length, 6); assert.ok(first.split(' ').every((x) => WORDS.includes(x)), 'words from the list'); assert.ok(!$('syncPassphrase') && !$('syncPassphrase2'));
click(byText('button', 'Another suggestion')); await until(() => $('syncWords') && $('syncWords').textContent !== first); assert.notEqual($('syncWords').textContent, first, 'another suggestion is another suggestion');
// your own passphrase: two different ones are refused, a short one too, a weak one is called weak, nothing is saved
click(byText('button', 'Use my own passphrase')); await until(() => $('syncPassphrase'));
type('syncPassphrase', 'abcabcabcabc'); assert.equal($('syncStrength').dataset.level, 'weak'); type('syncPassphrase', 'a long passphrase'); assert.equal($('syncStrength').dataset.level, 'fine'); assert.match($('syncStrength').textContent, /suggested words are stronger/);
type('syncPassphrase', 'a long passphrase'); type('syncPassphrase2', 'another one here');
click(byText('button', 'Connect')); await until(() => /not the same/.test(text()));
assert.match(text(), /two passphrases are not the same/); assert.ok(!(SK.syncPlaces in store));
type('syncPassphrase', 'short'); type('syncPassphrase2', 'short'); click(byText('button', 'Connect')); await until(() => /at least 12/.test(text()));
assert.match(text(), /at least 12 characters/); assert.ok(!(SK.syncPlaces in store));
// back to the words: the place is saved, and the words and the recovery key are shown once, with the exit locked until it is acknowledged
click(byText('button', 'Suggest random words instead')); await until(() => $('syncWords')); const words = $('syncWords').textContent;
click(byText('button', 'Connect')); await until(() => /Save your passphrase and recovery key/.test(text()));
const shown = [...root().querySelectorAll('.sync-recovery')]; assert.equal(shown.length, 2); assert.equal(shown[0].textContent, words, 'the passphrase is shown again, once');
const key = shown[1].textContent; assert.match(key, /^([A-Z2-7]{4}-)+[A-Z2-7]{1,4}$/);
const done = byText('button', 'Done'); assert.ok(done.disabled, 'Done waits for the box');
const box = root().querySelector('input[type=checkbox]'); box.checked = true; box.dispatchEvent(new w.Event('change', { bubbles: true }));
assert.ok(!done.disabled); click(done); await until(() => root().querySelector('.settings-row'));
assert.equal(store[SK.syncPlaces].length, 1); assert.equal(store[SK.syncPlaces][0].mode, 'encrypted');
assert.ok(!JSON.stringify(store[SK.syncPlaces]).includes(key) && !JSON.stringify(store[SK.syncPlaces]).includes(words), 'neither the key nor the passphrase sits with the place');
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
type('syncPassphrase', words.toUpperCase().replace(/ /g, '-  ')); click(byText('button', 'Connect')); await until(() => store[SK.syncPlaces].length === 2);
assert.equal(store[SK.syncPlaces].length, 2, 'the words in capitals with dashes and double spaces still join it'); assert.ok(!/Save your recovery key/.test(text()), 'a joined place shows no new key');
// the list shows both as encrypted
await until(() => root().querySelectorAll('.settings-row').length === 2);   // the list is drawn a moment after the place is saved
assert.equal(root().querySelectorAll('.settings-row').length, 2);
console.log('TEST 204 OK'); process.exit(0);
