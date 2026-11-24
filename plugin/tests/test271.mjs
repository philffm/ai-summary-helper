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
assert.deepEqual(hw.visibleWidgets(['quote', 'stats', 'quiz', 'gaps']), ['briefing', 'continue', 'recent', 'graph']);
// highlight or note: by chance when both exist, the other when one has nothing usable
const WIDGETS_ORDER = hw.WIDGETS;
const hlIdx = [{ k: 'p1', n: 1 }], readPage = async () => [{ url: 'https://a.com/x', text: 'A highlight that is long enough to be worth reading again.', type: 'user' }];
const noteIdx = [{ id: 'n1', kind: 'note' }, { id: 'c1', kind: 'comment' }], readNote = async (id) => (id === 'n1' ? { text: 'My own thought about how this connects to the other article.', title: 'Notes on X', url: 'https://n.com/' } : { text: 'a comment that should lose against a note' });
const kinds = new Set(); for (let i = 0; i < 12; i++) kinds.add((await hw.pickSnippet({ hlIndex: hlIdx, readPage, noteIndex: noteIdx, readNote }, () => (i % 2 ? 0.1 : 0.9))).kind);
assert.deepEqual([...kinds].sort(), ['highlight', 'note'], 'both kinds come up, not always the same');
assert.equal((await hw.pickSnippet({ hlIndex: [], readPage, noteIndex: noteIdx, readNote })).text.slice(0, 6), 'My own', 'a note (not a comment) when there are no highlights');
assert.equal((await hw.pickSnippet({ hlIndex: hlIdx, readPage, noteIndex: [{ id: 'x', kind: 'note' }], readNote: async () => ({ text: 'short' }) }, () => 0.9)).kind, 'highlight', 'the other kind when one has nothing usable');
assert.equal(await hw.pickSnippet({ hlIndex: [], readPage, noteIndex: [], readNote }), null);
// a comment on a highlight is not a note: alone it is a sentence without its passage (the card once showed only that)
assert.equal(await hw.pickSnippet({ hlIndex: [], readPage, noteIndex: [{ id: 'c1', kind: 'comment' }], readNote }), null, 'only comments and no highlights: nothing to show');
assert.equal((await hw.pickSnippet({ hlIndex: hlIdx, readPage, noteIndex: [{ id: 'c1', kind: 'comment' }], readNote }, () => 0.9)).kind, 'highlight', 'comments do not make the note side');
// a note written with a quote brings the quote
const withQ = await hw.pickNote([{ id: 'q1', kind: 'note' }], async () => ({ text: 'My thought on this passage, in my own words.', quote: 'The passage I selected on the page.', title: 'T', url: 'https://q.com/' }));
assert.equal(withQ.quote, 'The passage I selected on the page.'); assert(/^My thought/.test(withQ.text));
// topics and their bubbles
const arts2 = [['AI', 'Energy'], ['AI'], ['AI', 'Energy'], ['Energy'], ['Solo'], ['AI', '🌐 de']].map((tags, i) => ({ id: 'z' + i, tags, timestamp: new Date().toISOString() }));
const tt = hw.topTopics(arts2, { tagId: (t) => 'tag-' + t, tagLabel: (t) => t, isLanguage: (t) => t.startsWith('🌐') });
assert.deepEqual(tt.map((x) => [x.label, x.n]), [['AI', 4], ['Energy', 3]], 'topics by article count; a language mark and a one-article topic are left out');
const bub = hw.packBubbles(tt, 400, 120);
assert.equal(bub.length, 2); assert(bub[0].r > bub[1].r, 'radius follows the number of articles');
assert(Math.hypot(bub[0].x - bub[1].x, bub[0].y - bub[1].y) >= bub[0].r + bub[1].r, 'no overlap');
assert(bub.every((b) => b.x - b.r >= 0 && b.x + b.r <= 400 && b.y - b.r >= 0 && b.y + b.r <= 120), 'inside the box');
const nowQ = Date.now();
const quizzes = [{ id: 'q1', name: 'Heat pumps', remindAt: new Date(nowQ - 3600e3).toISOString(), last: { at: new Date(nowQ - 3 * 864e5).toISOString(), missed: ['a', 'b'] }, questions: [1, 2, 3] },
  { id: 'q2', name: 'Not yet', remindAt: new Date(nowQ + 864e5).toISOString(), questions: [1] },
  { id: 'q3', name: 'Done again', remindAt: new Date(nowQ - 864e5).toISOString(), last: { at: new Date(nowQ - 3600e3).toISOString(), missed: [] }, questions: [1] }];
