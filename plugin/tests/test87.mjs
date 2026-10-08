// A summary card shown the moment a summary completes gets its Ask / Read again row once the save is confirmed (in either message order).
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w } = setup({}); const d = w.document;
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
w.HTMLElement.prototype.scrollIntoView = function () {};
chrome.runtime.getURL = (p) => 'chrome-extension://abc/' + p;
chrome.tabs = { query: async () => [{ id: 7, url: 'https://a.example.com/x', title: 'A page', favIconUrl: '' }],
  sendMessage: (id, m, cb) => cb && cb(m.action === 'getSummaryState' ? { running: false } : { success: true }), onActivated: { addListener() {} }, onUpdated: { addListener() {} } };
const MS = await imp('modules/mainScreen.js');
MS.initMainScreen({ showScreen() {} });
await tick(150);
const send = (m) => globalThis.__msgL.forEach(f => f(m, {}));
const done = (url) => send({ action: 'summaryComplete', url, title: 'T', summary: '<div><p>Body.</p></div>', content: '<p>x</p>', tags: [], questions: [], quick: {} });
done('https://a.example.com/x'); await tick(100);
const card = () => [...d.querySelectorAll('.summary-bubble')].pop();
assert(!card().querySelector('.ask-btn'), 'not yet saved: no id, no Ask');
send({ action: 'summarySaved', id: 'a1', url: 'https://a.example.com/x' }); await tick(100);
assert(card().querySelector('.ask-btn'), 'Ask appears once saved');
assert.equal(card().querySelectorAll('.ask-actions').length, 1);
// saved before the card exists
send({ action: 'summarySaved', id: 'b2', url: 'https://a.example.com/y' });
done('https://a.example.com/y'); await tick(100);
assert(card().querySelector('.ask-btn'), 'Ask present when the save came first');
console.log('TEST 87 OK');
