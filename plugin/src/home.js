// Home page: opened from Settings › Appearance or the ⌘K palette ("Home page"). It only reads what the library already holds;
// every card is a plain list of links, and the user chooses which cards show (remembered on this device).
import { bootPage } from './modules/pageBoot.js';
import { iconEl } from './modules/icons.js';
import { applyA11y, SCHEMES, DESIGNS, normalizeAppearance, clampScale, TEXT_SCALE_MIN, TEXT_SCALE_MAX } from './modules/a11y.js';
import { T, TN } from './modules/feedI18n.js';
import StorageManager from './modules/storageManager.js';
import { SK, hlPageKey, QUIZ_REC } from './modules/storageKeys.js';
import { bgMessage } from './modules/bgMessage.js';
import { normalizeHighlights } from './modules/highlightRecords.js';
import { renderInline, renderAnswer } from './modules/qaView.js';
import { chipCites, citedSources } from './modules/recapCites.js';
import { lazyList } from './modules/lazyList.js';
import { findGaps } from './modules/graphGaps.js';
import { dueQuizzes, latestBriefing, continueReading, recentlySaved, latestFeed, mergeFeed, pickQuote, libraryStats, visibleWidgets, WIDGETS, greetingKey } from './modules/homeWidgets.js';
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
const SECTION = () => ({ feeds: T('Feeds'), history: T('History'), notes: T('Notes'), settings: T('Settings'), 'history/stats': T('Stats') });
const fillers = [];   // one per lazy list: top up the lists that are taller than their first page
const fillLists = () => (window.requestAnimationFrame || setTimeout)(() => fillers.forEach((f) => f()));

const lazy = (scroller, ul, items, build) => { const l = lazyList(scroller, ul, items, build); fillers.push(l.fill); return l; };   // rows loaded later fade in (.lazy-in)

function listOf(rows, emptyText) {
  if (!rows.length) return el('p', 'hm-empty', emptyText);
  const ul = el('ul', 'hm-list'); rows.forEach((r) => { const li = el('li'); li.append(r); ul.append(li); }); return ul;
}

