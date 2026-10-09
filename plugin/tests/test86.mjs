// Popup follow-up with a cloud / own-key model: the short answer is shown, the full answer is only requested after "Dig deeper".
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w, store } = setup({}); const d = w.document;
store.connectionMode = 'cloud';
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
w.HTMLElement.prototype.scrollIntoView = function () {};
chrome.runtime.getURL = (p) => 'chrome-extension://abc/' + p;
chrome.tabs = { query: async () => [{ id: 7, url: 'https://a.example.com/x', title: 'A page', favIconUrl: '' }],
  sendMessage: (id, m, cb) => cb && cb(m.action === 'getSummaryState' ? { running: false } : { success: true }), onActivated: { addListener() {} }, onUpdated: { addListener() {} } };
let calls = 0;
globalThis.__ai = () => { calls++; return { ok: true, text: 'Roughly three million euros in total.\nQUESTIONS: [{"q":"What happens next?","a":"Phase two starts next spring."}]' }; };
const MS = await imp('modules/mainScreen.js');
MS.initMainScreen({ showScreen() {} });
await tick(150);
const SHORT = 'The city paid for it. It was funded in 2019.';
const fire = () => globalThis.__msgL.forEach(f => f({ action: 'summaryComplete', url: 'https://a.example.com/x', title: 'T', summary: '<div><h2>T</h2><p>Body text.</p></div>', content: '<p>Page text about funding.</p>', tags: [], questions: ['Who paid for it?', 'How long did it take?'], quick: { 'Who paid for it?': SHORT, 'How long did it take?': 'Two years.' } }, {}));
fire(); await tick(150);
const chip = (t) => [...d.querySelectorAll('.chat-suggest-chip')].find(c => c.textContent === t);
chip('Who paid for it?').click();
await tick(6000);
assert(d.querySelector('.chat-dig-go'), 'offers to dig deeper once the short answer is typed');
assert.equal(calls, 0, 'no model request before the user agrees');
assert(!d.querySelector('.chat-more:not([hidden])'), 'no "Thinking more…" yet');
d.querySelector('.chat-dig-go').click();
await tick(800);
assert.equal(calls, 1, 'full answer requested after Dig deeper');
const last = [...d.querySelectorAll('.chat-a')].pop().textContent;
assert(last.startsWith(SHORT) && /three million euros/.test(last), 'continuation appended: ' + JSON.stringify(last));
assert(!d.querySelector('.chat-dig'), 'prompt gone');
// "That is enough": the short answer is kept and nothing is requested
chip('How long did it take?')?.click();
await tick(6000);
d.querySelector('.chat-dig-skip').click();
await tick(500);
assert.equal(calls, 1, 'no request after "That is enough"');
assert(/Two years\./.test([...d.querySelectorAll('.chat-a')].pop().textContent), 'short answer kept');
console.log('TEST 86 OK');
