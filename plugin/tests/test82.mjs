// End to end in the popup: a finished summary arrives with questions + short answers; tapping a chip types the short
// answer out while the full answer is still being requested, then the full answer replaces it.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w, store } = setup({}); const d = w.document;
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
w.HTMLElement.prototype.scrollIntoView = function () {};
chrome.runtime.getURL = (p) => 'chrome-extension://abc/' + p;
chrome.tabs = { query: async () => [{ id: 7, url: 'https://a.example.com/x', title: 'A page', favIconUrl: '' }],
  sendMessage: (id, m, cb) => cb && cb(m.action === 'getSummaryState' ? { running: false } : { success: true }), onActivated: { addListener() {} }, onUpdated: { addListener() {} } };
// the model answers slowly (1.2 s) so the typed short answer is visible meanwhile
const send = chrome.runtime.sendMessage;
chrome.runtime.sendMessage = (msg, cb) => { if (msg.action === 'aiComplete') { const res = globalThis.__ai(msg); setTimeout(() => cb && cb(res), 1200); } else send(msg, cb); };
globalThis.__ai = () => ({ ok: true, text: 'The city paid for the whole project, roughly three million euros, spread over three years.\nQUESTIONS: [{"q":"What happens next?","a":"Phase two starts next spring. It is already funded."}]' });
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
await tick(6000);   // typing + the slow full answer
const turns = [...d.querySelectorAll('.chat-a')].map(e => e.textContent);
assert(/three million euros/.test(turns[turns.length - 1]), 'full answer replaced it: ' + JSON.stringify(turns));
assert(!d.querySelector('.chat-a--quick'), 'quick marker gone');
// the new suggestion with its own short answer is usable
assert([...d.querySelectorAll('.chat-suggest-chip')].some(c => c.textContent === 'What happens next?'), 'next suggestion');
console.log('TEST 82 OK');
