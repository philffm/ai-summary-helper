// Notes from the page: the worker's message handling, the selection toolbar and composer, comments and notes in the page panel.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { store, w } = setup({});
const d = w.document; globalThis.document = d; globalThis.window = w;
const K = await imp('modules/storageKeys.js');
const NS = await imp('modules/notesStore.js');
const NM = await imp('modules/notesMessages.js');
const NT = await imp('modules/noteText.js');
const POP = await imp('content/notesPopover.js');
const PANEL = await imp('content/highlightPanel.js');
const { SK, noteRecKey } = K;

// ── the worker side ──
const ns = NS.createNotesStore({ storage: chrome.storage.local, mark: async () => 0 });
const nm = NM.createNotesMessages({ store: ns });
const tab = { tab: { url: 'https://econ.example/post?utm_source=x#frag', title: 'Inflation 2021–2023' } };
let r = await nm.handle({ action: 'noteAdd', text: '  Ask Anna  ', tags: ['todo', 'x'.repeat(100)], quote: 'the cap', url: 'https://evil.example/' }, tab);
assert.ok(r.ok && /^n_/.test(r.id));
const rec = store[noteRecKey(r.id)];
assert.equal(rec.text, 'Ask Anna'); assert.equal(rec.quote, 'the cap'); assert.equal(rec.title, 'Inflation 2021–2023');
assert.equal(rec.url, 'https://econ.example/post', 'the address comes from the tab, not from the message');
assert.equal(rec.tags[1].length, 40, 'tags are capped');
assert.deepEqual(await nm.handle({ action: 'noteAdd', text: '   ' }, tab), { ok: false, error: 'empty' });
assert.deepEqual(await nm.handle({ action: 'noteAdd', text: 'x' }, {}), { ok: false, error: 'no-page' }, 'not from a page');
assert.deepEqual(await nm.handle({ action: 'noteAdd', text: 'x' }, { tab: { url: 'chrome://settings' } }), { ok: false, error: 'no-page' });
r = await nm.handle({ action: 'commentSet', highlightId: 'hl_abc_123', text: 'Check chart 3 #wages' }, tab);
assert.ok(r.ok); assert.equal(store[noteRecKey('c_hl_abc_123')].text, 'Check chart 3 #wages');
assert.deepEqual(await nm.handle({ action: 'commentSet', highlightId: '../../x', text: 'a' }, tab), { ok: false, error: 'bad-id' });
assert.deepEqual(await nm.handle({ action: 'delete-everything' }, tab), { ok: false, error: 'unknown-action' });
assert.deepEqual(await nm.handle(null, tab), { ok: false, error: 'bad-message' });
assert.equal(NT.splitTags('Ask #todo #later').text, 'Ask');

// ── the toolbar ──
const hostOf = () => d.getElementById('aish-np-host');
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
let hit = [];
POP.npShowToolbar({ x: 300, y: 200, onHighlight: () => hit.push('hl'), onComment: () => hit.push('cm'), onNote: () => hit.push('note') });
let root = hostOf()._root;
const buttons = [...root.querySelectorAll('.bar button')];
assert.deepEqual(buttons.map((b) => b.textContent), ['✏️', '💬', '📝'], 'three quiet buttons');
assert.deepEqual(buttons.map((b) => b.getAttribute('aria-label')), ['Highlight', 'Highlight and comment', 'Note with this quote'], 'each one named for assistive tech');
assert.equal(root.querySelector('.bar').getAttribute('role'), 'toolbar');
click(buttons[1]); assert.deepEqual(hit, ['cm']); assert.equal(hostOf(), null, 'it goes away after a choice');
POP.npShowToolbar({ x: 300, y: 200, onHighlight: () => hit.push('hl'), onComment() {}, onNote() {} });
click(hostOf()._root.querySelector('.bar button')); assert.deepEqual(hit, ['cm', 'hl']);
// an outside click and Escape dismiss it
POP.npShowToolbar({ x: 10, y: 10, onHighlight() {}, onComment() {}, onNote() {} }); await tick(100);
d.body.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true })); assert.equal(hostOf(), null);
POP.npShowToolbar({ x: 10, y: 10, onHighlight() {}, onComment() {}, onNote() {} }); d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); assert.equal(hostOf(), null);
// page shortcuts do not see typing in it
POP.npShowToolbar({ x: 10, y: 10, onHighlight() {}, onComment() {}, onNote() {} });
let pageSaw = 0; d.addEventListener('keydown', () => pageSaw++);
hostOf()._root.querySelector('.bar button').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'j', bubbles: true, composed: true })); assert.equal(pageSaw, 0, 'the page did not get the key');
POP.npHide();

