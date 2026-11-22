// Home page: opened from Settings › Appearance or the ⌘K palette ("Home page"). It only reads what the library already holds;
// every card is a plain list of links, and the user chooses which cards show (remembered on this device).
import { bootPage } from './modules/pageBoot.js';
import { T, TN } from './modules/feedI18n.js';
import StorageManager from './modules/storageManager.js';
import { SK, hlPageKey } from './modules/storageKeys.js';
import { bgMessage } from './modules/bgMessage.js';
import { normalizeHighlights } from './modules/highlightRecords.js';
import { renderInline, renderAnswer } from './modules/qaView.js';
import { chipCites, citedSources } from './modules/recapCites.js';
import { latestBriefing, continueReading, recentlySaved, latestFeed, mergeFeed, pickQuote, libraryStats, visibleWidgets, WIDGETS, greetingKey } from './modules/homeWidgets.js';
import { createAppDock } from './modules/appDock.js';
import { mountCommandList } from './modules/commandPalette.js';
import { externalCommands, externalArticleSearch } from './modules/paletteExternal.js';

const PREFS_KEY = 'home:prefs';
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const readerUrl = (a) => chrome.runtime.getURL('readerPage.html') + '#id=' + encodeURIComponent(a.id);
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return ''; } };

function link(href, title, sub, progress) {
  const a = el('a', 'hm-link'); a.href = href; a.target = '_blank'; a.rel = 'noopener';
  a.append(el('span', 'hm-link-title', title));
  if (sub) a.append(el('span', 'hm-link-sub', sub));
  if (progress > 0) { const bar = el('span', 'hm-bar'); const i = el('i'); i.style.width = Math.round(progress * 100) + '%'; bar.append(i); a.append(bar); }
  return a;
}
// A card's heading links to its section: the app opens beside the page on that screen (dock.open)
function card(title, body, screen = '') {
  const c = el('section', 'hm-card'), h = el('div', 'hm-card-head');
  h.append(el('h2', '', title));
  if (screen) { const a = el('button', 'hm-card-link'); a.type = 'button'; a.setAttribute('aria-label', T('Open {name}', { name: SECTION()[screen] })); a.title = a.getAttribute('aria-label'); a.append(document.createTextNode(SECTION()[screen]), el('span', '', ' →')); a.addEventListener('click', () => dock && dock.open(screen)); h.append(a); }
  c.append(h, body); return c;
}
const SECTION = () => ({ feeds: T('Feeds'), history: T('History'), notes: T('Notes'), 'history/stats': T('Stats') });
function listOf(rows, emptyText) {
  if (!rows.length) return el('p', 'hm-empty', emptyText);
  const ul = el('ul', 'hm-list'); rows.forEach((r) => { const li = el('li'); li.append(r); ul.append(li); }); return ul;
}

function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60000), rtf = new Intl.RelativeTimeFormat(document.documentElement.lang || undefined, { numeric: 'auto' });
  return m < 60 ? rtf.format(-Math.max(1, m), 'minute') : m < 1440 ? rtf.format(-Math.round(m / 60), 'hour') : rtf.format(-Math.round(m / 1440), 'day');
}
const MOOD = () => ({ pos: T('Mostly positive'), neu: T('Mixed'), neg: T('Mostly heavy') });

// "Today at a glance": the feed briefing (with the numbered sources the model cited as chips, recapCites.js) takes two thirds of the card,
// the latest feed items the last third. The refresh that starts with the page reports in the latest pane.
function briefingCard(d) {
  const found = latestBriefing(d.recaps), byId = new Map(d.feed.map((i) => [i.id, i]));
  const r = found && found.recap;
  const body = el('div', 'hm-glance');
  const meta = el('div', 'hm-brief-meta');
  if (r) {
    if (r.n) meta.append(el('span', '', TN(r.n, '{n} item', '{n} items')));
    if (r.at) meta.append(el('span', '', T('Updated {when}', { when: ago(r.at) })));
    meta.append(el('span', 'hm-mood', MOOD()[r.mood] || MOOD().neu));
  }
  const text = el('div', 'hm-brief-text');
  if (!r) text.append(el('p', 'hm-empty', T('Write a recap in Feeds and it shows up here, with its sources.')));
  else {
    if (r.overview) { const ov = el('div', 'md-body'); renderAnswer(ov, r.overview); text.append(ov); }
    if ((r.themes || []).length) { const ul = el('ul', 'hm-brief-list'); r.themes.forEach((t) => { const li = el('li'); renderInline(li, t); ul.append(li); }); text.append(ul); }
    chipCites(text, r, byId);
    const src = citedSources(r, byId);
    if (src.length) {
      const det = el('details', 'hm-brief-src'); det.append(el('summary', '', TN(src.length, '{n} source', '{n} sources')));
      const ol = el('ol'); src.forEach(({ n, item }) => { const li = el('li'); li.value = n; const a = el('a', '', item.title || item.link); a.href = item.link; a.target = '_blank'; a.rel = 'noopener noreferrer'; li.append(a); ol.append(li); });
      det.append(ol); text.append(det);
    }
  }
  const latest = el('aside', 'hm-latest'); latest.setAttribute('aria-label', T('Latest from your feeds'));
  const lh = el('div', 'hm-latest-head'); lh.append(el('h3', '', T('Latest')));
  if (d.updating) { const u = el('span', 'hm-updating', T('Updating feeds…')); u.setAttribute('role', 'status'); lh.append(u); }
  latest.append(lh, listOf(latestFeed(d.feed, 12).map((i) => link(i.link, i.title, i.feedTitle || i.source || hostOf(i.link))), T('Subscribe to feeds to see new items here.')));
  body.append(meta, el('div', 'hm-brief-body'));
  body.lastChild.append(text, latest);
  return card(T('Today at a glance'), body, 'feeds');
}

