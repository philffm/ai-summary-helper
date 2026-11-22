// Home page: the widget logic and the page itself (cards, hiding, palette), plus the reading view's palette commands.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert'; import fs from 'fs';
const { store, w } = setup({});
const hw = await imp('../src/modules/homeWidgets.js');
const day = 864e5, now = Date.now(), iso = (d) => new Date(now - d * day).toISOString();
const index = [
  { id: 'a', title: 'Half read', url: 'https://a.com/x', timestamp: iso(5), progress: 0.4, lastOpened: iso(1) },
  { id: 'b', title: 'Done', url: 'https://b.com/x', timestamp: iso(3), progress: 1, finishedAt: iso(2), readAt: iso(2) },
  { id: 'c', title: 'Fresh', url: 'https://c.com/x', timestamp: iso(0) },
  { id: 'd', title: 'Archived', url: 'https://d.com', timestamp: iso(0), archived: true, progress: 0.5 },
  { id: 'e', title: 'Place only', url: 'https://e.com', timestamp: iso(9), readPlace: { exact: 'x' }, lastOpened: iso(0.5) },
  { id: 'f', title: 'Starred unread', url: 'https://f.com', timestamp: iso(8), starred: true },
];
assert.deepEqual(hw.continueReading(index).map((a) => a.id), ['e', 'a'], 'started, not finished, newest opened first; archived left out');
assert.equal(hw.recentlySaved(index, 2)[0].id, 'c');
assert(!hw.recentlySaved(index, 10).some((a) => a.id === 'd'), 'archived is not recent');
assert.deepEqual(hw.libraryStats(index, now), { total: 5, unread: 3, starred: 1, finishedThisWeek: 1 });
assert.deepEqual(hw.visibleWidgets(['feeds', 'stats']), ['continue', 'recent', 'goto']);
assert.equal(hw.latestFeed([{ title: 'x', link: 'u', published: 1 }, { title: 'y', link: 'v', published: 5 }, { title: '', link: 'z' }])[0].title, 'y');
assert.deepEqual(hw.mergeFeed([{ link: 'a', title: 'old' }, { link: 'b' }], [{ link: 'b' }, { link: 'c' }]).map((i) => i.link), ['b', 'c', 'a'], 'worker finds first, no duplicates');
assert.equal(hw.greetingKey(7), 'morning'); assert.equal(hw.greetingKey(23), 'evening');

// the page
chrome.runtime.getURL = (p) => 'chrome-extension://x/' + p;
const { SK } = await imp('../src/modules/storageKeys.js');
const html = fs.readFileSync(new URL('../src/home.html', import.meta.url), 'utf8');
w.document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/i, '').replace(/<\/html>[\s\S]*$/i, '');
store[SK.articlesIndex] = index;
store[SK.feedItems] = [{ title: 'Feed news', link: 'https://f.com/n', published: now, feedTitle: 'Feed F' }];
let polls = 0;
chrome.runtime.sendMessage = (m, cb) => { if (m.action === 'feedPollNow') { polls++; store[SK.feedBackground] = { items: [{ id: 'n1', title: 'Fresh from worker', link: 'https://f.com/fresh', published: Date.now() + 5 }] }; } const r = { ok: true }; if (cb) { cb(r); return; } return Promise.resolve(r); };
await imp('../src/home.js'); await tick(400);
assert.equal(polls, 1, 'opening the page asks the worker to refresh the feeds');
assert(/Fresh from worker/.test(w.document.getElementById('hmGrid').textContent), 'what the refresh found shows without reloading');
assert(w.document.getElementById('hmStatus').hidden, 'status line goes away');
const d = w.document;
const cards = [...d.querySelectorAll('.hm-card h2')].map((h) => h.textContent);
assert.equal(cards.length, 5, 'five cards: ' + cards);
assert(/Half read/.test(d.querySelector('.hm-card').textContent), 'continue reading lists the started article');
assert(/Feed news/.test(d.getElementById('hmGrid').textContent), 'feed item shown');
assert(d.querySelector('.hm-link').href.includes('readerPage.html#id='), 'links open the reading view');
const box = d.querySelector('#hmCustom input'); box.checked = false; box.dispatchEvent(new w.Event('change', { bubbles: true })); await tick(50);
assert.equal(d.querySelectorAll('.hm-card').length, 4, 'a card can be hidden');
assert.deepEqual(store['home:prefs'], { hidden: ['continue'] }, 'and the choice is remembered');
const field = d.querySelector('#hmBox .cmdk-input'); assert(field, 'the search field is the command list, inline');
field.dispatchEvent(new w.Event('focus')); await tick(30);
assert(d.getElementById('hmBox').classList.contains('is-open') && d.getElementById('hmGrid').classList.contains('is-dim'), 'focus opens the list and dims the cards');
assert(/Continue/.test(d.querySelector('#hmBox .cmdk-list').textContent) && /Fresh from worker/.test(d.querySelector('#hmBox .cmdk-list').textContent), 'continue + new feed items are offered first');
field.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await tick(30);
assert(!d.getElementById('hmBox').classList.contains('is-open'), 'Esc closes it again');
console.log('TEST 271 OK'); process.exit(0);
