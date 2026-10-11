// History paints the archive and the waiting phone links together after the skeleton: a phone-inbox event that arrives
// before the first load must not render the phone cards alone.
import { setup, imp, tick, SRC } from './harness.mjs'; import assert from 'assert'; import path from 'path'; import { pathToFileURL } from 'url';
const { store, w } = setup({});
const { SK } = await imp('../src/modules/storageKeys.js');
store['articles:index'] = [{ id: 'a1', url: 'https://example.com/saved', title: 'Saved one', timestamp: new Date().toISOString(), summary: '<p>x</p>', tags: [] }];
store[SK.inboxPending] = [{ id: 'p1', url: 'https://example.org/from-phone', receivedAt: Date.now() }];
chrome.runtime.sendMessage = (m, cb) => { if (cb) { cb({}); return; } return Promise.resolve({}); };
const href = (p) => pathToFileURL(path.join(SRC, p)).href;
const am = await import(href('modules/articleManager.js'));
const view = await import(href('modules/inboxView.js'));
for (const k of ['MutationObserver', 'IntersectionObserver', 'requestIdleCallback', 'cancelIdleCallback']) { if (w[k] && !globalThis[k]) globalThis[k] = w[k].bind ? w[k].bind(w) : w[k]; }
globalThis.MutationObserver = w.MutationObserver;
am.initArticleManager({ showToast() {}, showScreen() {} });
const list = w.document.getElementById('articleList');

// the inbox view finishes first (it starts at popup init) and says the list changed
await view.loadPhoneEntries();
w.document.dispatchEvent(new w.CustomEvent('aish:phone-inbox'));
await tick(30);
assert.equal(list.querySelectorAll('li.article-card').length, 0, 'nothing painted before the archive was read');

// opening History: skeleton, then both together
am.loadHistory();
await tick(400);
const cards = [...list.querySelectorAll('li.article-card')];
assert(cards.some(c => c.classList.contains('phone-card')) && cards.some(c => !c.classList.contains('phone-card')), 'phone card and archive card are both there');
assert(!list.querySelector('.skeleton, .skeleton-card'), 'skeleton is gone');

// afterwards a change in the inbox does re-render
store[SK.inboxPending] = [];
await view.loadPhoneEntries();
w.document.dispatchEvent(new w.CustomEvent('aish:phone-inbox'));
await tick(60);
assert.equal(list.querySelectorAll('.phone-card').length, 0, 'later changes still update the list');
// A summary lands in the archive while History is open (from a background tab): the list picks it up by itself
store['articles:index'] = [
  { id: 'a2', url: 'https://example.org/from-phone', title: 'Brand new summary', timestamp: new Date().toISOString(), summary: '<p>y</p>', tags: [] },
  ...store['articles:index']
];
(globalThis.__chL || []).forEach(f => f({ 'articles:index': {} }, 'local'));
await tick(600);
assert(/Brand new summary/.test(list.textContent), 'the new article shows without reopening History');
assert.equal(list.querySelectorAll('li.article-card').length, 2);
console.log('TEST 141 OK');