// A number that counts up to its value (once, on the first render); nothing moves when motion is reduced
function countUp(node, to) {
  if (entered || !(to > 0) || document.documentElement.dataset.motion === 'reduce' || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  const raf = (f) => (window.requestAnimationFrame ? window.requestAnimationFrame(f) : setTimeout(() => f(performance.now()), 16));
  const t0 = performance.now(), dur = 700, step = (t) => { const k = Math.min(1, (t - t0) / dur); node.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf(step); };
  node.textContent = '0'; raf(step);
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
    { const t0 = new Date(); t0.setHours(0, 0, 0, 0);   // a briefing of an earlier day says which day it is
      if (found.day && found.day !== t0.getTime()) meta.append(el('span', '', new Date(found.day).toLocaleDateString(document.documentElement.lang || undefined, { weekday: 'long', day: 'numeric', month: 'short' }))); }
    if (r.at) meta.append(el('span', '', T('Updated {when}', { when: ago(r.at) })));
    // older than an hour: a quiet button next to the time. It opens the app on Feeds, where the briefing is refreshed (the previous recap plus what is new)
    if (r.at && Date.now() - r.at > 3600 * 1000) {
      const day = found.day;
      const b = el('button', 'hm-refresh'); b.type = 'button'; b.append(iconEl('refresh-cw', 'icon--sm')); b.title = T('Update briefing'); b.setAttribute('aria-label', T('Update briefing'));
      b.addEventListener('click', () => dock && dock.open('feeds/recap/' + day)); meta.append(b);
    }
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
  const feedItems = latestFeed(d.feed, 300), lul = el('ul', 'hm-list');
  latest.append(lh);
  if (!feedItems.length) latest.append(el('p', 'hm-empty', T('Subscribe to feeds to see new items here.')));
  else { latest.append(lul); lazy(lul, lul, feedItems, (i) => link(i.link, i.title, i.feedTitle || i.source || hostOf(i.link)), 12); }
  body.append(meta, el('div', 'hm-brief-body'));
  body.lastChild.append(text, latest);
  const c = card(T('Today at a glance'), body, 'feeds'); if (d.updating) c.dataset.working = '1';   // the card breathes while the feeds refresh
  return c;
}

// A card whose list fills the height the card has and loads further entries as it is scrolled
function lazyCard(title, items, build, emptyText, screen) {
  const body = el('div', 'hm-lazy-body');
  if (!items.length) body.append(el('p', 'hm-empty', emptyText));
  else { const ul = el('ul', 'hm-list'); body.append(ul); lazy(body, ul, items, build); }
  const c = card(title, body, screen); c.classList.add('hm-card--lazy'); return c;
}

// Quizzes to repeat and topics started but never deepened: shown only when there is something to say (see render)
const quizRow = (q) => {
  const a = el('a', 'hm-link'); a.href = chrome.runtime.getURL('popup.html') + '#quiz=' + encodeURIComponent(q.id); a.target = '_blank'; a.rel = 'noopener';
  a.append(el('span', 'hm-link-title', q.name || T('Quiz')), el('span', 'hm-link-sub', q.missed ? TN(q.missed, '{n} question to repeat', '{n} questions to repeat', { n: q.missed }) : TN(q.total, '{n} question', '{n} questions', { n: q.total })));
  a.addEventListener('click', (e) => { e.preventDefault(); if (dock) dock.open('quiz=' + encodeURIComponent(q.id)); });
  return a;
};
const gapRow = (g) => {
  const first = g.articles[0];
  return link(first ? readerUrl(first) : '#', g.label, g.never ? TN(g.articles.length, '{n} article, never opened', '{n} articles, never opened', { n: g.articles.length }) : TN(g.articles.length, '{n} article, untouched for a while', '{n} articles, untouched for a while', { n: g.articles.length }));
};

const builders = {
  quiz: (d) => card(T('Time to repeat'), listOf(dueQuizzes(d.quizzes).slice(0, 3).map(quizRow), ''), 'history'),
  gaps: (d) => card(T('Started, never deepened'), listOf(d.gaps.slice(0, 3).map(gapRow), ''), 'history'),
  briefing: (d) => briefingCard(d),
  continue: (d) => lazyCard(T('Continue reading'), continueReading(d.index, 400), (a) => link(readerUrl(a), a.title || a.url, hostOf(a.url), a.progress), T('Nothing in progress. Articles you start reading show up here.'), 'history'),
  recent: (d) => lazyCard(T('Recently saved'), recentlySaved(d.index, 400), (a) => link(readerUrl(a), a.title || a.url, hostOf(a.url)), T('Your saved articles show up here.'), 'history'),
  quote: (d) => {
    const body = el('div');
    if (d.quote) {
      const q = el('blockquote', 'hm-quote', d.quote.text);
      const a = el('a', 'hm-link-sub hm-quote-src', hostOf(d.quote.url) || d.quote.url); a.href = d.quote.url; a.target = '_blank'; a.rel = 'noopener';
      if (d.quoteFresh) { q.classList.add('hm-pop'); d.quoteFresh = false; }
      const more = el('button', 'button-secondary btn-sm', T('Another')); more.type = 'button'; more.addEventListener('click', () => { data.quoteFresh = true; loadQuote(); });
      body.append(q, a, el('div', 'hm-quote-more')); body.lastChild.append(more);
    } else body.append(el('p', 'hm-empty', T('Highlights you save show up here, one at a time.')));
    return card(T('From your highlights'), body, 'notes');
  },
  stats: (d) => {
    const s = libraryStats(d.index), dl = el('dl', 'hm-stats');
    [[T('Saved articles'), s.total], [T('Unread'), s.unread], [T('Starred'), s.starred], [T('Finished this week'), s.finishedThisWeek]].forEach(([k, v]) => { const g = el('div'), dd = el('dd', '', String(v)); g.append(el('dt', '', k), dd); dl.append(g); countUp(dd, v); });
    return card(T('Your library'), dl, 'history/stats');   // the numbers lead to the analytics report
  },
};
const LABELS = { quiz: 'Time to repeat', gaps: 'Started, never deepened', briefing: 'Today at a glance', continue: 'Continue reading', recent: 'Recently saved', quote: 'From your highlights', stats: 'Your library' };

const dockPrefs = { dock: undefined };
let dock = null;
let hidden = [], data = { index: [], feed: [], quote: null, recaps: {}, updating: false, quizzes: [], gaps: [] };
// Two columns where the page is wide, one below that (the width of the page itself: with the app docked beside it, it is narrower)
const colCount = () => { const w = (document.querySelector('.hm-wrap') || {}).clientWidth || 0; return !w || w >= 760 ? 2 : 1; };
let lastCols = 0;
window.addEventListener('resize', () => { if (lastCols && !document.getElementById('hmGrid').classList.contains('has-glance') && colCount() !== lastCols) render(); });

const enter = (c, i) => { if (!entered) { c.classList.add('hm-enter'); c.style.setProperty('--i', String(i)); } };
let entered = false;   // the cards fly in once, on the first real render (later renders are updates: no replay)
function render() {
  const grid = $('hmGrid'); grid.textContent = ''; grid.removeAttribute('aria-busy'); fillers.length = 0;
  // With the glance card: a four-column grid. The glance card takes half (two columns, both rows), the other four cards a quarter each
  // beside it (Continue reading, Recently saved / Notes, Library). Without it the cards share two columns, shortest first.
  // Narrow (CSS): two columns, then one.
  const shown = visibleWidgets(hidden).filter((w) => !(w === 'quiz' && !dueQuizzes(data.quizzes).length) && !(w === 'gaps' && !data.gaps.length)), glance = shown.includes('briefing');
  grid.classList.toggle('has-extra', glance && (shown.includes('quiz') || shown.includes('gaps')));
  grid.classList.toggle('has-glance', glance);
  if (glance) {
    shown.forEach((w, i) => { const c = builders[w](data); c.style.order = String(WIDGETS.indexOf(w)); c.dataset.card = w; enter(c, i); grid.append(c); });
    lastCols = 4; fillLists(); entered = true; return renderCustom();
  }
  const n = colCount() >= 2 ? 2 : 1, cols = Array.from({ length: n }, () => el('div', 'hm-col')), height = Array(n).fill(0);
  grid.style.setProperty('--hm-cols', String(n));
  shown.forEach((w) => {
    const c = builders[w](data); c.style.order = String(WIDGETS.indexOf(w)); c.dataset.card = w; enter(c, shown.indexOf(w));
    const i = height.indexOf(Math.min(...height));
    height[i] += 3; cols[i].append(c);
  });
  grid.append(...cols); lastCols = n; fillLists(); entered = true;
  renderCustom();
}

function renderCustom() {
  const box = $('hmCustom'); box.textContent = '';
  WIDGETS.forEach((w) => {
    const lab = el('label'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = !hidden.includes(w);
    cb.addEventListener('change', () => { hidden = cb.checked ? hidden.filter((x) => x !== w) : [...hidden, w]; try { chrome.storage.local.set({ [PREFS_KEY]: { hidden, dock: dockPrefs.dock, briefMode: undefined } }); } catch (_) { /* optional */ } render(); });
    lab.append(cb, document.createTextNode(T(LABELS[w]))); box.append(lab);
  });
}

// Appearance on the home page, the same settings as Settings › Appearance (theme, colour scheme, text size): changed here, saved there
function wireLook(initial) {
  const btn = $('hmLook'), menu = $('hmLookMenu'); if (!btn || !menu) return;
  const cfg = { ...initial, ...normalizeAppearance(initial) };   // older settings are read onto the three axes
  // all three axes are written together, so an older stored shape (theme "contrast", scheme "postil") cannot lose one when another changes
  const change = async (patch) => { Object.assign(cfg, patch); applyA11y(cfg); try { await StorageManager.set({ ...patch, theme: cfg.theme, design: cfg.design, colorScheme: cfg.colorScheme }); } catch (_) { /* this page keeps the look */ } paint(); };
  // dots: a round swatch per option instead of a word (the colour schemes); the name is the accessible name and the tooltip
  const seg = (label, key, options, current, dots = false) => {
    const wrap = el('div', 'hm-look-row'); wrap.append(el('span', 'hm-look-label-row', label));
    const g = el('div', 'a11y-seg ' + (dots ? 'a11y-seg--dots' : 'a11y-seg--hug a11y-seg--sm')); g.setAttribute('role', 'group'); g.setAttribute('aria-label', label);
    options.forEach(([value, text]) => {
      const b = el('button', '', dots ? '' : text); b.type = 'button'; b.setAttribute('aria-pressed', String(current === value));
      if (dots) { const d = el('span', 'scheme-dot'); d.dataset.swatch = value; b.append(d); b.setAttribute('aria-label', text); b.title = text; }
      b.addEventListener('click', () => change({ [key]: value })); g.append(b);
    });
    wrap.append(g); return wrap;
  };
  function paint() {
    const n = normalizeAppearance(cfg), scheme = n.colorScheme;
    const scale = clampScale(cfg.textScale || 100);
    menu.replaceChildren(
      seg(T('Brightness'), 'theme', [['system', T('Auto')], ['light', T('Light')], ['dark', T('Dark')]], n.theme),
      seg(T('Design'), 'design', [['standard', T('Standard')], ['postil', 'Postil'], ['contrast', T('High contrast')]], n.design),
      seg(T('Color scheme'), 'colorScheme', [['default', T('Default')], ['kaivo', 'Kaivo'], ['aish', 'Aish'], ['viola', 'Viola'], ['graphite', T('Graphite')]], scheme, true));
    const size = el('div', 'hm-look-row'); size.append(el('span', 'hm-look-label-row', T('Text size')));
    const ctl = el('div', 'hm-look-size');
    const step = (d, label, text) => { const b = el('button', 'button-secondary btn-sm', text); b.type = 'button'; b.setAttribute('aria-label', label); b.disabled = (d < 0 && scale <= TEXT_SCALE_MIN) || (d > 0 && scale >= TEXT_SCALE_MAX); b.addEventListener('click', () => change({ textScale: clampScale(scale + d) })); return b; };
    ctl.append(step(-10, T('Smaller text'), 'A−'), el('span', 'hm-look-value', scale + ' %'), step(10, T('Larger text'), 'A+'));
    size.append(ctl); menu.append(size);
  }
  const setOpen = (on) => { menu.hidden = !on; btn.setAttribute('aria-expanded', String(on)); if (on) paint(); };
  btn.addEventListener('click', () => setOpen(menu.hidden));
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { setOpen(false); btn.focus(); } });
}