// ── the composer ──
let saved = null;
POP.npShowComposer({ x: 200, y: 300, heading: 'Comment', quote: 'The central bank raised rates eleven times in fourteen months.', onSave: async (text, tags) => { saved = { text, tags }; return true; } });
root = hostOf()._root;
const card = root.querySelector('.card'); assert.ok(card.querySelector('.quote').textContent.includes('central bank'));
const ta = card.querySelector('textarea'), go = card.querySelector('.go');
assert.ok(go.disabled, 'nothing to save yet');
ta.value = 'Compare with 2008 #inflation'; ta.dispatchEvent(new w.Event('input')); assert.ok(!go.disabled);
click(go); await tick(30);
assert.deepEqual(saved, { text: 'Compare with 2008', tags: ['inflation'] }); const after = hostOf()._root; assert.ok(!after.querySelector('.card'), 'closes after saving'); assert.match(after.querySelector('.toast').textContent, /Saved/);
// a failed save keeps the text
let fail = true; POP.npShowComposer({ x: 1, y: 1, heading: 'Note', onSave: async () => (fail ? false : true) });
const c2 = hostOf()._root.querySelector('.card'), t2 = c2.querySelector('textarea'); t2.value = 'keep me'; t2.dispatchEvent(new w.Event('input'));
click(c2.querySelector('.go')); await tick(30);
assert.ok(hostOf()._root.querySelector('.card') && t2.value === 'keep me', 'the text stays when saving failed'); assert.match(c2.querySelector('.go').textContent, /Try again/);
// typed text survives a click elsewhere; Escape still closes
await tick(100); d.body.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true })); assert.ok(hostOf() && hostOf()._root.querySelector('.card'), 'a click elsewhere does not throw typing away');
d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); assert.equal(hostOf(), null);

// ── the page panel: comments and notes ──
let said = [];
const actions = { jump() {}, remove() {}, keep() {}, reattach() {}, pending: () => false, summarize: async () => {},
    comment: async (id, text) => { said.push(['comment', id, text]); return true; }, note: async (text) => { said.push(['note', text]); return true; }, openNotes: () => said.push(['open']) };
const items = [{ id: 'h1', type: 'user', text: 'Prices rose faster than wages', status: 'ok', frac: 0.2, comment: 'Check chart 3' }, { id: 'h2', type: 'ghost', text: 'Supply bottlenecks', status: 'ok', frac: 0.5, comment: '' }];
PANEL.hlpRender(items, actions);
const ph = d.getElementById('aish-hl-host'), body = ph._body;
body.querySelector('.pill').click(); await tick(5);
assert.match(body.querySelector('.cmt').textContent, /Check chart 3/, 'the comment shows under its highlight');
const labels = [...body.querySelectorAll('.acts button')].filter((b) => /omment/.test(b.textContent)).map((b) => b.textContent);
assert.deepEqual(labels, ['Edit comment', 'Comment']);
// edit: the editor is filled with the comment; saving sends it; a refresh while typing keeps the typed text
[...body.querySelectorAll('.acts button')].find((b) => b.textContent === 'Comment').click(); await tick(5);
let eta = body.querySelector('.cm-ta'); assert.ok(eta && eta.value === ''); eta.value = 'half written';
PANEL.hlpRender(items, actions); eta = body.querySelector('.cm-ta'); assert.equal(eta.value, 'half written', 'a refresh does not lose what was typed');
eta.value = 'Because energy #prices'; body.querySelector('.cm-row .primary').click(); await tick(20);
assert.deepEqual(said.pop(), ['comment', 'h2', 'Because energy #prices']); assert.ok(!body.querySelector('.cm-ta'), 'the editor closes after saving');
// a note about the page, and the way to the Notes tab
body.querySelector('[data-act="note"]').click(); await tick(5);
const nta = body.querySelector('.nt-ta'); nta.value = 'Worth a newsletter issue'; body.querySelector('[data-act="nsave"]').click(); await tick(20);
assert.deepEqual(said.pop(), ['note', 'Worth a newsletter issue']); assert.ok(!body.querySelector('.nt-ta'));
body.querySelector('[data-act="opennotes"]').click(); assert.deepEqual(said.pop(), ['open']);
// text from pages is never run as HTML
PANEL.hlpRender([{ id: 'h3', type: 'user', text: 'x', status: 'ok', frac: null, comment: '<img src=x onerror=alert(1)>' }], actions);
assert.ok(!body.querySelector('.cmt img'), 'a comment is text'); assert.match(body.querySelector('.cmt').textContent, /<img src=x/);

console.log('TEST 198 OK');
process.exit(0);
