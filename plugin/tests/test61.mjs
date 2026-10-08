// Summarize feed: "💬 Ask" on older summary cards — thread under the card, composer in follow-up mode, turns saved.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w, store } = setup({}); const d = w.document;
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
w.HTMLElement.prototype.scrollIntoView = function () {};
chrome.runtime.getURL = (p) => 'chrome-extension://abc/' + p;
chrome.tabs = { query: async () => [{ id: 7, url: 'https://a.example.com/x', title: 'A page', favIconUrl: '' }],
  sendMessage: (id, m, cb) => cb && cb(m.action === 'getSummaryState' ? { running: false } : { success: true }), onActivated: { addListener() {} }, onUpdated: { addListener() {} } };
const { SK, articleRecKey } = await imp('modules/storageKeys.js');
const mkA = (id, title, ts, extra = {}) => ({ id, title, url: 'https://x.com/' + id, timestamp: ts, summary: '<p>Summary of ' + title + '</p>', ...extra });
store[SK.articlesIndex] = [mkA('a1', 'Old one', '2026-10-01T10:00:00Z', { qaCount: 1 }), mkA('a2', 'Newer one', '2026-10-02T10:00:00Z')];
store[articleRecKey('a1')] = { ...mkA('a1', 'Old one', '2026-10-01T10:00:00Z'), content: 'SQLite supports embedded replicas for edge workloads across many regions.', conversation: [{ id: 'q1', q: 'Old question?', a: 'Old answer.', sources: [], pinned: true, ts: 't' }] };
store[articleRecKey('a2')] = { ...mkA('a2', 'Newer one', '2026-10-02T10:00:00Z'), content: 'Other page text.', conversation: [] };
const MS = await imp('modules/mainScreen.js');
MS.initMainScreen({ showScreen() {} });
await tick(120);
const bubbles = [...d.querySelectorAll('#summaryFeed .summary-bubble')];
assert.equal(bubbles.length, 2);
const [b1, b2] = bubbles;   // oldest first
assert(b1.querySelector('.ask-btn') && /1 reply/.test(b1.querySelector('.ask-count').textContent), 'Ask + count');
assert(!b2.querySelector('.ask-count'));
assert(b1.querySelector('.ask-actions .read-btn'), 'Read again button sits in the card action row (hidden until a speech engine exists)');
// Ask on the older card: thread directly after that card, stored turn shown, follow-up composer
b1.querySelector('.ask-btn').click(); await tick(120);
const host = b1.nextElementSibling;
assert(host && host.classList.contains('ask-thread') && host.querySelector('.chat-turn-group'), 'thread under the card');
assert(b1.classList.contains('ask-open') && b1.querySelector('.ask-btn').getAttribute('aria-expanded') === 'true');
assert(d.getElementById('convChip') || d.querySelector('.page-chip--conv'), 'About chip (conversation chip)');
// Ask: prompt carries that article's text and earlier turns; answer lands in the same thread and is saved
let prompt = null;
globalThis.__ai = (m) => { prompt = m; return { ok: true, text: 'Writes go to one primary.\nSOURCES: "SQLite supports embedded replicas for edge workloads"\nQUESTIONS: ["What about backups?","Any downsides?"]' }; };
const input = d.getElementById('additionalQuestions');
input.value = 'How are writes handled?';
d.getElementById('fetchSummary').click(); await tick(250);
assert(prompt && /embedded replicas for edge/.test(prompt.user) && /EARLIER QUESTIONS/.test(prompt.user), 'prompt has that page text and earlier turns');
assert.equal(host.querySelectorAll('.chat-turn-group').length, 2, 'new turn inside the thread');
assert.deepEqual([...host.querySelectorAll('.chat-suggest-chip')].map(x => x.textContent), ['What about backups?', 'Any downsides?']);
assert.equal(store[articleRecKey('a1')].conversation.length, 2, 'saved');
assert(/2 replies/.test(b1.querySelector('.ask-count').textContent), 'count updated');
// Another card: first thread goes away
b2.querySelector('.ask-btn').click(); await tick(120);
assert(!b1.nextElementSibling.classList.contains('ask-thread') && b2.nextElementSibling.classList.contains('ask-thread'), 'one thread at a time');
assert(d.querySelector('#convChip .conv-back'), 'Back button stays available after switching Ask from one card to another (composer was already in follow-up)');
d.querySelector('#convChip .conv-back').click(); await tick(60);
assert(!d.getElementById('convChip'), 'Back returns to summarizing the current page');
console.log('TEST 61 OK'); process.exit(0);
