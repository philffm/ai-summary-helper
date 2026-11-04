// Settings → Sync & backup, status and review (Figma AISH-029 A + C2): one status model with tone, words and the fixing action;
// errors are placed at their field; deletions from other devices are answered one by one and sent only on Apply; no window.confirm.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
const { store, sent, w } = setup({});
globalThis.document = w.document; globalThis.window = w;
w.confirm = () => { throw new Error('no window.confirm'); };
const { SK } = await imp('modules/storageKeys.js');
const V = await imp('modules/syncView.js');
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);
const root = () => $('syncSettings');
const text = () => root().textContent.replace(/\s+/g, ' ');
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const exact = (t) => [...root().querySelectorAll('button')].find((b) => b.textContent === t);
const byLabel = (l) => [...root().querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === l);
const now = Date.now();

// ── the status model ──
const enc = { mode: 'encrypted', direction: 'twoway', enabled: true }, pub = { mode: 'readable', enabled: true };
assert.deepEqual(V.placeStatus({ ...enc, enabled: false }, null), { tone: 'paused', text: 'Paused', action: 'resume' });
assert.equal(V.placeStatus(enc, null).tone, 'idle');
let s = V.placeStatus(enc, { at: new Date(now).toISOString(), ok: false, error: { message: 'The server did not accept the username and password.' } });
assert.equal(s.tone, 'error', 'an error is an error, not "working"'); assert.equal(s.action, 'fix');
s = V.placeStatus(enc, { at: new Date(now).toISOString(), ok: true, needsConfirm: 3 });
assert.equal(s.tone, 'attention'); assert.equal(s.action, 'review'); assert.match(s.text, /3 deletions wait for you/);
s = V.placeStatus(pub, { at: new Date(now).toISOString(), ok: true, needsConfirm: 1 }); assert.match(s.text, /1 file waits to be removed/);
s = V.placeStatus(enc, { at: new Date(now - 120000).toISOString(), ok: true }); assert.equal(s.tone, 'ok'); assert.match(s.text, /synced .* ago/);
s = V.placeStatus(enc, { at: new Date(now).toISOString(), ok: true, running: { phase: 'uploading', done: 1, total: 4, at: now } }, 0, now); assert.equal(s.tone, 'run');

// ── which field an error belongs to ──
assert.equal(V.fieldOfError('The server did not accept the username and password.'), 'syncPass');
assert.equal(V.fieldOfError('Enter the full address, starting with https://'), 'syncUrl');
assert.equal(V.fieldOfError('Enter the bucket name (3 to 63 letters, numbers, dots, dashes).'), 'syncBucket');
assert.equal(V.fieldOfError('The two passphrases are not the same.'), 'syncPassphrase2');
assert.equal(V.fieldOfError('Wrong passphrase.'), 'syncPassphrase');
assert.equal(V.fieldOfError('Enter the tag of the articles to publish.'), 'syncTag');
assert.equal(V.fieldOfError('Make a backup of this device first, then join.'), '');

// ── deletions to review: listed by title, answered one by one, sent on Apply ──
store[SK.articlesIndex] = [
    { id: 'a1', url: 'https://www.blog.test/one', title: 'One', timestamp: '2026-03-01T00:00:00Z', tags: [] },
    { id: 'a2', url: 'https://news.test/two', title: 'Two', timestamp: '2026-03-02T00:00:00Z', tags: [] },
];
store[SK.syncConnections] = [{ id: 'c1', name: 'Cloud', url: 'https://cloud.test/dav/', username: 'phil', service: 'webdav' }];
store[SK.syncPlaces] = [
    { id: 'p1', name: 'My devices', connectionId: 'c1', root: 'sync', mode: 'encrypted', direction: 'twoway', enabled: true, scope: 'all', filter: {}, include: {} },
    { id: 'p2', name: 'Website', connectionId: 'c1', root: 'public', mode: 'readable', direction: 'publish', enabled: true, scope: 'tag', filter: { tag: 'public' }, include: { highlights: true } },
];
const at = now - 3600e3;
store[SK.syncStatus] = {
    p1: { at: new Date(now).toISOString(), ok: true, needsConfirm: 3, pending: [{ key: 'article:a1', at }, { key: 'article:a2', at }, { key: 'hl:h1', at }] },
    p2: { at: new Date(now).toISOString(), ok: true, needsConfirm: 12 },
};
document.getElementById('settingsPanel-sync').hidden = false;
V.initSyncView(); await wait();
assert.match(root().querySelector('.sync-summary').textContent, /2 places need you/);
const rows = [...root().querySelectorAll('.sync-place')];
assert.equal(rows.length, 2); assert.ok(rows.every((r) => r.classList.contains('is-attention')));
assert.equal(rows[0].querySelector('.sync-place-action').textContent, 'Review');
assert.equal(rows[0].querySelector('.sync-place-action').getAttribute('aria-label'), 'Review: My devices');
click(rows[0].querySelector('.sync-place-action')); await wait(120);

