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
assert.deepEqual(hw.visibleWidgets(['feeds', 'stats']), ['briefing', 'continue', 'recent', 'quote']);
const rec = { '100|all': { overview: 'Old.', at: 1, n: 3 }, '200|all': { overview: 'New one. Second sentence here. Third one now.', themes: [], at: 5, n: 9 }, '300|f1': { overview: 'Other scope', at: 9 }, '400|all': { overview: '', themes: [] } };
assert.equal(hw.latestBriefing(rec).key, '200|all', 'the newest recap of all feeds');
assert.equal(hw.latestBriefing({}), null);
assert.deepEqual(hw.briefingHeadlines({ themes: ['a', 'b', 'c', 'd'] }, 3), ['a', 'b', 'c'], 'headlines = the themes');
assert.deepEqual(hw.briefingHeadlines({ overview: 'New one. Second sentence here. Third one now.' }, 2), ['New one.', 'Second sentence here.'], 'or the first sentences');
const recs = { p1: [{ url: 'https://a.com/x', text: 'short', type: 'user' }, { url: 'https://a.com/x', text: 'A highlight that is long enough to be worth reading again.', type: 'user', timestamp: '2026-01-01' }, { url: 'https://a.com/x', text: 'A ghost highlight that is long enough to be skipped entirely.', type: 'ghost' }], p2: [] };
const q = await hw.pickQuote([{ k: 'p2', n: 1 }, { k: 'p1', n: 3 }, { k: 'p3', n: 0 }], async (k) => recs[k], () => 0);
assert.equal(q.text, 'A highlight that is long enough to be worth reading again.', 'skips pages without usable highlights, ghosts and short ones');
assert.equal(await hw.pickQuote([], async () => []), null, 'no highlights: no quote');
assert.equal(hw.latestFeed([{ title: 'x', link: 'u', published: 1 }, { title: 'y', link: 'v', published: 5 }, { title: '', link: 'z' }])[0].title, 'y');
assert.deepEqual(hw.mergeFeed([{ link: 'a', title: 'old' }, { link: 'b' }], [{ link: 'b' }, { link: 'c' }]).map((i) => i.link), ['b', 'c', 'a'], 'worker finds first, no duplicates');
assert.equal(hw.greetingKey(7), 'morning'); assert.equal(hw.greetingKey(23), 'evening');