assert.deepEqual(hw.dueQuizzes(quizzes, nowQ).map((q) => q.id), ['q1'], 'due = the reminder has passed and the quiz was not run again since');
assert.equal(hw.dueQuizzes(quizzes, nowQ)[0].missed, 2);
const pg = hw.pager([1, 2, 3, 4, 5], 2);
assert.deepEqual(pg.next(), [1, 2]); assert(pg.more()); assert.deepEqual(pg.next(), [3, 4]); assert.deepEqual(pg.next(), [5]); assert(!pg.more() && pg.total === 5 && pg.shown === 5, 'pages through a long list');
const rec = { '100|all': { overview: 'Old.', at: 1, n: 3 }, '200|all': { overview: 'New one. Second sentence here. Third one now.', themes: [], at: 5, n: 9 }, '300|f1': { overview: 'Other scope', at: 9 }, '400|all': { overview: '', themes: [] } };
assert.equal(hw.latestBriefing(rec).key, '200|all', 'the latest day that has a recap of all feeds');
const day0 = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
const mixed = { ['w:' + (day0 - 3 * 864e5) + '|all']: { overview: 'A week roll-up of 636 items.', at: Date.now(), n: 636 }, [(day0 - 864e5) + '|all']: { overview: 'Yesterday.', at: Date.now() - 1000, n: 40 }, [day0 + '|all']: { overview: 'Today.', at: Date.now() - 5e6, n: 52 }, [day0 + '|feed1']: { overview: 'One feed only.', at: Date.now() } };
assert.equal(hw.latestBriefing(mixed).recap.overview, 'Today.', "today's day recap of all feeds, not a week roll-up or a recap of one feed, even when those are newer");
delete mixed[day0 + '|all']; assert.equal(hw.latestBriefing(mixed).recap.overview, 'Yesterday.', 'without one for today: the latest day, never the roll-up');
assert.equal(hw.latestBriefing({}), null);
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
index[0].tags = ['Energy']; index[1].tags = ['Energy']; index[2].tags = ['Energy', 'AI']; index[4].tags = ['AI'];
index.push({ id: 'g1', title: 'A topic started long ago', url: 'https://g.com/x', timestamp: iso(90), tags: ['Solo topic'] });
chrome.storage.local.getKeys = async () => Object.keys(store);
store[SK.articlesIndex] = index;
store['quiz:rec:q1'] = { id: 'q1', name: 'Heat pumps', remindAt: new Date(Date.now() - 3600e3).toISOString(), last: { at: new Date(Date.now() - 3 * 864e5).toISOString(), missed: ['a', 'b'] }, questions: [1, 2, 3] };
store[SK.hlIndex] = [{ k: 'https://a.com/x', n: 1 }];
store['hl:page:https://a.com/x'] = [{ url: 'https://a.com/x', text: 'Quote from the user highlights that is long enough.', type: 'user' }];
store[SK.feedItems] = [{ id: 'f9', title: 'Feed news', link: 'https://f.com/n', published: now, feedTitle: 'Feed F' }];
store[SK.feedRecaps] = { '1|all': { overview: 'Energy prices moved. [1]', themes: ['Grid fees rise [1]', 'Quiet elsewhere'], mood: 'neu', at: now - 3 * 3600000, n: 9, refs: { 1: 'f9' } } };
let polls = 0;
chrome.runtime.sendMessage = (m, cb) => { if (m.action === 'feedPollNow') { polls++; store[SK.feedBackground] = { items: [{ id: 'n1', title: 'Fresh from worker', link: 'https://f.com/fresh', published: Date.now() + 5 }] }; } const r = { ok: true }; if (cb) { cb(r); return; } return Promise.resolve(r); };
await imp('../src/home.js'); await tick(400);
assert.equal(polls, 1, 'opening the page asks the worker to refresh the feeds');
assert(/Fresh from worker/.test(w.document.getElementById('hmGrid').textContent), 'what the refresh found shows without reloading');
assert(w.document.getElementById('hmStatus').hidden && !w.document.querySelector('.hm-updating'), 'the "Updating feeds…" line (inside the feeds card) is gone when the refresh is done');
const d = w.document;
// the entrance survives the renders that come right after the first one: the cards carry their delay (a negative one when it is already going)
assert([...d.querySelectorAll('.hm-card[data-card]')].some((c) => c.classList.contains('hm-enter') && /ms$/.test(c.style.getPropertyValue('--hm-delay'))), 'cards are still coming in');
// every card but the glance card has a handle next to its heading
assert(d.querySelectorAll('.hm-card h2 .hm-grip').length >= 6 && d.querySelector('[data-card="briefing"] .hm-grip'), 'a drag handle next to every heading, the glance card too');
// the update button next to "Latest" pulls every feed now (force), whatever its schedule; so does the briefing's update button
const sent = []; const origSend = chrome.runtime.sendMessage; chrome.runtime.sendMessage = (m, cb) => { sent.push(m); return origSend(m, cb); };
d.querySelector('.hm-latest .hm-refresh').click(); await tick(200);
assert(sent.some((m) => m.action === 'feedPollNow' && m.force === true), 'the button forces a pull of every feed');
chrome.runtime.sendMessage = origSend;
const cards = [...d.querySelectorAll('.hm-card h2')].map((h) => h.textContent);
assert.equal(cards.length, 8, 'the glance card (with the latest feed items), highlights, library, two reading lists, the topics strip, and the quiz and gap cards that have something to say: ' + cards);
const brief = [...d.querySelectorAll('.hm-card')].find((c) => /Today at a glance/.test(c.textContent));
assert(brief, 'the feed briefing card is there');
const gridEl = d.getElementById('hmGrid');
assert(gridEl.classList.contains('has-glance') && !d.querySelector('.hm-col'), 'with the glance card the cards are placed in one four-column grid');
assert.deepEqual([...gridEl.children].map((c) => c.dataset.card), ['briefing', 'quote', 'stats', 'continue', 'recent', 'graph', 'quiz', 'gaps'], 'half for the glance card; highlights and library above, the two reading lists, the topics strip, then quiz and gaps');
assert(brief.querySelector('.hm-latest') && /Feed news/.test(brief.querySelector('.hm-latest').textContent), 'the latest feed items sit in the glance card');
assert(brief.querySelector('a.rc-cite') && brief.querySelector('a.rc-cite').href === 'https://f.com/n', 'its source chips open the feed item');
assert(/1 source/.test(brief.textContent) && /Feed news/.test(brief.querySelector('.hm-brief-src').textContent), 'the sources are listed');
assert(!brief.querySelector('.hm-brief-seg'), 'no Sections / Headlines switch: the briefing is always the full one');
assert(/Quote from the user highlights/.test(d.getElementById('hmGrid').textContent), 'a saved highlight is shown as the quote');
assert(/Half read/.test([...d.querySelectorAll('.hm-card')].find((c) => /Continue reading/.test(c.textContent)).textContent), 'continue reading lists the started article');
assert(/Feed news/.test(d.getElementById('hmGrid').textContent), 'feed item shown');
assert([...d.querySelectorAll('.hm-link')].some((a) => a.href.includes('readerPage.html#id=')), 'saved articles open in the reading view');
const box = d.querySelectorAll('#hmCustom input')[1]; box.checked = false; box.dispatchEvent(new w.Event('change', { bubbles: true })); await tick(50);
assert.equal(d.querySelectorAll('.hm-card').length, 7, 'a card can be hidden');
assert.deepEqual(store['home:prefs'].hidden, ['quote'], 'and the choice is remembered');
assert(d.querySelector('#hmBox .hm-key'), 'the command that opens the search is shown inside the field');
const field = d.querySelector('#hmBox .cmdk-input'); assert(field, 'the search field is the command list, inline');
field.dispatchEvent(new w.Event('focus')); await tick(30);
assert(d.getElementById('hmBox').classList.contains('is-open') && d.getElementById('hmGrid').classList.contains('is-dim'), 'focus opens the list and dims the cards');
assert(/Continue/.test(d.querySelector('#hmBox .cmdk-list').textContent) && /Fresh from worker/.test(d.querySelector('#hmBox .cmdk-list').textContent), 'continue + new feed items are offered first');
field.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await tick(30);
assert(!d.getElementById('hmBox').classList.contains('is-open'), 'Esc closes it again');
// quizzes to repeat and topics started but never deepened: cards that appear only when there is something to say
assert(d.querySelector('[data-card="quiz"]') && d.querySelector('[data-card="gaps"]') && d.querySelector('[data-card="quiz"]').style.getPropertyValue('--hm-rows') && d.querySelector('[data-card="briefing"]').style.getPropertyValue('--hm-cols') === '2', 'quiz and gaps are cards with their rows; the glance card has two columns');
const quizCard = d.querySelector('[data-card="quiz"]'), gapCard = d.querySelector('[data-card="gaps"]');
assert(quizCard && /Heat pumps/.test(quizCard.textContent) && /2 questions to repeat/.test(quizCard.textContent), 'the due quiz, with what was missed: ' + (quizCard && quizCard.textContent));
assert(gapCard && /Solo topic/.test(gapCard.textContent) && /never opened/.test(gapCard.textContent), 'a topic that was started and never opened');
quizCard.querySelector('a.hm-link').click(); await tick(40);
assert(/#quiz=q1$/.test(d.querySelector('iframe.app-dock').src), 'the quiz opens in the app beside the page');
// the topics strip: bubbles for the biggest topics; a click opens the graph in the app beside the page
const topics = d.querySelector('[data-card="graph"]');
assert(topics && topics.querySelectorAll('circle').length >= 2 && /Energy/.test(topics.textContent), 'bubbles for the topics with at least two articles');
// a bubble opens History beside the page, searched for that topic
const bubble = topics.querySelector('.hm-bubble'); bubble.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await tick(60);
assert(/#history\/tag\/(Energy|AI)$/.test(d.querySelector('iframe.app-dock').src), 'a click on a topic filters History by that topic: ' + d.querySelector('iframe.app-dock').src);
assert.equal(bubble.getAttribute('role'), 'button'); assert.equal(bubble.getAttribute('tabindex'), '0');
const tt2 = hw.topTopics([{ tags: ['Tech', 'x'] }, { tags: ['Tech'] }], { tagId: (t) => t.toLowerCase(), tagLabel: (t) => 'Technik' });
assert.equal(tt2[0].raw, 'Tech', 'the tag as saved is kept for the search');
// every card's heading links to its section: the app opens beside the page on that screen
const links = [...d.querySelectorAll('.hm-card-link')];
assert(links.length >= 4, 'each card has a link to its section: ' + links.length);
const feedsLink = [...d.querySelectorAll('.hm-card')].find((c) => /Today at a glance/.test(c.textContent)).querySelector('.hm-card-link');
assert(/Feeds/.test(feedsLink.textContent)); feedsLink.click(); await tick(60);
assert(/popup\.html\?surface=float.*#feeds$/.test(d.querySelector('iframe.app-dock').src), 'it opens the app on Feeds from the side');
// the library numbers lead to the stats (analytics report), not just to History
const lib = [...d.querySelectorAll('.hm-card')].find((c) => /Your library/.test(c.textContent)).querySelector('.hm-card-link');
assert(/Stats/.test(lib.textContent)); lib.click(); await tick(60);
assert(/#history\/stats$/.test(d.querySelector('iframe.app-dock').src), 'the app switches to History with the report: ' + d.querySelector('iframe.app-dock').src);
// Appearance on the home page: theme, colour scheme and text size, saved to the same settings as Settings › Appearance
d.getElementById('hmLook').click(); await tick(20);
const menu = d.getElementById('hmLookMenu');
assert(!menu.hidden && d.getElementById('hmLook').getAttribute('aria-expanded') === 'true', 'the appearance menu opens');
[...menu.querySelectorAll('button')].find((b) => b.textContent === 'Dark').click(); await tick(40);
assert.equal(d.documentElement.getAttribute('data-theme'), 'dark', 'the theme applies at once');
const saved = await new Promise((r) => chrome.storage.sync.get(['theme', 'textScale', 'colorScheme'], r));
assert.equal(saved.theme, 'dark', 'and is saved with the other appearance settings');
[...menu.querySelectorAll('button')].find((b) => b.textContent === 'A+').click(); await tick(40);
assert.equal(d.documentElement.style.getPropertyValue('--text-scale'), '1.1', 'text size steps by 10 %');
[...menu.querySelectorAll('button')].find((b) => b.textContent === 'Postil').click(); await tick(40);
assert.equal(d.documentElement.getAttribute('data-design'), 'postil', 'the design is its own switch');
const dots = [...menu.querySelectorAll('.a11y-seg--dots button')];
assert(dots.length === 5 && dots.every((b) => b.querySelector('.scheme-dot') && b.getAttribute('aria-label')), 'the colour schemes are dots, each with its name as the accessible name');
dots.find((b) => b.getAttribute('aria-label') === 'Viola').click(); await tick(40);
assert.equal(d.documentElement.getAttribute('data-scheme'), 'viola', 'colour scheme');
const saved3 = await new Promise((r) => chrome.storage.sync.get(['theme', 'design', 'colorScheme'], r));
assert.deepEqual(saved3, { theme: 'dark', design: 'postil', colorScheme: 'viola' }, 'all three axes are saved together');
d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick(20);
assert(d.getElementById('hmLookMenu').hidden, 'Esc closes the menu');
// infinite scroll: a long list shows a page, and the next one when the end is near
const { lazyList } = await imp('../src/modules/lazyList.js');
const sc = d.createElement('div'), ul2 = d.createElement('ul'); sc.append(ul2); d.body.append(sc);
Object.defineProperty(sc, 'clientHeight', { value: 100 }); Object.defineProperty(sc, 'scrollHeight', { get: () => 40 * ul2.children.length });
const L = lazyList(sc, ul2, Array.from({ length: 30 }, (_, i) => i), (n) => d.createTextNode('row ' + n), { size: 12, doc: d });
assert.equal(ul2.children.length, 12, 'the first page at once');
sc.scrollTop = 0; sc.dispatchEvent(new w.Event('scroll')); assert.equal(ul2.children.length, 12, 'not loaded while the end is far');
sc.scrollTop = 40 * 12 - 100 - 20; sc.dispatchEvent(new w.Event('scroll')); assert(ul2.children.length > 12, 'the next page when the end is near: ' + ul2.children.length);
for (let i = 0; i < 5; i++) { sc.scrollTop = 1e6; sc.dispatchEvent(new w.Event('scroll')); }
assert.equal(ul2.children.length, 30, 'all of it in the end, never more'); assert(!L.pager.more());
// an old briefing (> 1 hour) has a quiet update button that opens Feeds on that day's recap
const refresh = d.querySelector('.hm-refresh');
assert(refresh && refresh.getAttribute('aria-label') === 'Update briefing', 'the briefing is 3 hours old: an update button sits next to the time');
refresh.click(); await tick(60);
assert(/#feeds\/recap\/1$/.test(d.querySelector('iframe.app-dock').src), 'it opens the app on Feeds with that day\'s briefing: ' + d.querySelector('iframe.app-dock').src);
// the rail (Feeds, History, Notes) on the edge pops the app open on that screen; the same one again closes it; Settings is in the header
{
  const rail = [...d.querySelectorAll('.hm-rail .hm-rail-btn')]; assert.deepEqual(rail.map((b) => b.dataset.screen), ['feeds', 'history', 'notes']);
  assert(d.querySelector('.hm-appbar [data-screen="settings"]') && !d.querySelector('.hm-appbar [data-screen="feeds"]'), 'Settings sits in the header; the three screens in the rail');
  const feedsBtn = rail[0]; feedsBtn.click(); await tick(60);
  assert(/#feeds$/.test(d.querySelector('iframe.app-dock').src) && feedsBtn.getAttribute('aria-pressed') === 'true', 'a rail button opens its screen and shows as pressed');
  rail[2].click(); await tick(60);
  assert(/#notes$/.test(d.querySelector('iframe.app-dock').src) && rail[2].getAttribute('aria-pressed') === 'true' && feedsBtn.getAttribute('aria-pressed') === 'false', 'another one switches the screen');
  rail[2].click(); await tick(600);
  assert(!d.querySelector('iframe.app-dock') && rail.every((b) => b.getAttribute('aria-pressed') === 'false'), 'the same one again closes the app');
}
// the library numbers sit above their labels (labels wrap differently, the numbers stay in one line)
{
  const css = fs.readFileSync(new URL('../src/home.css', import.meta.url), 'utf8');
  assert(/\.hm-stats dd \{ order: 0;/.test(css) && /\.hm-stats dt \{ order: 1;/.test(css), 'the value is shown before its label');
  const g = d.querySelector('.hm-stats > div'); assert(g.firstChild.tagName === 'DT' && g.lastChild.tagName === 'DD', 'label then value in the markup');
}
// a click on a topic bubble leaves no focus square; the keyboard gets a ring on the blob (also in High contrast)
{
  const css = fs.readFileSync(new URL('../src/home.css', import.meta.url), 'utf8');
  assert(/\.hm-bubble:focus \{ outline: none; \}/.test(css) && /\.hm-bubble:focus-visible circle \{ stroke: var\(--focus-ring\)/.test(css), 'no outline on click, a ring on keyboard focus');
  assert(/data-design='contrast'\] \.hm-bubble:focus-visible circle/.test(css), 'the ring wins over the High contrast outline');
}
// the latest feed items show a subtle time next to their source
{
  const first = d.querySelector('.hm-latest .hm-link .hm-link-sub'); assert(first && first.querySelector('.hm-link-when'), 'a feed item has a time next to its source');
  assert(/^· /.test(first.querySelector('.hm-link-when').textContent) && /\d|min|std|h/i.test(first.querySelector('.hm-link-when').textContent), 'it reads as a short time: ' + first.textContent);
}
// "Adjust" at the top right opens the card choices in a small menu (they are no longer a line at the foot of the page)
{
  const btn = d.getElementById('hmAdjust'), menu = d.getElementById('hmAdjustMenu');
  assert(btn && btn.closest('.hm-appbar') && !d.querySelector('.hm-custom'), 'the adjust button is in the header, the old line is gone');
  assert(menu.hidden && btn.getAttribute('aria-expanded') === 'false', 'closed at first');
  btn.click(); await tick(30);
  assert(!menu.hidden && btn.getAttribute('aria-expanded') === 'true' && menu.querySelectorAll('input[type=checkbox]').length === 8, 'it opens with one checkbox per card');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick(30);
  assert(menu.hidden, 'Escape closes it');
}
// calm: the cards rise in one after the other (fade, short rise, blur), and the glance card does not pulse while the feeds refresh
{
  const css = fs.readFileSync(new URL('../src/home.css', import.meta.url), 'utf8');
  assert(/\.hm-enter \{ animation: hmRise var\(--duration-reveal\)/.test(css) && /@keyframes hmRise/.test(css), 'a calm entrance');
  assert(!/data-working/.test(css) && !/pillGlow/.test(css), 'no pulsing while the feeds refresh');
}
// arranging: the arrows in the Adjust menu and dragging a card by its heading change the order, and it is saved
{
  const order = () => [...d.querySelectorAll('#hmGrid [data-card]')].sort((a, b) => Number(a.style.order) - Number(b.style.order)).map((c) => c.dataset.card);
  const before = order(); assert.equal(before[0], 'briefing');
  d.getElementById('hmAdjust').click(); await tick(30);
  const rows = [...d.querySelectorAll('#hmCustom .hm-adjust-row')];
  assert.equal(rows[0].querySelectorAll('.hm-adjust-move').length, 4, 'every card has shorter, taller, up, down (the glance card too)'); assert(rows[0].querySelectorAll('.hm-adjust-move')[2].disabled, 'the first one cannot go up');
  const statsRow = rows[WIDGETS_ORDER.indexOf('stats')]; const down = statsRow.querySelectorAll('.hm-adjust-move')[3];
  down.click(); await tick(60);
  const after = order(); assert(after.indexOf('stats') > before.indexOf('stats'), 'the arrow moved the card down: ' + before + ' → ' + after);
  assert(Array.isArray(store['home:prefs'].order) && store['home:prefs'].order.indexOf('stats') > store['home:prefs'].order.indexOf('continue'), 'the order is saved with the preferences: ' + JSON.stringify(store['home:prefs']));
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick(30);
  // dragging: the Recently saved card by its heading onto the first small card
  const cardOf = (id) => d.querySelector('#hmGrid [data-card="' + id + '"]');
  const mover = cardOf('recent'), target = cardOf(order().filter((x) => x !== 'briefing')[0]);
  const ev = (type, el) => el.dispatchEvent(new w.Event(type, { bubbles: true, cancelable: true }));
  const startRank = order().indexOf('recent');
  mover.querySelector('.hm-card-head').dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, button: 0 }));
  assert(mover.draggable, 'a press on the heading makes the card draggable');
  ev('dragstart', mover); ev('dragenter', target); await tick(10);
  assert(order().indexOf('recent') < startRank, 'dragging over another card moves it live: ' + order());
  ev('dragend', mover); await tick(60);
  assert(store['home:prefs'].order.length >= 7, 'the dragged order is saved');
}
// font: serif (the default) or sans-serif, in the Appearance menu; saved with the other appearance keys, applied to <html>
{
  d.getElementById('hmLook').click(); await tick(30);
  const menu = d.getElementById('hmLookMenu'), rows = [...menu.querySelectorAll('.hm-look-row')];
  const fontRow = rows.find((r) => /^Font/.test(r.querySelector('.hm-look-label-row').textContent)); assert(fontRow, 'a Font row in the Appearance menu');
  const [serif, sans] = [...fontRow.querySelectorAll('button')]; assert.equal(serif.getAttribute('aria-pressed'), 'true', 'serif is the default');
  sans.click(); await tick(60);
  assert.equal(d.documentElement.getAttribute('data-fontstyle'), 'sans'); assert.equal(store.fontStyle, 'sans', 'saved');
  [...d.getElementById('hmLookMenu').querySelectorAll('.hm-look-row')].find((r) => /^Font/.test(r.querySelector('.hm-look-label-row').textContent)).querySelectorAll('button')[0].click(); await tick(60);
  assert(!d.documentElement.hasAttribute('data-fontstyle'), 'back to serif');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick(30);
}
// the topics card's light is under the other cards and their text
{
  const css = fs.readFileSync(new URL('../src/home.css', import.meta.url), 'utf8');
  assert(/\.hm-card \{ position: relative; z-index: 1; \}/.test(css) && /\.hm-card--art \{ z-index: 0; \}/.test(css) && !/\.hm-card--art \{ z-index: 1; \}/.test(css), 'the other cards are above the topics card');
}
// height: the + and - in the Adjust menu make a card taller or shorter by whole rows (and it is saved); the strip at the bottom edge is there too
{
  const card = d.querySelector('#hmGrid [data-card="graph"]'); const rowsNow = () => Number(card.style.getPropertyValue('--hm-rows'));
  const startRows = rowsNow(); assert(startRows >= 1 && card.querySelector('.hm-resize'), 'a card has its rows and a resize strip');
  d.getElementById('hmAdjust').click(); await tick(30);
  const gRow = [...d.querySelectorAll('#hmCustom .hm-adjust-row')].find((r) => /Your topics/.test(r.textContent)); const [shorter, taller] = gRow.querySelectorAll('.hm-adjust-move');
  taller.click(); await tick(40); assert.equal(rowsNow(), startRows + 1, 'taller: one row more');
  assert.equal(store['home:prefs'].sizes.graph, startRows + 1, 'saved with the preferences');
  const gRow2 = [...d.querySelectorAll('#hmCustom .hm-adjust-row')].find((r) => /Your topics/.test(r.textContent)); gRow2.querySelectorAll('.hm-adjust-move')[0].click(); await tick(40);
  assert.equal(rowsNow(), startRows, 'shorter: back');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick(30);
}
// layout: a card's column placement for wide pages must come BEFORE the container queries that change it for narrower ones (a later rule wins over them:
// the topics strip once kept "columns 3-4" on a medium page and broke the grid into uneven implicit columns)
{
  const css = fs.readFileSync(new URL('../src/home.css', import.meta.url), 'utf8');
  const medium = css.indexOf('@container hmwrap (max-width: 1100px)');
  for (const rule of ['> [data-card] { grid-column: span var(--hm-cols, 1); grid-row: span var(--hm-rows, 3);']) assert(css.indexOf(rule) > 0 && css.indexOf(rule) < medium, rule + ' comes before the container queries');
}
console.log('TEST 271 OK'); process.exit(0);