const items = [...root().querySelectorAll('.sync-review-item')];
assert.equal(items.length, 3, 'two articles by title, the highlight as a group');
assert.match(items[0].textContent, /One/); assert.match(items[0].textContent, /blog\.test · deleted .* ago/);
assert.match(items[2].textContent, /1 highlight, note or collection/);
assert.ok(exact('Apply').disabled, 'nothing chosen, nothing to apply');
click(byLabel('Keep: One')); await wait();
click(byLabel('Delete: Two')); await wait();
assert.equal(byLabel('Keep: One').getAttribute('aria-pressed'), 'true');
assert.equal(byLabel('Delete: Two').getAttribute('aria-pressed'), 'true');
assert.ok(!exact('Apply (2)').disabled);
assert.match(text(), /1 to keep · 1 to delete · nothing changes until you press Apply/);
click(byLabel('Keep: One')); await wait();   // pressed again: taken back
assert.equal(byLabel('Keep: One').getAttribute('aria-pressed'), 'false'); assert.ok(exact('Apply (1)'));
click(byLabel('Keep: One')); await wait();
assert.ok(!sent.some((m) => m.decide), 'nothing is sent before Apply');
click(exact('Apply (2)')); await wait();
const msg = sent.find((m) => m.decide);
assert.deepEqual(msg, { action: 'syncNow', placeId: 'p1', decide: { keep: ['article:a1'], remove: ['article:a2'] } });
click(exact('Keep all')); await wait();
assert.ok(exact('Apply (3)'), 'Keep all marks every one, still waiting for Apply');

// readable place (or an older status without the list): one question for all, asked in the page
click(exact('‹ Sync & backup')); await wait(100);
click([...root().querySelectorAll('.sync-place .settings-row')][1]); await wait(120);
assert.match(text(), /12 files are no longer wanted here/);
click(exact('Remove them…')); await wait();
assert.match(text(), /Remove 12 files from your server\?/);
click(exact('Cancel')); await wait();
assert.ok(!sent.some((m) => m.confirmRemovals), 'cancel sends nothing');
click(exact('Remove them…')); await wait(); click(exact('Remove them')); await wait();
assert.deepEqual(sent.find((m) => m.confirmRemovals), { action: 'syncNow', placeId: 'p2', confirmRemovals: true });

// edit: settings are folded, the kind is not offered again; Restore asks in the page
click(exact('‹ Sync & backup')); await wait(100);
click(root().querySelector('.sync-place .settings-row')); await wait(120);
assert.ok(root().querySelectorAll('details.sync-fold').length >= 4);
assert.ok(!root().querySelector('.mcp-tile'));
assert.ok([...root().querySelectorAll('h3.settings-caption')].length >= 2, 'section captions are headings');
click(exact('Restore from here…')); await wait();
assert.match(text(), /Bring everything in this place back to this device\?/);
assert.ok(root().querySelector('details.sync-fold[data-fold="keys"]').open, 'the section with the question stays open');
click(exact('Cancel')); await wait();
assert.ok(!sent.some((m) => m.action === 'syncRestore'));
// Pause / Resume from the status card
click(exact('Pause')); await wait(120);
assert.equal(store[SK.syncPlaces][0].enabled, false);
assert.ok(exact('Resume'));
console.log('TEST 236 OK');
process.exit(0);
