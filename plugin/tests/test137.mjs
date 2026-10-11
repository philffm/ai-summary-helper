// Phone inbox: a link whose summary reached History (also while the popup was closed) leaves the list and is deleted on the server;
// one summarized BEFORE the link arrived does not count.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { store, w } = setup({});
const { SK } = await imp('../src/modules/storageKeys.js');
const { newInboxSecrets } = await imp('../src/modules/inboxCrypto.js');
store[SK.inboxConfig] = { ...newInboxSecrets(), createdAt: 1, v: 1 };
const t0 = Date.now();
store[SK.inboxPending] = [
  { id: 'new', url: 'https://example.com/summarized-later', receivedAt: t0 - 5000 },
  { id: 'old', url: 'https://example.com/summarized-before', receivedAt: t0 - 5000 },
  { id: 'none', url: 'https://example.com/never', receivedAt: t0 - 5000 },
];
store[SK.articlesIndex] = [
  { id: 'a1', url: 'https://example.com/summarized-later', timestamp: new Date(t0).toISOString() },
  { id: 'a2', url: 'https://example.com/summarized-before', timestamp: new Date(t0 - 86400000).toISOString() },
];
const calls = [];
chrome.runtime.sendMessage = (m, cb) => { if (cb) { cb({}); return; } return Promise.resolve({}); };
globalThis.fetch = async (url, opts) => { calls.push((opts && opts.method || 'GET') + ' ' + String(url).replace(/^.*aish_inboxes/, '')); return { status: 204, json: async () => ({}) }; };
const view = await imp('../src/modules/inboxView.js');
await view.initInboxView(); await tick(150);
assert.deepEqual(store[SK.inboxPending].map(p => p.id).sort(), ['none', 'old'], 'only the link summarized after it arrived is resolved');
assert(calls.some(c => /^DELETE \/[^/]+\/items\/new$/.test(c)), 'deleted on the server: ' + calls.join(', '));
console.log('TEST 137 OK');