const builders = {
  briefing: (d) => briefingCard(d),
  continue: (d) => card(T('Continue reading'), listOf(continueReading(d.index, 3).map((a) => link(readerUrl(a), a.title || a.url, hostOf(a.url), a.progress)), T('Nothing in progress. Articles you start reading show up here.')), 'history'),
  recent: (d) => card(T('Recently saved'), listOf(recentlySaved(d.index, 3).map((a) => link(readerUrl(a), a.title || a.url, hostOf(a.url))), T('Your saved articles show up here.')), 'history'),
  quote: (d) => {
    const body = el('div');
    if (d.quote) {
      const q = el('blockquote', 'hm-quote', d.quote.text);
      const a = el('a', 'hm-link-sub hm-quote-src', hostOf(d.quote.url) || d.quote.url); a.href = d.quote.url; a.target = '_blank'; a.rel = 'noopener';
      const more = el('button', 'button-secondary btn-sm', T('Another')); more.type = 'button'; more.addEventListener('click', () => loadQuote());
      body.append(q, a, el('div', 'hm-quote-more')); body.lastChild.append(more);
    } else body.append(el('p', 'hm-empty', T('Highlights you save show up here, one at a time.')));
    return card(T('From your highlights'), body, 'notes');
  },
  stats: (d) => {
    const s = libraryStats(d.index), dl = el('dl', 'hm-stats');
    [[T('Saved'), s.total], [T('Unread'), s.unread], [T('Starred'), s.starred], [T('Finished this week'), s.finishedThisWeek]].forEach(([k, v]) => { const g = el('div'); g.append(el('dt', '', k), el('dd', '', String(v))); dl.append(g); });
    return card(T('Your library'), dl, 'history/stats');   // the numbers lead to the analytics report
  },
};
const LABELS = { briefing: 'Today at a glance', continue: 'Continue reading', recent: 'Recently saved', quote: 'From your highlights', stats: 'Your library' };

const dockPrefs = { dock: undefined };
let dock = null;
let hidden = [], data = { index: [], feed: [], quote: null, recaps: {}, updating: false };
// Two columns where the page is wide, one below that (the width of the page itself: with the app docked beside it, it is narrower)
const colCount = () => { const w = (document.querySelector('.hm-wrap') || {}).clientWidth || 0; return !w || w >= 760 ? 2 : 1; };
let lastCols = 0;
window.addEventListener('resize', () => { if (lastCols && !document.getElementById('hmGrid').classList.contains('has-glance') && colCount() !== lastCols) render(); });

