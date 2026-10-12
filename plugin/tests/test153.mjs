// Summarize screen shows real summaries only; pages saved without AI (and bare feed items) stay in History.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w, store } = setup({}); const d = w.document;
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
w.HTMLElement.prototype.scrollIntoView = function () {};
chrome.runtime.getURL = (p) => 'chrome-extension://abc/' + p;
chrome.tabs = { query: async () => [{ id: 7, url: 'https://a.example.com/x', title: 'A page', favIconUrl: '' }],
  sendMessage: (id, m, cb) => cb && cb(m.action === 'getSummaryState' ? { running: false } : { success: true }), onActivated: { addListener() {} }, onUpdated: { addListener() {} } };
const { SK } = await imp('modules/storageKeys.js');
const mk = (id, ts, extra = {}) => ({ id, title: 'T ' + id, url: 'https://x.com/' + id, timestamp: ts, summary: '<p>Summary ' + id + '</p>', ...extra });
store[SK.articlesIndex] = [
    mk('real', '2026-10-01T10:00:00Z'),
    mk('saved', '2026-10-02T10:00:00Z', { savedOnly: true, summary: '' }),
    mk('stub', '2026-10-03T10:00:00Z', { feedStub: true, summary: '' }),
    mk('both', '2026-10-04T10:00:00Z', { savedOnly: true }),   // flag left over but a summary exists: counts as summarized
];
const MS = await imp('modules/mainScreen.js');
MS.initMainScreen({ showScreen() {} });
await tick(150);
const ids = [...d.querySelectorAll('#summaryFeed .summary-bubble')].map(b => b.dataset.id);
assert.deepEqual(ids, ['real', 'both'], 'saved-only (no summary) and feed stubs are not summary cards');
console.log('TEST 153 OK');
