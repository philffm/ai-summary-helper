// Notes tab: the stream, filters, hashtags, the list and grid, the docked composer, comments on highlights, editing and deleting.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
const { store, w } = setup({});
globalThis.document = w.document; globalThis.window = w;
w.confirm = () => true;
const mem = {};   // jsdom has no localStorage for the extension's opaque origin
Object.defineProperty(w, 'localStorage', { value: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } }, configurable: true });
const K = await imp('modules/storageKeys.js');
const V = await imp('modules/notesView.js');
const { SK, noteRecKey } = K;

// pure parts: hashtags at the end become tags, the stream joins everything and finds each item's article
assert.deepEqual(V.splitTags('Ask Anna #todo #inflation'), { text: 'Ask Anna', tags: ['todo', 'inflation'] });
assert.deepEqual(V.splitTags('Use #hashtag inside the text'), { text: 'Use #hashtag inside the text', tags: [] });
assert.deepEqual(V.splitTags('  #only '), { text: '', tags: ['only'] });

const articles = [{ id: 'a1', url: 'https://econ.example/post?utm_source=x', title: 'Inflation 2021–2023' }, { id: 'a2', url: 'https://blog.example/rates', title: 'Rates explained' }];
const highlights = [
    { id: 'h1', url: 'https://econ.example/post', text: 'Prices rose faster than wages', type: 'user', timestamp: '2026-10-31T10:00:00Z' },
    { id: 'h2', url: 'https://blog.example/rates', text: 'A rate rise works with a lag', type: 'ghost', timestamp: '2026-10-30T10:00:00Z' },
    { id: 'h3', url: 'https://blog.example/rates', text: 'Dismissed one', type: 'ghost', dismissed: true, timestamp: '2026-10-30T11:00:00Z' },
];
const notes = [{ id: 'n1', kind: 'note', text: 'Ask Anna', tags: ['todo'], created: '2026-10-31T12:00:00Z' }];
const stream = V.buildStream({ notes, comments: { h1: { text: 'Check chart 3', tags: ['wages'] } }, highlights, articles });
assert.deepEqual(stream.map((i) => i.id), ['n1', 'h1', 'h2'], 'newest first, dismissed highlights left out');
assert.equal(stream[1].comment, 'Check chart 3'); assert.deepEqual(stream[1].tags, ['wages']);
assert.equal(stream[1].source.title, 'Inflation 2021–2023', 'a highlight finds its article even when the stored address lost its query');
assert.equal(stream[0].source, null, 'a free note has no article');
const f = (o) => V.filterStream(stream, o).map((i) => i.id);
assert.deepEqual(f({ filter: 'mine' }), ['h1']); assert.deepEqual(f({ filter: 'ai' }), ['h2']); assert.deepEqual(f({ filter: 'notes' }), ['n1']);
assert.deepEqual(f({ q: 'chart' }), ['h1'], 'search reaches the comment'); assert.deepEqual(f({ q: 'rates' }), ['h2'], 'and the article title');
assert.deepEqual(f({ tag: 'TODO' }), ['n1']); assert.deepEqual(f({ q: 'zzz' }), []);

// the screen
store[SK.annotations] = highlights.slice(); store[SK.articlesIndex] = articles;
const hlBefore = JSON.stringify(store[SK.annotations]);
V.initNotesView({}); document.body.dataset.screen = 'notes';
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const root = () => document.getElementById('notesRoot');
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const btn = (t, scope = root()) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === t);
V.onNotesScreenShown(); await wait();

assert.equal(root().querySelectorAll('.st').length, 2, 'the two highlights are shown');
assert.ok(document.getElementById('notesComposer') && document.getElementById('notesInput'), 'the composer is docked below the stream');
assert.ok(root().lastElementChild.id === 'notesComposer', 'and it is the last thing on the screen');