// the page
chrome.runtime.getURL = (p) => 'chrome-extension://x/' + p;
const { SK } = await imp('../src/modules/storageKeys.js');
const html = fs.readFileSync(new URL('../src/home.html', import.meta.url), 'utf8');
w.document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/i, '').replace(/<\/html>[\s\S]*$/i, '');
store[SK.articlesIndex] = index;
store[SK.hlIndex] = [{ k: 'https://a.com/x', n: 1 }];
store['hl:page:https://a.com/x'] = [{ url: 'https://a.com/x', text: 'Quote from the user highlights that is long enough.', type: 'user' }];
store[SK.feedItems] = [{ id: 'f9', title: 'Feed news', link: 'https://f.com/n', published: now, feedTitle: 'Feed F' }];
store[SK.feedRecaps] = { '1|all': { overview: 'Energy prices moved. [1]', themes: ['Grid fees rise [1]', 'Quiet elsewhere'], mood: 'neu', at: now - 12 * 60000, n: 9, refs: { 1: 'f9' } } };
let polls = 0;
chrome.runtime.sendMessage = (m, cb) => { if (m.action === 'feedPollNow') { polls++; store[SK.feedBackground] = { items: [{ id: 'n1', title: 'Fresh from worker', link: 'https://f.com/fresh', published: Date.now() + 5 }] }; } const r = { ok: true }; if (cb) { cb(r); return; } return Promise.resolve(r); };
await imp('../src/home.js'); await tick(400);
assert.equal(polls, 1, 'opening the page asks the worker to refresh the feeds');
assert(/Fresh from worker/.test(w.document.getElementById('hmGrid').textContent), 'what the refresh found shows without reloading');
assert(w.document.getElementById('hmStatus').hidden && !w.document.querySelector('.hm-updating'), 'the "Updating feeds…" line (inside the feeds card) is gone when the refresh is done');
const d = w.document;
const cards = [...d.querySelectorAll('.hm-card h2')].map((h) => h.textContent);
assert.equal(cards.length, 6, 'six cards: ' + cards);
const brief = [...d.querySelectorAll('.hm-card')].find((c) => /Today’s briefing/.test(c.textContent));
assert(brief, 'the feed briefing card is there');
assert.equal(d.querySelectorAll('.hm-col').length, 2, 'two columns');
assert(d.querySelectorAll('.hm-col')[0].children.length >= 2 && d.querySelectorAll('.hm-col')[1].children.length >= 2, 'the cards are spread over both');
assert(brief.querySelector('a.rc-cite') && brief.querySelector('a.rc-cite').href === 'https://f.com/n', 'its source chips open the feed item');
assert(/1 source/.test(brief.textContent) && /Feed news/.test(brief.querySelector('.hm-brief-src').textContent), 'the sources are listed');
brief.querySelectorAll('.hm-brief-seg button')[1].click(); await tick(30);
assert(d.querySelector('.hm-brief-list li') && !d.querySelector('.hm-brief-text .md-body'), 'Headlines shows the short form');
assert(store['home:prefs'].briefMode === 'short', 'and the choice is remembered');
assert(/Quote from the user highlights/.test(d.getElementById('hmGrid').textContent), 'a saved highlight is shown as the quote');
assert(/Half read/.test([...d.querySelectorAll('.hm-card')].find((c) => /Continue reading/.test(c.textContent)).textContent), 'continue reading lists the started article');
assert(/Feed news/.test(d.getElementById('hmGrid').textContent), 'feed item shown');
assert([...d.querySelectorAll('.hm-link')].some((a) => a.href.includes('readerPage.html#id=')), 'saved articles open in the reading view');
const box = d.querySelector('#hmCustom input'); box.checked = false; box.dispatchEvent(new w.Event('change', { bubbles: true })); await tick(50);
assert.equal(d.querySelectorAll('.hm-card').length, 5, 'a card can be hidden');
assert.deepEqual(store['home:prefs'].hidden, ['briefing'], 'and the choice is remembered');
assert(d.querySelector('#hmBox .hm-key'), 'the command that opens the search is shown inside the field');
const field = d.querySelector('#hmBox .cmdk-input'); assert(field, 'the search field is the command list, inline');
field.dispatchEvent(new w.Event('focus')); await tick(30);
assert(d.getElementById('hmBox').classList.contains('is-open') && d.getElementById('hmGrid').classList.contains('is-dim'), 'focus opens the list and dims the cards');
assert(/Continue/.test(d.querySelector('#hmBox .cmdk-list').textContent) && /Fresh from worker/.test(d.querySelector('#hmBox .cmdk-list').textContent), 'continue + new feed items are offered first');
field.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await tick(30);
assert(!d.getElementById('hmBox').classList.contains('is-open'), 'Esc closes it again');
// every card's heading links to its section: the app opens beside the page on that screen
const links = [...d.querySelectorAll('.hm-card-link')];
assert(links.length >= 4, 'each card has a link to its section: ' + links.length);
const feedsLink = [...d.querySelectorAll('.hm-card')].find((c) => /Today’s briefing/.test(c.textContent)).querySelector('.hm-card-link');
assert(/Feeds/.test(feedsLink.textContent)); feedsLink.click(); await tick(60);
assert(/popup\.html\?surface=float.*#feeds$/.test(d.querySelector('iframe.app-dock').src), 'it opens the app on Feeds from the side');
console.log('TEST 271 OK'); process.exit(0);
