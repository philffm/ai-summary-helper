// History "💬 Ask": button + count on cards, thread under the card, docked composer, streaming-free answer, saved turns, suggestions.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { store, w } = setup({});
const { SK, articleRecKey } = await imp('modules/storageKeys.js');
const A = { id: 'a1', title: 'Why SQLite is eating the edge', url: 'https://fly.io/x', timestamp: '2026-10-03T10:00:00Z', summary: '<p>Embedded replicas.</p>' };
store[SK.articlesIndex] = [{ ...A, qaCount: 1 }, { id: 'a2', title: 'Other', timestamp: '2026-10-02T10:00:00Z', summary: '<p>x</p>' }, { id: 'stub', title: 'Stub', feedStub: true, timestamp: '2026-10-01T10:00:00Z' }];
store[articleRecKey('a1')] = { ...A, content: 'SQLite supports embedded replicas for edge workloads across many regions.', conversation: [{ id: 'q1', q: 'Old question?', a: 'Old answer.', sources: [], pinned: true, ts: 't' }] };
store[articleRecKey('a2')] = { id: 'a2', title: 'Other', content: 'c', summary: '<p>x</p>' };
document.body.insertAdjacentHTML('beforeend', '<div id="historyScreen"><ul id="articleList"></ul></div>');
const { buildAskRow, closeAsk } = await imp('modules/askThread.js');
const mk = (a) => { const li = document.createElement('li'); li.className = 'article-card'; li.dataset.ts = a.timestamp; document.getElementById('articleList').appendChild(li); const r = buildAskRow(a, li); if (r) li.appendChild(r); return { li, r }; };
const idx = store[SK.articlesIndex];
const c1 = mk(idx[0]), c2 = mk(idx[1]), c3 = mk(idx[2]);
assert(c3.r === null, 'no Ask on feed placeholders');
assert(c1.r.querySelector('.ask-btn') && /1 reply/.test(c1.r.querySelector('.ask-count').textContent), 'count badge from qaCount');
assert(!c2.r.querySelector('.ask-count'), 'no badge without turns');
// Open: thread under the card with the stored turn, dock with "About" chip
c1.r.querySelector('.ask-btn').click(); await tick(60);
assert(c1.li.classList.contains('ask-open') && c1.li.querySelector('.ask-thread .chat-turn-group'), 'thread with stored turn');
const dock = document.getElementById('askDock');
assert(dock && !dock.hidden && /SQLite/.test(dock.querySelector('.ask-chip-title').textContent), 'dock shows the context');
// Switch to another card closes the first thread
c2.r.querySelector('.ask-btn').click(); await tick(60);
assert(!c1.li.querySelector('.ask-thread') && c2.li.querySelector('.ask-thread'), 'one thread at a time');
c1.r.querySelector('.ask-btn').click(); await tick(60);
// Ask: prompt carries the OLD article's text, answer is saved, suggestions arrive with it
let prompt = null;
globalThis.__ai = (m) => { prompt = m; return { ok: true, text: 'Writes go to one primary.\nSOURCES: "SQLite supports embedded replicas for edge workloads"\nQUESTIONS: ["What about backups?","Any downsides?"]' }; };
dock.querySelector('.ask-input').value = 'How are writes handled?';
dock.querySelector('.ask-send').click(); await tick(120);
assert(prompt && /embedded replicas for edge/.test(prompt.user) && /EARLIER QUESTIONS/.test(prompt.user) && /How are writes handled/.test(prompt.user), 'prompt has page text, earlier turns, question');
assert(c1.li.querySelectorAll('.ask-thread .chat-turn-group').length === 2, 'new turn appended');
assert([...c1.li.querySelectorAll('.chat-suggest-chip')].map(x => x.textContent).join('|') === 'What about backups?|Any downsides?', 'suggestions with the answer');
const saved = store[articleRecKey('a1')].conversation;
assert(saved.length === 2 && saved[1].q === 'How are writes handled?' && saved[1].pinned === false, 'turn saved');
assert(/2 replies/.test(c1.li.querySelector('.ask-count').textContent), 'count updated');
assert(store[SK.articlesIndex].find(a => a.id === 'a1').qaCount === 2, 'index qaCount in step');
// Close removes thread + hides dock
dock.querySelector('.ask-chip-x').click();
assert(!c1.li.querySelector('.ask-thread') && dock.hidden, 'closed');
// Wiring (source checks): card gets the row, list rebuilds close the thread
import fs from 'fs';
const src = fs.readFileSync(process.env.AISH_SRC + '/modules/articleManager.js', 'utf8');
assert(/buildAskRow\(article, listItem\)/.test(src) && /closeAsk\(\);/.test(src));
console.log('TEST 61 OK');