// composer: a card like the Summarize screen's, always visible with its label and Add button; adds a note with tags, clears itself
const input = document.getElementById('notesInput'), comp = document.getElementById('notesComposer');
assert.ok(comp.classList.contains('input-card'), 'same card as the Summarize screen');
assert.match(comp.querySelector('.input-card-label').textContent, /New note/); assert.ok(btn('Add', comp), 'the Add button is always there');
input.value = 'Ask Anna about the cap #todo #inflation';
click(btn('Add', comp)); await wait(120);
assert.equal(store[SK.notesIndex].length, 1); const nid = store[SK.notesIndex][0].id;
assert.equal(store[noteRecKey(nid)].text, 'Ask Anna about the cap'); assert.deepEqual(store[noteRecKey(nid)].tags, ['todo', 'inflation']);
assert.equal(input.value, '');
assert.equal(root().querySelectorAll('.st').length, 3); assert.ok(root().querySelector('.st-note'), 'the note is a pink sticky');

// a wide window starts as a grid (jsdom is 1024px wide); list groups by day, grid does not; the choice is remembered
assert.ok(root().querySelector('.notes-grid'), 'wide window: grid by default');
click(btn('☰ List')); await wait();
assert.ok(root().querySelectorAll('.settings-caption').length >= 1, 'list: day headings');
click(btn('▦ Grid')); await wait();
assert.ok(root().querySelector('.notes-grid') && root().querySelectorAll('.settings-caption').length === 0, 'grid: one flat board');
assert.equal(w.localStorage.getItem('aish.notesView'), 'grid');
click(btn('☰ List')); await wait(); assert.ok(!root().querySelector('.notes-grid')); assert.equal(w.localStorage.getItem('aish.notesView'), 'list');

// filters and search
click(btn('Mine')); await wait(); assert.equal(root().querySelectorAll('.st').length, 1); assert.ok(root().querySelector('.st-user'));
click(btn('Everything')); await wait();
const search = document.getElementById('notesSearch'); search.value = 'anna'; search.dispatchEvent(new w.Event('input')); await wait(200);
assert.equal(root().querySelectorAll('.st').length, 1); search.value = ''; search.dispatchEvent(new w.Event('input')); await wait(200);
click(btn('#todo')); await wait(); assert.equal(root().querySelectorAll('.st').length, 1, 'a tag chip filters'); click(btn('#todo', root().querySelector('.notes-tags'))); await wait();
assert.equal(root().querySelectorAll('.st').length, 3);

// a comment on a highlight: stored as its own record, the highlight array is untouched
const h1card = [...root().querySelectorAll('.st-user')][0];
click(btn('Comment', h1card)); await wait(40);
const ta = root().querySelector('.st-ta'); assert.ok(ta, 'an editor opens in the sticky');
ta.value = 'Check against chart 3 #wages'; click(btn('Save', root())); await wait(150);
assert.equal(store[noteRecKey('c_h1')].text, 'Check against chart 3'); assert.deepEqual(store[noteRecKey('c_h1')].tags, ['wages']); assert.equal(store[noteRecKey('c_h1')].highlightId, 'h1');
assert.match(root().querySelector('.st-user .st-c').textContent, /Check against chart 3/);
assert.equal(JSON.stringify(store[SK.annotations]), hlBefore, 'highlights were not rewritten');
// remove the comment again
click(btn('Edit comment', root().querySelector('.st-user'))); await wait(40);
click(btn('Remove comment', root())); await wait(150);
assert.ok(!(noteRecKey('c_h1') in store)); assert.ok(!root().querySelector('.st-user .st-c'));

// edit and delete a note
click(btn('Edit', root().querySelector('.st-note'))); await wait(40);
root().querySelector('.st-ta').value = 'Rewritten note'; click(btn('Save', root())); await wait(150);
assert.equal(store[noteRecKey(nid)].text, 'Rewritten note');
click(btn('Delete', root().querySelector('.st-note'))); await wait(150);
assert.ok(!(noteRecKey(nid) in store)); assert.equal(root().querySelectorAll('.st').length, 2);

console.log('TEST 194 OK');
process.exit(0);
