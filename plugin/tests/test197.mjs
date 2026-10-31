// Split view: Notes is a pane choice in History and Feeds, the Notes screen has its own panes (By article, Tags), and the layout
// switcher shows on the Notes screen. Layouts saved before Notes existed still load.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
const { store, w } = setup({});
globalThis.document = w.document; globalThis.window = w;
const mem = {}; Object.defineProperty(w, 'localStorage', { value: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } }, configurable: true });
Object.defineProperty(w, 'innerWidth', { value: 1024, configurable: true });
const K = await imp('modules/storageKeys.js');
const { SK } = K;

// an older saved layout: three views, report first
store[SK.workspace] = { layout: 2, views: ['report', 'list', 'graph'] };
const NV = await imp('modules/notesView.js');
const WM = await imp('modules/workspaceManager.js');

store[SK.articlesIndex] = [{ id: 'a1', url: 'https://econ.example/post', title: 'Inflation 2021–2023', timestamp: '2026-10-01T00:00:00Z', tags: [], summary: 's' }, { id: 'a2', url: 'https://blog.example/rates', title: 'Rates explained', timestamp: '2026-10-02T00:00:00Z', tags: [], summary: 's' }];
store[SK.annotations] = [
    { id: 'h1', url: 'https://econ.example/post', text: 'Prices rose faster than wages', type: 'user', timestamp: '2026-10-31T10:00:00Z' },
    { id: 'h2', url: 'https://blog.example/rates', text: 'A rate rise works with a lag', type: 'ghost', timestamp: '2026-10-30T10:00:00Z' },
];
store[SK.notesIndex] = [{ id: 'n1', kind: 'note', created: '2026-10-29T10:00:00Z', updated: '2026-10-29T10:00:00Z' }];
store['notes:rec:n1'] = { id: 'n1', kind: 'note', text: 'Ask Anna #todo', tags: ['todo'], created: '2026-10-29T10:00:00Z', updated: '2026-10-29T10:00:00Z' };

const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const change = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); };

NV.initNotesView({});           // listens for pane events before the workspace starts
await WM.initWorkspace(); await wait();

// saved layout loads: 2 panes, and Notes was added after the three the user had
assert.equal(document.querySelectorAll('.header .ws-seg button[aria-pressed="true"]').length, 1);
assert.equal(document.querySelector('.header .ws-seg button[aria-pressed="true"]').dataset.n, '2');
let head = document.querySelectorAll('#historyScreen > .ws-head select');
assert.equal(head.length, 2); assert.deepEqual([...head[0].options].map((o) => o.value), ['list', 'graph', 'report', 'notes'], 'History offers Notes as a pane');
assert.equal(head[0].value, 'report', 'the arrangement the user had is kept (report first)');

// History: pane 2 shows Notes
document.body.dataset.screen = 'history';
change(head[1], 'notes'); await wait(150);
const hp = $('historyNotesPane');
assert.ok(hp.classList.contains('ws-p2'), 'the Notes pane takes the second column'); assert.ok(hp.querySelector('.notes-body'), 'and is filled');
assert.equal(hp.querySelectorAll('.st').length, 3, 'highlights, the AI highlight and the note');
assert.ok(hp.querySelector('.notes-composer'), 'with its composer');
assert.ok($('graphContainer').classList.contains('ws-off') || !$('graphContainer').classList.contains('ws-p1'), 'the graph pane gave way');
// Feeds offers it too
assert.deepEqual([...document.querySelectorAll('#feedsScreen > .ws-head select')[0].options].map((o) => o.value), ['list', 'graph', 'report', 'notes']);

// choosing another view closes the Notes pane
change(document.querySelectorAll('#historyScreen > .ws-head select')[1], 'graph'); await wait(120);
assert.equal(hp.children.length, 0, 'the pane is emptied when it is no longer shown');
change(document.querySelectorAll('#historyScreen > .ws-head select')[1], 'notes'); await wait(120);
assert.ok(hp.querySelector('.notes-body'), 'and comes back');

// the Notes screen: the switcher is for it too (CSS shows it by screen); panes are Notes | By article | Tags
document.body.dataset.screen = 'notes';
await wait();
const nscreen = $('notesScreen');
assert.ok(nscreen.classList.contains('ws-active'), 'the Notes screen splits like the others');
const nHead = nscreen.querySelectorAll(':scope > .ws-head select');
assert.equal(nHead.length, 2); assert.deepEqual([...nHead[0].options].map((o) => o.value), ['stream', 'articles', 'tags']);
assert.ok($('notesRoot').classList.contains('ws-p1')); assert.ok($('notesArticlesPane').classList.contains('ws-p2'));
await wait(150);
const rows = [...$('notesArticlesPane').querySelectorAll('.notes-row')];
assert.equal(rows.length, 3, 'two articles and the notes without an article');
assert.match(rows[0].textContent, /Inflation 2021–2023/);

// picking an article in one pane filters the stream in the other
click(rows.find((r) => /Rates explained/.test(r.textContent))); await wait(150);
assert.equal($('notesBody').querySelectorAll('.st').length, 1, 'the stream shows only that article');
assert.match($('notesRoot').textContent, /Rates explained/, 'with a chip that says so');
click(rows.find((r) => /Rates explained/.test(r.textContent))); await wait(150);
assert.equal($('notesBody').querySelectorAll('.st').length, 3);

// pane 2 becomes Tags: counts, and a tag filters the stream
change(nHead[1], 'tags'); await wait(150);
assert.equal($('notesArticlesPane').children.length, 0, 'By article is closed'); assert.ok($('notesTagsPane').classList.contains('ws-p2'));
const tag = [...$('notesTagsPane').querySelectorAll('.mcp-chip')].find((b) => /#todo/.test(b.textContent));
assert.ok(tag && /1/.test(tag.textContent)); click(tag); await wait(150);
assert.equal($('notesBody').querySelectorAll('.st').length, 1); click(tag); await wait(150);

// one pane again: everything but the stream is closed, History and Feeds are single again
click(document.querySelector('.header .ws-seg button[data-n="1"]')); await wait(150);
assert.ok(!nscreen.classList.contains('ws-active')); assert.equal($('notesTagsPane').children.length, 0); assert.equal(hp.children.length, 0);
assert.ok($('notesBody'), 'the Notes screen itself is untouched');

// what the user arranges is saved in the old shape plus the notes arrangement
const saved = store[SK.workspace];
assert.equal(saved.layout, 1); assert.ok(Array.isArray(saved.views) && saved.views.includes('notes')); assert.deepEqual(saved.nviews.slice().sort(), ['articles', 'stream', 'tags']);

console.log('TEST 197 OK');
process.exit(0);
