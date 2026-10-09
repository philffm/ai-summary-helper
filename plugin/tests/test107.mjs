// The popup lists summaries already waiting in the background queue and tracks later queue updates.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w } = setup({}); const d = w.document;
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
w.HTMLElement.prototype.scrollIntoView = function () {};
chrome.runtime.getURL = (p) => 'chrome-extension://abc/' + p;
chrome.tabs = { query: async () => [{ id: 7, url: 'https://a.example.com/x', title: 'A page', favIconUrl: '' }],
  sendMessage: (id, m, cb) => cb && cb(m.action === 'getSummaryState' ? { running: false } : { success: true }), onActivated: { addListener() {} }, onUpdated: { addListener() {} } };
const sendMessage = chrome.runtime.sendMessage;
chrome.runtime.sendMessage = (msg, cb) => {
  if (msg.action === 'summaryJobs') return setTimeout(() => cb && cb({ ok: true, queue: [{ id: 41, title: 'OSF queued item' }] }), 0);
  return sendMessage(msg, cb);
};
const MS = await imp('modules/mainScreen.js');
MS.initMainScreen({ showScreen() {} });
await tick(150);
const notes = () => [...d.querySelectorAll('.queue-note')];
assert.equal(notes().length, 1, 'loads existing jobs when opening the popup');
assert(notes()[0].textContent.includes('OSF queued item'), 'shows queued job title');
globalThis.__msgL.forEach(f => f({ action: 'summaryQueue', queue: [{ id: 41, title: 'OSF queued item' }, { id: 42, title: 'Another queued item' }] }, {}));
assert.equal(notes().length, 2, 'adds jobs submitted elsewhere');
assert(notes()[1].textContent.includes('Another queued item'), 'shows newly queued job title');
globalThis.__msgL.forEach(f => f({ action: 'summaryQueue', queue: [{ id: 42, title: 'Another queued item' }] }, {}));
assert.equal(notes().length, 1, 'removes jobs once they leave the queue');
assert(notes()[0].textContent.includes('Another queued item'));
console.log('TEST 107 OK');