function render() {
  const grid = $('hmGrid'); grid.textContent = '';
  // The glance card takes two thirds, the other cards stack in the last third; without it the cards share two columns (shortest first).
  // Narrow (CSS): one column, the cards in their own order.
  const shown = visibleWidgets(hidden), glance = shown.includes('briefing');
  grid.classList.toggle('has-glance', glance);
  const n = glance ? 2 : (colCount() >= 2 ? 2 : 1), cols = Array.from({ length: n }, () => el('div', 'hm-col')), height = Array(n).fill(0);
  grid.style.setProperty('--hm-cols', String(n));
  shown.forEach((w) => {
    const c = builders[w](data); c.style.order = String(WIDGETS.indexOf(w));
    const i = glance ? (w === 'briefing' ? 0 : 1) : height.indexOf(Math.min(...height));
    height[i] += 3; cols[i].append(c);
  });
  grid.append(...cols); lastCols = n;
  const box = $('hmCustom'); box.textContent = '';
  WIDGETS.forEach((w) => {
    const lab = el('label'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = !hidden.includes(w);
    cb.addEventListener('change', () => { hidden = cb.checked ? hidden.filter((x) => x !== w) : [...hidden, w]; try { chrome.storage.local.set({ [PREFS_KEY]: { hidden, dock: dockPrefs.dock, briefMode: undefined } }); } catch (_) { /* optional */ } render(); });
    lab.append(cb, document.createTextNode(T(LABELS[w]))); box.append(lab);
  });
}

async function init() {
  await bootPage();
  const hour = new Date().getHours();
  $('hmGreeting').textContent = { night: T('Good night'), morning: T('Good morning'), afternoon: T('Good afternoon'), evening: T('Good evening') }[greetingKey(hour)];
  bindSearchKeys();
  dock = createAppDock({ button: $('hmApp'), startScreen: 'history', labels: { open: T('Open app'), close: T('Close app') }, getWidth: () => dockPrefs.dock, saveWidth: (w) => { dockPrefs.dock = w; try { chrome.storage.local.set({ [PREFS_KEY]: { hidden, dock: w } }); } catch (_) { /* optional */ } } });
  document.querySelectorAll('.hm-appbar [data-screen]').forEach((b) => b.addEventListener('click', () => dock.open(b.dataset.screen)));
  await loadData();
  render(); mountSearch();
  loadQuote();
  refreshFeeds();
}

// The search field is the command list inline (commandPalette.js): what to continue, what is new, where to go, and a search of saved articles.
let search = null;
function homeCommands() {
  const cont = continueReading(data.index).map((a) => ({ id: 'c:' + a.id, group: T('Continue'), title: a.title || a.url, sub: Math.round((a.progress || 0) * 100) ? Math.round(a.progress * 100) + '% · ' + hostOf(a.url) : hostOf(a.url), run: () => window.open(readerUrl(a), '_blank') }));
  const fresh = latestFeed(data.feed, 4).map((i) => ({ id: 'f:' + (i.id || i.link), group: T('New in your feeds'), title: i.title, sub: i.feedTitle || i.source || hostOf(i.link), run: () => window.open(i.link, '_blank') }));
  return [...cont, ...fresh, ...externalCommands({ home: false, openScreen: (n) => dock.open(n) })];
}
function mountSearch() {
  const box = $('hmBox'); if (search) search.destroy(); box.textContent = '';
  const keep = search && search.input.value, hadFocus = search && document.activeElement === search.input;
  const setOpen = (on) => { box.classList.toggle('is-open', on); $('hmGrid').classList.toggle('is-dim', on); search.input.setAttribute('aria-expanded', String(on)); };
  const collapse = () => { search.input.value = ''; search.update(); setOpen(false); search.input.blur(); };
  search = mountCommandList(box, { getCommands: homeCommands, findMore: externalArticleSearch((a) => window.open(readerUrl(a), '_blank'), (msg) => { const st = $('hmStatus'); st.textContent = msg; st.hidden = false; }), onRun: collapse, onEscape: collapse, expanded: false });
  const key = document.createElement('kbd'); key.className = 'kbd-key hm-key'; key.setAttribute('aria-hidden', 'true'); key.textContent = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '') ? '⌘K' : 'Ctrl K'; box.append(key);
  search.input.addEventListener('focus', () => setOpen(true));
  box.addEventListener('focusout', (e) => { if (!box.contains(e.relatedTarget) && !search.input.value) setOpen(false); });
  if (keep) { search.input.value = keep; search.update(); }
  if (hadFocus) { search.focus(); setOpen(true); }
}
// ⌘K / Ctrl+K and "/" jump to the field
function bindSearchKeys() {
  const mac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '');
    if (((mac ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key || '').toLowerCase() === 'k') || (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey)) { e.preventDefault(); search && search.focus(); }
  });
}

// One random highlight: the page list is small (hl:index), and only the chosen page's record is read
async function loadQuote() {
  try {
    const idx = (await chrome.storage.local.get({ [SK.hlIndex]: [] }))[SK.hlIndex];
    data.quote = await pickQuote(idx, async (k) => normalizeHighlights((await chrome.storage.local.get(hlPageKey(k)))[hlPageKey(k)]));
  } catch (_) { data.quote = null; }
  render();
}

// Library and feed list as stored; the worker's newest finds (feeds:background) count too
async function loadData() {
  try {
    const got = await chrome.storage.local.get({ [PREFS_KEY]: {}, [SK.feedItems]: [], [SK.feedBackground]: {}, [SK.feedRecaps]: {} });
    hidden = Array.isArray(got[PREFS_KEY].hidden) ? got[PREFS_KEY].hidden : [];
    if (got[PREFS_KEY].dock) dockPrefs.dock = got[PREFS_KEY].dock;
    data.recaps = got[SK.feedRecaps] || {};
    data.feed = mergeFeed(got[SK.feedItems], (got[SK.feedBackground] || {}).items);
    data.index = await StorageManager.getArticlesIndex();
  } catch (_) { /* empty cards explain themselves */ }
}

// Opening the home page also refreshes the feeds that are due (the worker keeps each feed's own schedule and the user's
// "background polling" choice), then redraws when something new came in. The page never waits for it.
async function refreshFeeds() {
  const before = data.feed.length;
  data.updating = true; render();
  const r = await bgMessage({ action: 'feedPollNow' }, { timeout: 90000 });
  if (r && r.ok) await loadData();
  data.updating = false; render();
  if (data.feed.length !== before) mountSearch();   // the list in the search has the new items too
}
init();
