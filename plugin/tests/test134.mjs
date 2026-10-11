// Phone inbox "Summarize" behaves like a feed card: progress ring while it runs, queue label, the link leaves the list
// only when the summary completed, an error keeps it and says why.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { store, w } = setup({});
const { SK } = await imp('../src/modules/storageKeys.js');
store[SK.inboxPending] = [
  { id: 'm1', url: 'https://example.com/a', receivedAt: 1 },
  { id: 'm2', url: 'https://example.org/b', receivedAt: 2 }
];
const sent = [];
let reply = { success: true, mode: 'extension', id: 7, queued: false };
chrome.runtime.sendMessage = (msg, cb) => { sent.push(msg); if (cb) { cb({}); return; } return Promise.resolve(msg.action === 'openFeedItem' ? reply : {}); };
const view = await imp('../src/modules/inboxView.js');
await view.initInboxView(); await tick(50);
const d = w.document;
const btn = (id) => d.querySelector(`#phoneInbox .feed-sum-btn[data-id="${id}"]`);
assert(btn('m1') && btn('m2'), 'both links have the feed-style Summarize button');
const fire = (msg, tabUrl) => (globalThis.__msgL || []).forEach(f => f(msg, { tab: { url: tabUrl } }));

btn('m1').click(); await tick(30);
assert(sent.some(m => m.action === 'openFeedItem' && m.summarize && m.url === 'https://example.com/a'));
assert(btn('m1').classList.contains('busy') && btn('m1').disabled, 'ring while it runs');
assert.equal(btn('m1').getAttribute('role'), 'progressbar');
fire({ action: 'summaryProgress', progress: 42 }, 'https://example.com/a');
assert.equal(btn('m1').style.getPropertyValue('--p'), '42');
assert(/42%/.test(btn('m1').textContent), 'percent in the label');
assert(!btn('m2').classList.contains('busy'), 'the other link is untouched');
assert((store[SK.inboxPending] || []).length === 2, 'still in the list while running');

fire({ action: 'summaryComplete' }, 'https://example.com/a'); await tick(600);
assert.deepEqual(store[SK.inboxPending].map(p => p.id), ['m2'], 'completed link leaves the list');

// error: the link stays, the reason is shown, the button is usable again
btn('m2').click(); await tick(30);
fire({ action: 'summaryError', error: 'Model is not reachable' }, 'https://example.org/b'); await tick(60);
assert(btn('m2') && !btn('m2').classList.contains('busy') && !btn('m2').disabled);
assert(/not reachable/.test(d.querySelector('#phoneInbox .phone-inbox-error').textContent));
assert.equal(store[SK.inboxPending].length, 1, 'kept after an error');

// queued: label says so, a click takes it out of the line again
reply = { success: true, mode: 'extension', id: 9, queued: true };
btn('m2').click(); await tick(30);
assert(/Queued/.test(btn('m2').textContent) && !btn('m2').disabled);
btn('m2').click(); await tick(30);
assert(sent.some(m => m.action === 'cancelQueuedSummary' && m.id === 9));
assert(!btn('m2').classList.contains('busy'));
console.log('TEST 134 OK');