// The first paint: placeholder cards in the final layout (the shimmering lines of skeleton.js), replaced by the real ones
function paintSkeleton() {
  const grid = $('hmGrid'); grid.classList.add('has-glance'); grid.setAttribute('aria-busy', 'true');
  WIDGETS.forEach((w) => {
    const c = el('section', 'hm-card skeleton-card'); c.dataset.card = w; c.setAttribute('aria-hidden', 'true');
    ['skeleton-line skeleton-title', 'skeleton-line', 'skeleton-line', 'skeleton-line skeleton-short'].forEach((cl) => c.append(el('div', cl)));
    grid.append(c);
  });
}

async function init() {
  paintSkeleton();
  const { appearance } = await bootPage();
  // the words that are written into home.html itself, in the user's language
  document.querySelectorAll('.hm-appbar [data-screen]').forEach((b) => { b.textContent = SECTION()[b.dataset.screen] || b.textContent; });
  { const l = document.querySelector('.hm-look-label'); if (l) l.textContent = T('Appearance'); const lk = $('hmLook'); if (lk) lk.title = T('Appearance'); const m = $('hmLookMenu'); if (m) m.setAttribute('aria-label', T('Appearance'));
    const ap = document.querySelector('#hmApp .dock-label'); if (ap) ap.textContent = T('Open app'); const sm = document.querySelector('.hm-custom summary'); if (sm) sm.textContent = T('Choose widgets');
    document.title = T('Home page'); const nav = document.querySelector('.hm-appbar'); if (nav) nav.setAttribute('aria-label', T('App')); }
  wireLook(appearance);
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
    data.gaps = findGaps(data.index, { cap: 6 });
    try {   // the saved quizzes (a handful of small records): the due ones become a card
      const keys = typeof chrome.storage.local.getKeys === 'function' ? (await chrome.storage.local.getKeys()).filter((k) => k.startsWith(QUIZ_REC)) : [];
      data.quizzes = keys.length ? Object.values(await chrome.storage.local.get(keys)) : [];
    } catch (_) { data.quizzes = []; }
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
