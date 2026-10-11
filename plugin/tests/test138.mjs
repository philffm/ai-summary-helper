// Phone inbox "Save only": asks the background to save the page without AI; success resolves the link (deleted on the
// server), failure keeps it and says so. The background action is extension-page only.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert'; import fs from 'fs';
const { store, w } = setup({});
const { SK } = await imp('../src/modules/storageKeys.js');
const { newInboxSecrets } = await imp('../src/modules/inboxCrypto.js');
store[SK.inboxConfig] = { ...newInboxSecrets(), createdAt: 1, v: 1 };
store[SK.inboxPending] = [
  { id: 's1', url: 'https://example.com/save-me', receivedAt: 1 },
  { id: 's2', url: 'https://example.org/broken', receivedAt: 2 }
];
const calls = [];
globalThis.fetch = async (url, opts) => { calls.push((opts && opts.method || 'GET') + ' ' + String(url).replace(/^.*aish_inboxes/, '')); return { status: 204, json: async () => ({}) }; };
const sent = [];
chrome.runtime.sendMessage = (m, cb) => {
  sent.push(m);
  const r = m.action === 'saveFeedItem' ? (m.url.includes('broken') ? { success: false, error: 'unreachable' } : { success: true, id: 'art1', title: 'T' }) : {};
  if (cb) { cb(r); return; } return Promise.resolve(r);
};
const openedTabs = [];
chrome.tabs = { create: (o) => { openedTabs.push(o.url); return Promise.resolve({}); } };
const view = await imp('../src/modules/inboxView.js');
await view.initInboxView(); await tick(80);
const list = w.document.getElementById('articleList');
const remount = () => view.mountPhoneCards(list);
w.document.addEventListener('aish:phone-inbox', remount); remount();
const d = w.document;
const save = (id) => d.querySelector(`#articleList .phone-inbox-save[data-id="${id}"]`);
assert(save('s1') && save('s2'), 'every waiting link has a Save only button');
assert(/Save only/.test(save('s1').textContent));
assert(!save('s1').classList.contains('feed-sum-btn'), 'separate from Summarize');

// Open: new tab with the link, the entry stays in the list
const openBtn = d.querySelector('#articleList .phone-inbox-open');
assert(openBtn, 'Open button on every row');
openBtn.click(); await tick(30);
assert.deepEqual(openedTabs, ['https://example.com/save-me']);
assert.equal(store[SK.inboxPending].length, 2, 'opening does not remove the link');
const anchor = d.querySelector('#articleList .phone-card .article-date a');
assert(anchor && anchor.getAttribute('href') === 'https://example.com/save-me' && anchor.target === '_blank', 'the card shows the host as a real link');

save('s1').click(); await tick(120);
assert(sent.some(m => m.action === 'saveFeedItem' && m.url === 'https://example.com/save-me'));
assert(!sent.some(m => m.action === 'openFeedItem'), 'no AI summary was started');
assert.deepEqual(store[SK.inboxPending].map(p => p.id), ['s2'], 'saved link leaves the list');
assert(calls.some(c => /^DELETE \/[^/]+\/items\/s1$/.test(c)), 'and is deleted on the server');

save('s2').click(); await tick(120);
assert.deepEqual(store[SK.inboxPending].map(p => p.id), ['s2'], 'a failed save keeps the link');
assert(d.querySelector('#articleList .phone-inbox-error'), 'says why');
assert(!save('s2').disabled, 'can be tried again');
assert(/didn't respond/.test(d.querySelector('#articleList .phone-inbox-error').textContent), 'unreachable has its own explanation');

const bg = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
assert(/EXTENSION_PAGE_ACTIONS = new Set\([^)]*'saveFeedItem'/.test(bg), 'only extension pages may ask for it');
assert(d.querySelector('#articleList li.article-card.phone-card .article-header h4'), 'a native History card');
assert(!d.getElementById('phoneInbox'), 'no separate From-phone box any more');
console.log('TEST 138 OK');
