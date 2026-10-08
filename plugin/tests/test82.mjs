// End to end in the popup: a finished summary arrives with questions + short answers; tapping a chip types the short
// answer out while the full answer is still being requested, then the full answer replaces it.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w, store } = setup({}); const d = w.document;
store.connectionMode = 'local'; store.activeService = 'ollama';   // local Ollama: the full answer is requested right away
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
w.HTMLElement.prototype.scrollIntoView = function () {};
chrome.runtime.getURL = (p) => 'chrome-extension://abc/' + p;
chrome.tabs = { query: async () => [{ id: 7, url: 'https://a.example.com/x', title: 'A page', favIconUrl: '' }],
  sendMessage: (id, m, cb) => cb && cb(m.action === 'getSummaryState' ? { running: false } : { success: true }), onActivated: { addListener() {} }, onUpdated: { addListener() {} } };
// the model answers slowly (1.2 s) so the typed short answer is visible meanwhile
const send = chrome.runtime.sendMessage;
chrome.runtime.sendMessage = (msg, cb) => { if (msg.action === 'aiComplete') { const res = globalThis.__ai(msg); setTimeout(() => cb && cb(res), globalThis.__delay || 1200); } else send(msg, cb); };
globalThis.__ai = (m) => { globalThis.__lastPrompt = m; return { ok: true, text: 'Roughly three million euros in total, spread over three years.\nQUESTIONS: [{"q":"What happens next?","a":"Phase two starts next spring. It is already funded."}]' }; };
const MS = await imp('modules/mainScreen.js');
MS.initMainScreen({ showScreen() {} });
await tick(150);
const L = globalThis.__msgL; assert(L && L.length, 'listener');
const SHORT = 'The city paid for it. It was funded in 2019.';
L.forEach(f => f({ action: 'summaryComplete', url: 'https://a.example.com/x', title: 'T', summary: '<div><h2>T</h2><p>Body text.</p></div>', content: '<p>Page text about funding.</p>', tags: [], questions: ['Who paid for it?', 'How long did it take?'], quick: { 'Who paid for it?': SHORT } }, {}));
await tick(150);
const chips = [...d.querySelectorAll('.chat-suggest-chip')];
assert.deepEqual(chips.map(c => c.textContent), ['Who paid for it?', 'How long did it take?'], 'chips');
chips[0].click();
await tick(120);
const ans = () => d.querySelector('.chat-a');
assert(ans(), 'answer element exists right away');
const t0 = ans().textContent;
assert(t0.length < SHORT.length, 'not instant: starts empty/short, got ' + JSON.stringify(t0));
await tick(500);
const t1 = ans().textContent;
assert(t1.length > t0.length && SHORT.startsWith(t1.replace(/\s…$/, '').trim()) , 'typing in progress: ' + JSON.stringify(t1));
assert(d.querySelector('.chat-a--quick'), 'marked as quick answer');
assert(d.querySelector('.chat-more') && /Thinking more/.test(d.querySelector('.chat-more').textContent), '"Thinking more…" indicator while waiting');
// the model's continuation must not wipe what is on screen: every later state starts with the short answer
let seen = []; for (let i = 0; i < 30; i++) { await tick(250); const e = ans(); if (e) seen.push(e.textContent); }
const grown = seen.filter(t => t.length > 0 && !t.startsWith('Thinking'));
assert(grown.length, 'answer text seen');
for (const t of seen) { if (t.length > SHORT.length) assert(t.startsWith(SHORT), 'continues the typed text, never restarts: ' + JSON.stringify(t)); }
await tick(2500);
const turns = [...d.querySelectorAll('.chat-a')].map(e => e.textContent);
const last = turns[turns.length - 1];
assert(last.startsWith(SHORT) && /three million euros/.test(last), 'short answer + continuation: ' + JSON.stringify(last));
assert(!d.querySelector('.chat-a--quick') && !d.querySelector('.chat-more'), 'markers gone');
assert([...d.querySelectorAll('.chat-suggest-chip')].some(c => c.textContent === 'What happens next?'), 'next suggestion');
// Stop: happy with the short answer → the request is cancelled and the short answer is kept as the answer
globalThis.__delay = 60000;
const next = [...d.querySelectorAll('.chat-suggest-chip')].find(c => c.textContent === 'What happens next?'); next.click();
await tick(300);
assert(d.querySelector('.chat-more-stop'), 'Stop button next to "Thinking more…"');
await tick(5000);   // short answer typed completely, the model is still thinking (1.2 s delay is over soon, so stop right away)
d.querySelector('.chat-more-stop')?.click();
await tick(600);
const all = [...d.querySelectorAll('.chat-a')].map(e => e.textContent);
assert(/Phase two starts next spring\. It is already funded\./.test(all[all.length - 1]), 'kept the short answer: ' + JSON.stringify(all[all.length - 1]));
assert(!d.querySelector('.chat-more'), 'indicator gone');
console.log('TEST 82 OK');
