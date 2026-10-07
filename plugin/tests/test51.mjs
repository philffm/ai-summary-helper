// A summary started from the page (not the panel button) still shows the thread, bubble and progress in the panel.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w } = setup({}); const d = w.document;
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
chrome.runtime.getURL = (p) => 'chrome-extension://abc/' + p;
chrome.tabs = { query: async () => [{ id: 7, url: 'https://a.example.com/x', title: 'A page', favIconUrl: '' }],
  sendMessage: (id, m, cb) => cb && cb(m.action === 'getSummaryState' ? { running: false } : { success: true }), onActivated: { addListener() {} }, onUpdated: { addListener() {} } };
const MS = await imp('modules/mainScreen.js');
MS.initMainScreen({ showScreen() {} });
await tick(60);
const bar = d.querySelector('.controls-bar');
assert.equal(bar.dataset.state, 'fetch');
const send = (m) => (globalThis.__msgL || []).forEach(f => f(m));
send({ action: 'summaryContext', words: 1200, host: 'a.example.com', highlights: 2, length: 200 });
await tick(30);
assert.equal(bar.dataset.state, 'working', 'composer working');
assert(d.querySelector('#summaryFeed .chat-q--first'), 'first bubble');
assert(d.getElementById('streamBubble'), 'progress bubble');
send({ action: 'summaryProgress', chunk: 'Receiving data…', progress: 30 });
await tick(10);
assert(d.getElementById('streamBubble'), 'still showing');
console.log('TEST 51 OK');
process.exit(0);
