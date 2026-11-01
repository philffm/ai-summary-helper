// Notes tab: your own highlights and the AI's can be removed, the way the page itself removes them.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
const { store, w } = setup({});
globalThis.document = w.document; globalThis.window = w;
const mem = {}; Object.defineProperty(w, 'localStorage', { value: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } }, configurable: true });
Object.defineProperty(w, 'innerWidth', { value: 1024, configurable: true });
const sent = []; const origSend = chrome.runtime.sendMessage; chrome.runtime.sendMessage = (m, cb) => { sent.push(m); if (typeof cb === 'function') cb({ ok: true }); return Promise.resolve({ ok: true }); };
w.confirm = () => true; globalThis.confirm = () => true;
const { SK } = await imp('modules/storageKeys.js');
const NV = await imp('modules/notesView.js');
const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

store[SK.articlesIndex] = [{ id: 'a1', url: 'https://econ.example/post', title: 'Inflation', timestamp: '2026-10-01T00:00:00Z', tags: [], summary: 's' }];
store[SK.annotations] = [
    { id: 'h1', url: 'https://econ.example/post', text: 'Prices rose faster than wages', type: 'user', timestamp: '2026-10-31T10:00:00Z' },
    { id: 'h2', url: 'https://econ.example/post', text: 'An AI picked this passage', type: 'ghost', timestamp: '2026-10-31T09:00:00Z' },
    { id: 'h3', url: 'https://econ.example/post', text: 'Another highlight of mine', type: 'user', timestamp: '2026-10-31T08:00:00Z' },
];
const at = '2026-10-31T10:30:00Z';
store[SK.notesIndex] = [{ id: 'c_h1', kind: 'comment', created: at, updated: at, hl: 'h1' }];
store['notes:rec:c_h1'] = { id: 'c_h1', kind: 'comment', highlightId: 'h1', text: 'Check the wage data', tags: [], created: at, updated: at };

const root = document.createElement('div'); document.body.appendChild(root);
NV.createNotesPane(root, { mode: 'stream' }); await wait(150);
const cards = () => [...root.querySelectorAll('.st')];
assert.equal(cards().length, 3);
const removeOf = (text) => [...cards()].find((c) => c.textContent.includes(text)).querySelector('.st-del');
assert.ok(removeOf('Prices rose'), 'a highlight has a Remove action'); assert.ok(removeOf('An AI picked'), 'so does an AI highlight');

// your own: out of the list, a deletion marker for sync, its comment gone, the others untouched
click(removeOf('Prices rose')); await wait(200);
assert.deepEqual(store[SK.annotations].map((a) => a.id), ['h2', 'h3'], 'taken out of hl:all');
assert.deepEqual(sent.filter((m) => m.action === 'syncHlDeleted'), [{ action: 'syncHlDeleted', ids: ['h1'] }], 'the worker is told, so sync writes a deletion marker');
assert.ok(!('notes:rec:c_h1' in store) && !(store[SK.notesIndex] || []).some((e) => e.id === 'c_h1'), 'its comment is removed too');
assert.equal(cards().length, 2); assert.ok(!cards().some((c) => c.textContent.includes('Prices rose')));

// the AI's: kept as dismissed (it must never come back), no deletion marker, gone from the view
const before = sent.length;
click(removeOf('An AI picked')); await wait(200);
assert.deepEqual(store[SK.annotations].map((a) => [a.id, !!a.dismissed]), [['h2', true], ['h3', false]], 'dismissed, not deleted');
assert.equal(sent.length, before, 'no deletion marker for a dismissed AI highlight');
assert.equal(cards().length, 1);

// declining the question changes nothing
w.confirm = () => false; globalThis.confirm = () => false;
click(removeOf('Another highlight')); await wait(150);
assert.equal(store[SK.annotations].length, 2); assert.equal(cards().length, 1);
chrome.runtime.sendMessage = origSend;
console.log('TEST 214 OK'); process.exit(0);
