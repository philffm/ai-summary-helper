// Notes on the History cards and in the article view: counts per article, the article's own notes pane (with a field that links a new
// note to the page), and the Open button in "By article".
import assert from 'assert';
import fs from 'fs'; import path from 'path';
import { setup, imp } from './harness.mjs';
const { store, w } = setup({});
globalThis.document = w.document; globalThis.window = w;
const mem = {}; Object.defineProperty(w, 'localStorage', { value: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } }, configurable: true });
Object.defineProperty(w, 'innerWidth', { value: 1024, configurable: true });
const { SK } = await imp('modules/storageKeys.js');
const NV = await imp('modules/notesView.js');
const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

store[SK.articlesIndex] = [
    { id: 'a1', url: 'https://econ.example/post', title: 'Inflation 2021–2023', timestamp: '2026-10-01T00:00:00Z', tags: [], summary: 's' },
    { id: 'a2', url: 'https://blog.example/rates', title: 'Rates', timestamp: '2026-10-02T00:00:00Z', tags: [], summary: 's' },
    { id: 'a3', url: 'https://empty.example/', title: 'No notes here', timestamp: '2026-10-03T00:00:00Z', tags: [], summary: 's' },
];
store[SK.annotations] = [
    { id: 'h1', url: 'https://econ.example/post', text: 'Prices rose faster than wages', type: 'user', timestamp: '2026-10-31T10:00:00Z' },
    { id: 'h2', url: 'https://econ.example/post', text: 'Wages lag behind', type: 'user', timestamp: '2026-10-31T11:00:00Z' },
    { id: 'h3', url: 'https://blog.example/rates', text: 'A rate rise works with a lag', type: 'ghost', timestamp: '2026-10-30T10:00:00Z' },
];
store[SK.notesIndex] = [{ id: 'n1', kind: 'note', created: '2026-10-29T10:00:00Z', updated: '2026-10-29T10:00:00Z' }, { id: 'n2', kind: 'note', created: '2026-10-28T10:00:00Z', updated: '2026-10-28T10:00:00Z' }];
store['notes:rec:n1'] = { id: 'n1', kind: 'note', text: 'Ask Anna #todo', tags: ['todo'], url: 'https://econ.example/post', created: '2026-10-29T10:00:00Z', updated: '2026-10-29T10:00:00Z' };
store['notes:rec:n2'] = { id: 'n2', kind: 'note', text: 'A thought without an article', tags: [], created: '2026-10-28T10:00:00Z', updated: '2026-10-28T10:00:00Z' };

// counts for the History cards: only articles that carry something, free notes belong to none
const counts = await NV.noteCountsByArticle();
assert.deepEqual(counts.get('a1'), { mine: 2, ai: 0, notes: 1 });
assert.deepEqual(counts.get('a2'), { mine: 0, ai: 1, notes: 0 });
assert.equal(counts.has('a3'), false, 'an article without notes gets no chip');
assert.equal(counts.has('__free'), false, 'a note without an article is not on any card');

// the article view: this article's items only, no link back to the page it is already on, a count in the heading
const host = document.createElement('section'); document.body.appendChild(host);
const pane = NV.mountArticleNotes(host, { id: 'a1', url: 'https://econ.example/post', title: 'Inflation 2021–2023' }); await wait();
assert.equal(host.querySelectorAll('.st').length, 3, 'two highlights and the note of this article');
assert.ok(![...host.querySelectorAll('.st')].some((c) => /lag\b.*rise|without an article/.test(c.textContent)), 'nothing from other articles');
assert.equal(host.querySelectorAll('.st-src').length, 0, 'no "open the page" link inside the article itself');
assert.match(host.querySelector('.notes-article-title').textContent, /· 3$/, 'the heading counts them');
assert.ok(!host.querySelector('.notes-composer'), 'the docked composer is for the Notes screen only');

// writing a note here links it to the article's page
const ta = host.querySelector('.notes-article-add textarea'); assert.ok(ta, 'a field for a note about this article');
ta.value = 'Check the wage data #econ'; click(host.querySelector('.notes-article-add .button-primary')); await wait(150);
const made = Object.entries(store).filter(([k, v]) => k.startsWith('notes:rec:') && v && v.text === 'Check the wage data');
assert.equal(made.length, 1, 'saved, with the tag split off');
assert.equal(made[0][1].url, 'https://econ.example/post'); assert.equal(made[0][1].title, 'Inflation 2021–2023'); assert.deepEqual(made[0][1].tags, ['econ']);
assert.equal(host.querySelectorAll('.st').length, 4, 'and it shows up at once'); assert.equal(ta.value, '', 'the field is emptied');
assert.equal((await NV.noteCountsByArticle()).get('a1').notes, 2, 'the card count follows');

// an article with nothing: a hint instead of an empty box; mounting another article drops the first pane
const host2 = document.createElement('section'); document.body.appendChild(host2);
NV.mountArticleNotes(host2, { id: 'a3', url: 'https://empty.example/', title: 'No notes here' }); await wait();
assert.equal(host2.querySelectorAll('.st').length, 0); assert.match(host2.querySelector('.mcp-row-hint').textContent, /No notes on this article yet/);
assert.equal(host.children.length, 0, 'the previous article’s pane was removed');

// "By article": every real article has an Open button, the group of free notes has none
const rootA = document.createElement('div'); document.body.appendChild(rootA);
NV.createNotesPane(rootA, { mode: 'articles' }); await wait();
const rows = [...rootA.querySelectorAll('.notes-row-wrap')];
assert.equal(rows.length, 3, 'a1, a2 and the free notes');
assert.deepEqual(rows.map((r) => !!r.querySelector('.notes-open')).sort(), [false, true, true], 'free notes cannot be opened');

// wiring in the History list and the detail view (the card builder is not exported)
const src = (f) => fs.readFileSync(path.resolve(process.env.AISH_SRC, f), 'utf8');
const am = src('modules/articleManager.js');
assert.match(am, /listItem\.dataset\.aid = String\(article\.id\)/, 'cards carry their article id');
assert.match(am, /noteCountsOnce\(\)\.then\(\(counts\) => paintNoteChip\(listItem, counts\)\)/, 'every card asks for its chip');
assert.match(am, /id="articleNotesMount"/); assert.match(am, /m\.mountArticleNotes\(host, article\)/, 'the detail view mounts the notes');
assert.match(am, /chip\.className = 'tag-chip note-chip'/);
console.log('TEST 212 OK'); process.exit(0);
