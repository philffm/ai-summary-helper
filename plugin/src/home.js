// Home page: opened from Settings › Appearance or the ⌘K palette ("Home page"). It only reads what the library already holds;
// every card is a plain list of links, and the user chooses which cards show (remembered on this device).
import { bootPage } from './modules/pageBoot.js';
import { T } from './modules/feedI18n.js';
import StorageManager from './modules/storageManager.js';
import { SK } from './modules/storageKeys.js';
import { bgMessage } from './modules/bgMessage.js';
import { continueReading, recentlySaved, latestFeed, mergeFeed, libraryStats, visibleWidgets, WIDGETS, greetingKey } from './modules/homeWidgets.js';
import { mountCommandList } from './modules/commandPalette.js';
import { externalCommands, externalArticleSearch } from './modules/paletteExternal.js';

const PREFS_KEY = 'home:prefs';
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const readerUrl = (a) => chrome.runtime.getURL('readerPage.html') + '#id=' + encodeURIComponent(a.id);
const appUrl = (name) => chrome.runtime.getURL('popup.html') + '#' + name;
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return ''; } };

function link(href, title, sub, progress) {
  const a = el('a', 'hm-link'); a.href = href; a.target = '_blank'; a.rel = 'noopener';
  a.append(el('span', 'hm-link-title', title));
  if (sub) a.append(el('span', 'hm-link-sub', sub));
  if (progress > 0) { const bar = el('span', 'hm-bar'); const i = el('i'); i.style.width = Math.round(progress * 100) + '%'; bar.append(i); a.append(bar); }
  return a;
}
function card(title, body) { const c = el('section', 'hm-card'); c.append(el('h2', '', title), body); return c; }
function listOf(rows, emptyText) {
  if (!rows.length) return el('p', 'hm-empty', emptyText);
  const ul = el('ul', 'hm-list'); rows.forEach((r) => { const li = el('li'); li.append(r); ul.append(li); }); return ul;
}

const builders = {
  continue: (d) => card(T('Continue reading'), listOf(continueReading(d.index, 4).map((a) => link(readerUrl(a), a.title || a.url, hostOf(a.url), a.progress)), T('Nothing in progress. Articles you start reading show up here.'))),
  recent: (d) => card(T('Recently saved'), listOf(recentlySaved(d.index, 4).map((a) => link(readerUrl(a), a.title || a.url, hostOf(a.url))), T('Your saved articles show up here.'))),
  feeds: (d) => card(T('Latest from your feeds'), listOf(latestFeed(d.feed, 4).map((i) => link(i.link, i.title, i.feedTitle || i.source || hostOf(i.link))), T('Subscribe to feeds to see new items here.'))),
  stats: (d) => {
    const s = libraryStats(d.index), dl = el('dl', 'hm-stats');
    [[T('Saved'), s.total], [T('Unread'), s.unread], [T('Starred'), s.starred], [T('Finished this week'), s.finishedThisWeek]].forEach(([k, v]) => { const g = el('div'); g.append(el('dt', '', k), el('dd', '', String(v))); dl.append(g); });
    return card(T('Your library'), dl);
  },
  goto: () => {
    const row = el('div', 'hm-goto');
    [['main', T('Summary')], ['feeds', T('Feeds')], ['history', T('History')], ['notes', T('Notes')], ['settings', T('Settings')]].forEach(([n, label]) => {
      const a = el('a', 'button-secondary btn-sm', label); a.href = appUrl(n); a.target = '_blank'; a.rel = 'noopener'; row.append(a);
    });
    return card(T('Open the app'), row);
  },
};
const LABELS = { continue: 'Continue reading', recent: 'Recently saved', feeds: 'Latest from your feeds', stats: 'Your library', goto: 'Open the app' };

let hidden = [], data = { index: [], feed: [] };
function render() {
  const grid = $('hmGrid'); grid.textContent = '';
  visibleWidgets(hidden).forEach((w) => grid.append(builders[w](data)));
  const box = $('hmCustom'); box.textContent = '';
  WIDGETS.forEach((w) => {
    const lab = el('label'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = !hidden.includes(w);
    cb.addEventListener('change', () => { hidden = cb.checked ? hidden.filter((x) => x !== w) : [...hidden, w]; try { chrome.storage.local.set({ [PREFS_KEY]: { hidden } }); } catch (_) { /* optional */ } render(); });
    lab.append(cb, document.createTextNode(T(LABELS[w]))); box.append(lab);
  });
}

async function init() {
  await bootPage();
  const hour = new Date().getHours();
  $('hmGreeting').textContent = { night: T('Good night'), morning: T('Good morning'), afternoon: T('Good afternoon'), evening: T('Good evening') }[greetingKey(hour)];
  bindSearchKeys();
  await loadData();
  render(); mountSearch();
  refreshFeeds();
}

// The search field is the command list inline (commandPalette.js): what to continue, what is new, where to go, and a search of saved articles.
let search = null;
function homeCommands() {
  const cont = continueReading(data.index).map((a) => ({ id: 'c:' + a.id, group: T('Continue'), title: a.title || a.url, sub: Math.round((a.progress || 0) * 100) ? Math.round(a.progress * 100) + '% · ' + hostOf(a.url) : hostOf(a.url), run: () => window.open(readerUrl(a), '_blank') }));
  const fresh = latestFeed(data.feed, 4).map((i) => ({ id: 'f:' + (i.id || i.link), group: T('New in your feeds'), title: i.title, sub: i.feedTitle || i.source || hostOf(i.link), run: () => window.open(i.link, '_blank') }));
  return [...cont, ...fresh, ...externalCommands({ home: false })];
}
function mountSearch() {
  const box = $('hmBox'); if (search) search.destroy(); box.textContent = '';
  const keep = search && search.input.value, hadFocus = search && document.activeElement === search.input;
  const setOpen = (on) => { box.classList.toggle('is-open', on); $('hmGrid').classList.toggle('is-dim', on); search.input.setAttribute('aria-expanded', String(on)); };
  const collapse = () => { search.input.value = ''; search.update(); setOpen(false); search.input.blur(); };
  search = mountCommandList(box, { getCommands: homeCommands, findMore: externalArticleSearch((a) => window.open(readerUrl(a), '_blank')), onRun: collapse, onEscape: collapse, expanded: false });
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

// Library and feed list as stored; the worker's newest finds (feeds:background) count too
async function loadData() {
  try {
    const got = await chrome.storage.local.get({ [PREFS_KEY]: {}, [SK.feedItems]: [], [SK.feedBackground]: {} });
    hidden = Array.isArray(got[PREFS_KEY].hidden) ? got[PREFS_KEY].hidden : [];
    data.feed = mergeFeed(got[SK.feedItems], (got[SK.feedBackground] || {}).items);
    data.index = await StorageManager.getArticlesIndex();
  } catch (_) { /* empty cards explain themselves */ }
}

// Opening the home page also refreshes the feeds that are due (the worker keeps each feed's own schedule and the user's
// "background polling" choice), then redraws when something new came in. The page never waits for it.
async function refreshFeeds() {
  const status = $('hmStatus'); status.textContent = T('Updating feeds…'); status.hidden = false;
  const before = data.feed.length;
  const r = await bgMessage({ action: 'feedPollNow' }, { timeout: 90000 });
  if (r && r.ok) { await loadData(); if (data.feed.length !== before) { render(); mountSearch(); } }
  status.hidden = true;
}
init();
