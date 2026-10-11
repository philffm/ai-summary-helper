// Phone links are cards in History's Inbox tab (articleManager.renderArticles), above the saved articles, even when
// nothing else is saved; a search narrows them.
import { setup, imp, tick, SRC } from './harness.mjs'; import assert from 'assert'; import path from 'path'; import { pathToFileURL } from 'url';
const { store, w } = setup({});
const { SK } = await imp('../src/modules/storageKeys.js');
store[SK.inboxPending] = [
  { id: 'p1', url: 'https://example.com/long/path/to/an/article', receivedAt: Date.now() - 1000 },
  { id: 'p2', url: 'https://news.example.org/story', receivedAt: Date.now() - 2000 },
];
chrome.runtime.sendMessage = (m, cb) => { if (cb) { cb({}); return; } return Promise.resolve({}); };
// the same module instance articleManager imports (imp() adds a cache-busting query)
const view = await import(pathToFileURL(path.join(SRC, 'modules/inboxView.js')).href);
const am = await imp('../src/modules/articleManager.js');
await view.loadPhoneEntries();
const d = w.document;
const list = d.getElementById('articleList');

// nothing saved yet: the phone cards are the content, not "Nothing here yet"
am.renderArticles([]);
assert.equal(list.querySelectorAll('li.article-card.phone-card').length, 2);
assert(!list.querySelector('#emptyMessage'), 'no empty message while links wait');

// with a saved article: phone cards first, then the article
am.renderArticles([{ id: 'a1', url: 'https://example.com/saved', title: 'Saved one', timestamp: new Date().toISOString(), summary: '<p>x</p>', tags: [] }]);
await tick(60);
const cards = [...list.querySelectorAll('li.article-card')];
assert.equal(cards.length, 3);
assert(cards[0].classList.contains('phone-card') && cards[1].classList.contains('phone-card') && !cards[2].classList.contains('phone-card'));
assert(/From phone/.test(cards[0].textContent));
assert(cards[0].querySelector('.feed-sum-btn') && cards[0].querySelector('.phone-inbox-save') && cards[0].querySelector('.phone-inbox-open'));

// a search narrows them
d.getElementById('searchInput').value = 'news.example';
am.renderArticles([]);
assert.deepEqual([...list.querySelectorAll('.phone-card')].map(c => c.dataset.phoneId), ['p2']);
d.getElementById('searchInput').value = '';

console.log('TEST 139 OK');
