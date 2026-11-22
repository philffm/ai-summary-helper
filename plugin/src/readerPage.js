// Read mode page: opened in its own tab from an article's "Read" button (reader.html#id=<article id>).
// Shows the summary (with pinned questions) and the saved text with highlights, in a calm layout: text size, font,
// theme and width are the reader's choice and are remembered. Stored page HTML is untrusted — cleaned before display.
import { bootPage } from './modules/pageBoot.js';
import { T } from './modules/feedI18n.js';
import { escapeHtml, cleanUntrustedHtml, countWords } from './modules/textUtils.js';
import { withQuestions } from './modules/conversation.js';
import { fetchAnnotationsForArticle } from './modules/annotationExporter.js';
import StorageManager from './modules/storageManager.js';
import { SK } from './modules/storageKeys.js';
import { createSendTargets, loadSendPrefs } from './modules/sendSplit.js';
import { getReader, speechUnits, detectLang } from './modules/reader.js';
import { ttsLang } from './modules/languages.js';
import { createReadTracker } from './modules/readProgress.js';
import { bp } from './modules/breakpoints.js';
import { createHighlightStore } from './modules/highlightStore.js';
import { createReaderHighlights, selectionIn, paintAll } from './modules/readerHighlights.js';
import { blockAtTop, placeOfBlock, blockOfPlace } from './modules/readerBookmark.js';
import { createAppDock } from './modules/appDock.js';
import { openExternalPalette, bindPaletteKey } from './modules/paletteExternal.js';
import { browserBookmarksPossible, ensureBookmarksAccess, saveBrowserBookmark, hasBrowserBookmark } from './modules/browserBookmark.js';

const PREFS_KEY = 'reader:prefs';
const SIZES = [15, 17, 19, 21, 24, 28];
const DEFAULTS = { size: 2, font: 'serif', theme: 'auto', view: 'both' };
const root = document.documentElement;
const $ = (id) => document.getElementById(id);
let prefs = { ...DEFAULTS };
let appTheme = '';       // the app's own theme setting (Settings › Appearance): what "Auto" follows
let raw = null;          // the stored article as it is (the display copy carries the pinned questions)

const clean = (html) => {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  doc.querySelectorAll('img').forEach(el => { if (!el.getAttribute('src')) el.remove(); });
  return cleanUntrustedHtml(doc.body).innerHTML;
};

function applyPrefs() {
  prefs.size = Math.min(SIZES.length - 1, Math.max(0, Number(prefs.size) || 0));
  root.style.setProperty('--rp-size', SIZES[prefs.size] + 'px');
  root.style.setProperty('--rp-width', prefs.size >= 4 ? '46rem' : '40rem');
  // the plugin's tokens switch on data-theme: Light/Sepia are light, Dark is dark, Auto leaves it to the app setting / the system
  const tk = prefs.theme === 'dark' ? 'dark' : (prefs.theme === 'light' || prefs.theme === 'sepia') ? 'light' : appTheme;
  if (tk) root.setAttribute('data-theme', tk); else root.removeAttribute('data-theme');
  root.dataset.rpFont = prefs.font; root.dataset.rpTheme = prefs.theme; root.dataset.rpView = prefs.view;
  document.querySelectorAll('[data-font]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.font === prefs.font)));
  document.querySelectorAll('button[data-theme]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme === prefs.theme)));
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === prefs.view)));
  $('rpSmaller').disabled = prefs.size === 0; $('rpLarger').disabled = prefs.size === SIZES.length - 1;
}
const setPref = (patch) => { prefs = { ...prefs, ...patch }; applyPrefs(); try { chrome.storage.local.set({ [PREFS_KEY]: prefs }); } catch (_) { /* optional */ } };

// Toolbar buttons are icon + a label that is only shown where there is room: the full text is the tooltip and the accessible name
function setText(btn, full, shown) {
  if (!btn) return;
  const l = btn.querySelector('.rp-label'); if (l) l.textContent = shown || full;
  if (btn.classList.contains('rp-tool')) { btn.setAttribute('aria-label', full); btn.title = full; }
}
const setIcon = (btn, name) => { const u = btn && btn.querySelector('use'); if (u) u.setAttribute('href', '#i-' + name); };

// Menus (text & theme, more): one open at a time; Escape or a click elsewhere closes
function wireMenus() {
  const pairs = [['rpDisplayBtn', 'rpDisplayMenu'], ['rpThemeBtn', 'rpThemeMenu'], ['rpBookmarkBtn', 'rpBookmarkMenu'], ['rpMoreBtn', 'rpMoreMenu']].map(([b, m]) => [$(b), $(m)]);
  const closeAll = (except) => pairs.forEach(([b, m]) => { if (m !== except) { m.hidden = true; b.setAttribute('aria-expanded', 'false'); } });
  pairs.forEach(([b, m]) => b.addEventListener('click', (e) => { e.stopPropagation(); const open = m.hidden; closeAll(m); m.hidden = !open; b.setAttribute('aria-expanded', String(open)); }));
  document.addEventListener('click', (e) => { if (!e.target.closest('.rp-menu-wrap')) closeAll(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const open = pairs.find(([, m]) => !m.hidden); if (open) { closeAll(); open[0].focus(); } } });
  [$('rpMoreMenu'), $('rpBookmarkMenu')].forEach((m) => m.addEventListener('click', (e) => { if (e.target.closest('button')) closeAll(); }));
}

function labelControls() {
  $('rpSmaller').setAttribute('aria-label', T('Smaller text')); $('rpLarger').setAttribute('aria-label', T('Larger text'));
  $('rpFontGroup').setAttribute('aria-label', T('Font')); $('rpThemeGroup').setAttribute('aria-label', T('Theme')); $('rpViewGroup').setAttribute('aria-label', T('Show'));
  const names = { serif: T('Serif font'), sans: T('Sans-serif font') };
  document.querySelectorAll('[data-font]').forEach(b => b.setAttribute('aria-label', names[b.dataset.font]));
  const th = { auto: T('Auto'), light: T('Light'), sepia: T('Sepia'), dark: T('Dark') };
  document.querySelectorAll('button[data-theme]').forEach(b => { b.textContent = th[b.dataset.theme]; });
  const vw = { both: T('Both'), summary: T('Summary'), content: T('Full text') };
  document.querySelectorAll('[data-view]').forEach(b => { b.textContent = vw[b.dataset.view]; });
  setText($('rpPrint'), T('Print'));
  setText($('rpPalette'), T('Commands and search'));
  setText($('rpAskItem'), T('Ask about this article'));
  $('rpAskItem').addEventListener('click', () => { const m = $('rpMoreMenu'); if (m) m.hidden = true; toggleAsk(); });
  setText($('rpListen'), T('Read aloud'));
  setText($('rpApp'), T('Open app'), T('App'));
  setText($('rpMoreBtn'), T('More'));
  setText($('rpBookmarkBtn'), T('Bookmark'));
  $('rpBmJump').textContent = T('Jump to bookmark'); $('rpBmRemove').textContent = T('Remove place bookmark'); $('rpBmBrowser').textContent = T('Save in browser bookmarks');
  setText($('rpDisplayBtn'), T('Text and font'), 'Aa');
  setText($('rpThemeBtn'), T('Appearance'));
}

function wireControls() {
  $('rpSmaller').addEventListener('click', () => setPref({ size: prefs.size - 1 }));
  $('rpLarger').addEventListener('click', () => setPref({ size: prefs.size + 1 }));
  $('rpPrint').addEventListener('click', () => window.print());
  document.querySelectorAll('[data-font]').forEach(b => b.addEventListener('click', () => setPref({ font: b.dataset.font })));
  document.querySelectorAll('button[data-theme]').forEach(b => b.addEventListener('click', () => setPref({ theme: b.dataset.theme })));
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setPref({ view: b.dataset.view })));
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key === '+' || e.key === '=') setPref({ size: prefs.size + 1 });
    else if (e.key === '-') setPref({ size: prefs.size - 1 });
  });
  const bar = $('rpProgress').firstElementChild;
  const onScroll = () => {
    const max = root.scrollHeight - window.innerHeight;
    bar.style.width = (max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 0) + '%';
  };
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
}

function buildToc(page) {
  const heads = [...page.querySelectorAll('.rp-content h1, .rp-content h2:not(.rp-sec), .rp-content h3, .rp-content h4')]
    .filter(h => h.textContent.trim()).slice(0, 60);
  if (heads.length < 3) return null;
  const det = document.createElement('details'); det.className = 'rp-toc';
  const sum = document.createElement('summary'); sum.textContent = T('Contents'); det.append(sum);
  const ul = document.createElement('ul');
  heads.forEach((h, i) => {
    h.id = h.id || 'rp-h' + i;
    const li = document.createElement('li'); li.dataset.l = String(Math.min(4, Math.max(2, Number(h.tagName[1]))));
    const a = document.createElement('a'); a.href = '#' + h.id;
    // keep #id=<article> in the address bar: jump by script instead of changing the hash
    a.addEventListener('click', (e) => { e.preventDefault(); h.scrollIntoView(); });
    a.textContent = h.textContent.replace(/\s+/g, ' ').trim();
    li.append(a); ul.append(li);
  });
  det.append(ul);
  return det;
}

async function loadArticle(id) {
  const article = await StorageManager.getArticleFull(id);
  if (!article || (!article.content && !article.summary && !article.html && !article.text)) return null;
  raw = { ...article };
  const turns = await StorageManager.getConversation(id);
  if (turns.length) {
    let all = false;
    try { all = !!(await StorageManager.getLocal({ [SK.exportAllQuestions]: false }))[SK.exportAllQuestions]; } catch (_) { /* default */ }
    const base = article.summaryBase !== undefined ? article.summaryBase : article.summary;
    article.summary = withQuestions(base, turns, { all });
  }
  return article;
}

// The address carries what a browser bookmark of this page needs: id, the original url (a way out when the article is not in this
// library) and the bookmarked place (p). Cmd+D / the star in the address bar then keeps the position too.
const hashParams = () => new URLSearchParams(window.location.hash.slice(1));
function setHash(patch) {
  const p = hashParams();
  for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
  try { window.history.replaceState(null, '', '#' + p.toString()); } catch (_) { /* a page without history */ }
}

/** "#id=…&q=<sentence>" (the quiz's "Show in article"): mark the paragraph that holds the sentence and scroll to it. */
function revealQuoteFromHash() {
  const q = new URLSearchParams(window.location.hash.slice(1)).get('q');
  if (!q) return false;
  const norm = (t) => String(t || '').replace(/[‘’]/g, "'").replace(/[“”„]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
  const needle = norm(q);
  const blocks = [...document.querySelectorAll('.rp-content p, .rp-content li, .rp-content blockquote, .rp-content h2, .rp-content h3, .rp-summary p, .rp-summary li')];
  const hit = blocks.find((b) => norm(b.textContent).includes(needle)) || blocks.find((b) => needle.length > 40 && norm(b.textContent).includes(needle.slice(0, 40)));
  if (!hit) return false;
  hit.classList.add('rp-quote-hit');
  hit.tabIndex = -1;
  hit.scrollIntoView({ block: 'center' });
  hit.focus({ preventScroll: true });
  return true;
}

// ── Highlights: select text in the full text to add one, click a highlight to remove it ──
let hlList = [], hlPage = '', hl = null;
function wireHighlights() {
  if (hl || !hlPage || !/^https?:/i.test(hlPage)) return;
  hl = createReaderHighlights({ store: createHighlightStore({ storage: chrome.storage.local }), annotations: hlList, page: hlPage,
    tell: (m) => { try { const r = chrome.runtime.sendMessage(m); if (r && r.catch) r.catch(() => {}); } catch (_) { /* the worker restarts on the next event */ } } });
  const content = () => document.querySelector('.rp-content');
  const btn = $('rpHighlight');
  const pop = document.createElement('div');
  pop.className = 'rp-pop'; pop.setAttribute('role', 'toolbar'); pop.hidden = true;
  const act = document.createElement('button'); act.type = 'button'; act.className = 'button-primary btn-sm';
  pop.appendChild(act); document.body.appendChild(pop);
  let pending = null;   // { kind: 'add', range } | { kind: 'remove', n }
  const hide = () => { pop.hidden = true; pending = null; };
  const rectOf = (r) => (typeof r.getBoundingClientRect === 'function' ? r.getBoundingClientRect() : { left: 0, top: 0, width: 0, bottom: 0 });
  const place = (rect) => {
    pop.hidden = false;
    const w = pop.offsetWidth || 120;
    pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, rect.left + rect.width / 2 - w / 2)) + 'px';
    pop.style.top = Math.max(8, rect.top - pop.offsetHeight - 8 < 8 ? rect.bottom + 8 : rect.top - pop.offsetHeight - 8) + 'px';
  };
  const done = async (fn) => { try { await fn(); } catch (e) { toast(String((e && e.message) || e)); } hide(); window.getSelection().removeAllRanges(); updateSel(); };
  const doAdd = (range) => done(() => hl.add(content(), range));
  const doRemove = (n) => done(() => hl.remove(document, n));
  const updateSel = () => {
    const root = content(), range = root && selectionIn(root);
    if (btn) { btn.disabled = !range; btn.hidden = false; }
    if (range) { pending = { kind: 'add', range: range.cloneRange() }; act.textContent = T('Highlight'); place(rectOf(range)); }
    else if (pending && pending.kind === 'add') hide();
  };
  let timer = 0;
  document.addEventListener('selectionchange', () => { clearTimeout(timer); timer = setTimeout(updateSel, 120); });
  document.addEventListener('click', (e) => {
    if (pop.contains(e.target)) return;
    const mk = e.target.closest && e.target.closest('.rp-page mark[data-hl-n]');
    if (mk && window.getSelection().isCollapsed) {
      const n = Number(mk.dataset.hlN), ghost = mk.dataset.hlType === 'ghost';
      pending = { kind: 'remove', n }; act.textContent = ghost ? T('Dismiss highlight') : T('Remove highlight'); place(rectOf(mk));
    } else if (pending && pending.kind === 'remove') hide();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { hide(); } });
  window.addEventListener('scroll', () => { if (!pop.hidden) { if (pending && pending.kind === 'add') updateSel(); else hide(); } }, { passive: true });
  pop.addEventListener('mousedown', (e) => e.preventDefault());   // keeps the selection
  act.addEventListener('click', () => { if (!pending) return; pending.kind === 'add' ? doAdd(pending.range) : doRemove(pending.n); });
  if (btn) {
    setText(btn, T('Highlight')); btn.disabled = true;
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => { const r = content() && selectionIn(content()); if (r) doAdd(r.cloneRange()); });
  }
}

// ── Bookmark: mark the place you stopped at (the block at the top of the window); the next visit offers to jump back ──
let bm = null;
function wireBookmark() {
  if (bm || !raw || !raw.id) return;
  const content = () => document.querySelector('.rp-content');
  const btn = $('rpBookmarkBtn'), menu = $('rpBookmarkMenu');
  if (!content() || !btn) return;   // no full text: nothing to put a bookmark in
  btn.hidden = false;
  bm = { place: raw.readPlace && raw.readPlace.exact ? raw.readPlace : null, banner: null };
  const barBottom = () => { const b = $('rpBar'); return b && b.getBoundingClientRect ? b.getBoundingClientRect().bottom : 0; };
  const blockNow = () => {   // the block the selection starts in, else the one at the top of the window
    const sel = window.getSelection && window.getSelection(), root = content();
    if (sel && sel.rangeCount && !sel.isCollapsed && root.contains(sel.anchorNode)) { const el = sel.getRangeAt(0).startContainer; const p = el.nodeType === 3 ? el.parentElement : el; const b = p && p.closest('p,li,blockquote,h2,h3,h4,pre,figcaption,td'); if (b && root.contains(b)) return b; }
    return blockAtTop(root, barBottom());
  };
  const target = () => blockOfPlace(content(), bm.place);
  const jump = () => { const b = target(); if (b) b.scrollIntoView({ block: 'start', behavior: 'smooth' }); else toast(T('The bookmarked place is no longer in the text.')); };
  const paint = () => {
    document.querySelectorAll('.rp-bookmarked').forEach((e) => e.classList.remove('rp-bookmarked'));
    const b = bm.place && target(); if (b) b.classList.add('rp-bookmarked');
    btn.setAttribute('aria-pressed', String(!!bm.place));
  };
  const save = async (place) => {
    bm.place = place; paint(); raw.readPlace = place || '';
    setHash({ p: place ? place.exact.slice(0, 160) : '' });
    try { await StorageManager.setArticleReadPlace(raw.id, place); } catch (e) { toast(String((e && e.message) || e)); }
  };
  const setHere = () => {
    const b = blockNow(), place = b && placeOfBlock(content(), b);
    if (!place) { toast(T('Scroll to the text first.')); return; }
    save(place); toast(T('Bookmark set'));
  };
  // one menu for both kinds: the place in the text (set, jump, remove) and the page in the browser's bookmarks
  const paintMenu = async () => {
    $('rpBmMove').textContent = bm.place ? T('Move bookmark here') : T('Bookmark this place');
    $('rpBmJump').hidden = $('rpBmRemove').hidden = !bm.place;
    const browser = $('rpBmBrowser');
    browser.hidden = !browserBookmarksPossible();
    browser.textContent = (await hasBrowserBookmark(raw.id)) ? T('Update browser bookmark') : T('Save in browser bookmarks');
    browser.title = bm.place ? T('The bookmark opens at your place') : '';
  };
  btn.addEventListener('click', paintMenu);
  $('rpBmBrowser').addEventListener('click', async () => {
    if (!(await ensureBookmarksAccess())) { toast(T('The browser did not allow access to bookmarks.')); return; }   // first call in the handler: the prompt needs the click
    try {
      const r = await saveBrowserBookmark({ articleId: raw.id, title: document.title, url: window.location.href });
      toast(r === 'updated' ? T('Browser bookmark updated') : T('Saved in browser bookmarks'));
    } catch (e) { toast(String((e && e.message) || e)); }
  });
  $('rpBmJump').addEventListener('click', jump);
  $('rpBmMove').addEventListener('click', setHere);
  $('rpBmRemove').addEventListener('click', () => { save(null); toast(T('Bookmark removed')); });
  paint();
  // opened from a browser bookmark that carries a place: go there (that is what the click meant)
  const fromBookmark = hashParams().get('p');
  if (fromBookmark) {
    const b = blockOfPlace(content(), { exact: fromBookmark });
    if (b) { b.scrollIntoView({ block: 'start' }); return; }
  }
  // coming back: offer the way to where you were (never jump by itself)
  const pr = Number(raw.progress) || 0;
  const target0 = bm.place && target();
  if (target0 || (pr > 0.03 && pr < 0.9)) {
    const bar = document.createElement('p'); bar.className = 'rp-resume';
    const go = document.createElement('button'); go.type = 'button'; go.className = 'button-secondary btn-sm';
    go.textContent = target0 ? T('Continue at your bookmark') : T('Continue at {n} %', { n: Math.round(pr * 100) });
    go.addEventListener('click', () => { if (target0) jump(); else window.scrollTo({ top: Math.max(0, pr * document.documentElement.scrollHeight - window.innerHeight), behavior: 'smooth' }); bar.remove(); });
    const x = document.createElement('button'); x.type = 'button'; x.className = 'rp-tool'; x.textContent = '×'; x.setAttribute('aria-label', T('Dismiss')); x.addEventListener('click', () => bar.remove());
    bar.append(go, x);
    const meta = document.querySelector('.rp-meta'); if (meta) meta.after(bar);
  }
}

// How far this article was read: the deepest scroll position, kept on the article (and synced like its other reading status).
let reading = null;
function trackReading(article, html) {
  if (reading || !article.id) return;
  reading = createReadTracker({ words: countWords(html), start: article.progress || 0, save: (p) => StorageManager.patchArticleProgress(article.id, p).catch(() => {}) });
  const depth = () => { const h = root.scrollHeight; return h > 0 ? (window.scrollY + window.innerHeight) / h : 0; };
  const sample = () => reading.sample(depth(), document.visibilityState === 'visible');
  let timer = 0;   // the one-second beat (time in front of the text) starts with the first scroll: a page nobody scrolls measures nothing
  window.addEventListener('scroll', () => { if (!timer) timer = setInterval(sample, 1000); sample(); }, { passive: true });
  window.addEventListener('pagehide', () => { clearInterval(timer); reading.flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') reading.flush(); });
  sample();
}

async function render() {
  const page = $('rpPage');
  const id = new URLSearchParams(window.location.hash.slice(1)).get('id');
  const article = id ? await loadArticle(id) : null;
  if (!article) {
    page.innerHTML = `<p class="rp-empty">${escapeHtml(T('This article is no longer available.'))}</p>`;
    const u = hashParams().get('u');   // a bookmark made elsewhere: the original is still reachable
    if (u && /^https?:\/\//i.test(u)) {
      const a = document.createElement('a'); a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = T('Open the original page');
      const p = document.createElement('p'); p.className = 'rp-empty'; p.append(a); page.append(p);
    }
    return;
  }

  const annotations = await fetchAnnotationsForArticle(article);
  hlList = annotations; hlPage = article.url || '';
  const contentRaw = article.content || article.html || article.text || '';
  const contentHtml = clean(contentRaw);
  const summaryHtml = clean(article.summary);

  const title = article.title || T('Article');
  document.title = title;
  if (/^https?:\/\//i.test(article.url || '')) setHash({ u: article.url });
  trackReading(article, contentHtml || summaryHtml);
  let domain = '';
  try { domain = new URL(article.url).hostname.replace(/^www\./, ''); } catch (_) { /* no url */ }
  const minutes = Math.max(1, Math.round(countWords(contentHtml || summaryHtml) / 220));
  const meta = (article.meta || {});
  const bits = [];
  if (domain && /^https?:/i.test(article.url)) bits.push(`<a href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(domain)} ↗</a>`);
  if (article.timestamp) bits.push(`<span>${escapeHtml(new Date(article.timestamp).toLocaleDateString(document.documentElement.lang || undefined))}</span>`);
  bits.push(`<span>${escapeHtml(T('~{n} min read', { n: minutes }))}</span>`);

  // eslint-disable-next-line no-unsanitized/property -- reviewed: content and summary went through clean() (cleanUntrustedHtml), meta bits are escaped
  page.innerHTML = `
    <article>
      <h1 class="rp-title">${escapeHtml(title)}</h1>
      <p class="rp-meta">${bits.join('')}</p>
      ${meta.description ? `<p class="rp-desc">${escapeHtml(meta.description)}</p>` : ''}
      ${summaryHtml ? `<section class="rp-summary" aria-labelledby="rpSumH"><h2 id="rpSumH">${escapeHtml(T('🧙 AI Summary'))}</h2>${summaryHtml}</section>` : ''}
      <section class="rp-content">${contentHtml ? `<h2 class="rp-sec">${escapeHtml(T('📄 Original Content'))}</h2>${contentHtml}` : `<p class="rp-empty">${escapeHtml(T('No content available.'))}</p>`}</section>
    </article>`;
  paintAll([page.querySelector('.rp-content'), page.querySelector('.rp-summary')], annotations);   // after the page exists: placed by text + context, like on the website
  const toc = buildToc(page);
  if (toc) page.querySelector('.rp-meta').after(toc);
  if (!summaryHtml || !contentHtml) { prefs.view = 'both'; root.dataset.rpView = 'both'; $('rpViewGroup').hidden = true; }
}

// ── Share / send: the same actions as the article's detail view, reusing articleManager ──
let toastTimer = null;
/** A toast, with an optional action (Undo); → { dismiss, setText } like the popup's, which the shared send logic expects. */
function showToast(msg, ms = 4500, action = null) {
  const t = $('rpToast'); if (!t || !msg) return { dismiss() {}, setText() {} };
  const text = document.createElement('span'); text.textContent = msg; t.replaceChildren(text);
  if (action) { const b = document.createElement('button'); b.type = 'button'; b.className = 'rp-toast-action'; b.textContent = action.label; b.addEventListener('click', () => action.onClick()); t.append(b); }
  t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  return { dismiss() { t.hidden = true; clearTimeout(toastTimer); }, setText(x) { text.textContent = x; } };
}
const toast = (msg) => showToast(msg);
let am = null;
async function actions() {
  if (!am) {
    am = await import('./modules/articleManager.js');
    // No popup around: messages become toasts, "go to Settings" becomes a hint
    am.bindUiManager({ showToast, showScreen: () => toast(T('Open the extension and set it up under Settings → Send.')) });
  }
  return am;
}
// Send: the same split button as the article detail (last used target + ▾ with every target, Share, Copy link), modules/sendSplit.js
async function wireSend() {
  const wrap = $('rpSend'), main = $('rpSendMain'), more = $('rpSendMore');
  if (!wrap || !raw) return;
  let sp = { delivery: 'kindle', sendTarget: 'kindle' };
  try { sp = await loadSendPrefs(); } catch (_) { /* default: Kindle */ }
  const st = createSendTargets({
    actions: async () => { const m = await actions(); return { shareArticle: (a) => m.shareArticle(a), sendToKindle: (a) => m.sendToKindle(a), dispatchToLocalSend: (a) => m.dispatchToLocalSend(a), sendToPhone: (a) => m.sendToPhone(a) }; },
    prefs: () => sp, ui: () => ({ showToast, showScreen: () => toast(T('Open the extension and set it up under Settings → Send.')) }), repaint: () => paint(),
  });
  const paint = () => {
    const def = st.TARGETS[st.current(raw)];
    setIcon(main, def.icon); setText(main, def.label(), def.short());
    more.setAttribute('aria-label', T('Send to…')); more.title = T('Send to…');
  };
  paint();
  main.addEventListener('click', () => st.run(st.current(raw), { ...raw }));
  more.addEventListener('click', async () => {
    if (more.getAttribute('aria-expanded') === 'true') { (await import('./modules/cardMenu.js')).closeMenu(); return; }
    st.openMenu(more, { ...raw });
  });
  wrap.hidden = false;
}


// ── Read aloud: the visible part (summary and/or full text), sentence by sentence with the current one marked ──
const MARK = 'rp-speaking';
let units = [], stopState = null;
const mark = (i) => {
  document.querySelectorAll('.' + MARK).forEach(e => e.classList.remove(MARK));
  const u = units[i]; if (u && u.el) { u.el.classList.add(MARK); u.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
};
async function wireListen() {
  const btn = $('rpListen'), reader = getReader();
  if (!btn || !(await reader.ready)) return;
  btn.hidden = false;
  const paint = () => {
    const st = reader.state, mine = st.meta && st.meta.tool === 'reader' && st.meta.id === (raw && raw.id);
    const s = mine ? st.state : 'idle';
    setText(btn, s === 'playing' || s === 'waiting' ? T('Pause') : s === 'paused' ? T('Resume') : T('Read aloud'));
    setIcon(btn, s === 'playing' || s === 'waiting' ? 'pause' : 'headphones');
    btn.setAttribute('aria-pressed', String(s === 'playing' || s === 'waiting'));
    if (mine && s !== 'idle') mark(st.index); else mark(-1);
  };
  stopState = reader.onState(paint);
  btn.addEventListener('click', async () => {
    const st = reader.state;
    if (st.meta && st.meta.tool === 'reader' && st.meta.id === raw.id && ['playing', 'paused', 'waiting'].includes(st.state)) { reader.toggle(); return; }
    const view = root.dataset.rpView;
    const parts = [];
    if (view !== 'content') parts.push(document.querySelector('.rp-summary'));
    if (view !== 'summary') parts.push(document.querySelector('.rp-content'));
    units = parts.flatMap(c => speechUnits(c));
    if (!units.length) { toast(T('Nothing to read aloud.')); return; }
    const sample = units.slice(0, 6).map(u => u.text).join(' ');
    let code = await detectLang(sample);
    if (!code) { try { code = (await chrome.storage.sync.get('selectedLanguage')).selectedLanguage || 'en'; } catch (_) { code = 'en'; } }
    const lang = ttsLang(code);
    await reader.start(units.map(u => ({ text: u.text })), lang, { meta: { tool: 'reader', id: raw.id, lang } });
  });
  window.addEventListener('pagehide', () => { const m = reader.state.meta; if (m && m.tool === 'reader') reader.stop(); });
}

// ── The app beside the text: popup.html docked on the right, the page makes room, the edge is draggable ──
// On a window narrower than the "split" breakpoint there is no room for both: the app floats over the text instead.
function wireApp() {
  createAppDock({ button: $('rpApp'), labels: { open: T('App'), openFull: T('Open app'), close: T('Close'), closeFull: T('Close app') }, getWidth: () => prefs.dock, saveWidth: (w) => { prefs.dock = w; try { chrome.storage.local.set({ [PREFS_KEY]: prefs }); } catch (_) { /* optional */ } } });
}

// Ask about this article: a panel with the same question box as the article view's Ask tab (modules/articleAsk.js)
let askPanel = null;
async function toggleAsk() {
  if (askPanel) { askPanel.destroy(); askPanel.el.remove(); askPanel = null; return; }
  if (!raw || !raw.id) return;
  const { createArticleAsk } = await import('./modules/articleAsk.js');
  const el = document.createElement('section'); el.className = 'rp-ask'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', T('Ask about this article'));
  const head = document.createElement('div'); head.className = 'rp-ask-head';
  const h = document.createElement('strong'); h.textContent = T('Ask about this article');
  const x = document.createElement('button'); x.type = 'button'; x.className = 'rp-tool'; x.setAttribute('aria-label', T('Close')); x.textContent = '✕'; x.addEventListener('click', toggleAsk);
  head.append(h, x);
  const body = document.createElement('div'); body.className = 'rp-ask-body';
  el.append(head, body); document.body.append(el);
  const turns = await StorageManager.getConversation(raw.id);
  const ctl = createArticleAsk({ mount: body, article: { id: raw.id, title: raw.title }, content: raw.content || raw.html || raw.text || '', summary: raw.summaryBase !== undefined ? raw.summaryBase : (raw.summary || ''),
    turns, save: (t) => StorageManager.saveConversation(raw.id, t), onChange: async () => { const y = window.scrollY; await render(); window.scrollTo(0, y); } });   // the pinned answers belong to the summary: redraw it, but stay where the reader is
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); toggleAsk(); } });
  askPanel = { el, destroy: ctl.destroy }; ctl.focus();
}

// ⌘K / Ctrl+K: this page's own commands first (they press the toolbar's buttons, so they are always in step with it), then the app's
function wirePalette() {
  const press = (id) => () => { const b = $(id); if (b && !b.disabled) b.click(); };
  const here = T('This article');
  const extra = [
    { id: 'rp:bm', group: here, title: T('Bookmark this place'), keywords: 'bookmark save position resume', run: press('rpBmMove') },
    { id: 'rp:hl', group: here, title: T('Highlight selection'), keywords: 'mark highlight', run: press('rpHighlight') },
    { id: 'rp:send', group: here, title: T('Send'), keywords: 'kindle localsend share deliver', run: press('rpSendMain') },
    { id: 'rp:ask', group: here, title: T('Ask about this article'), keywords: 'question chat answer', run: toggleAsk },
    { id: 'rp:print', group: here, title: T('Print'), keywords: 'pdf', run: press('rpPrint') },
    { id: 'rp:app', group: here, title: T('Open app beside the article'), keywords: 'side panel dock', run: press('rpApp') },
    { id: 'rp:listen', group: here, title: T('Listen'), keywords: 'read aloud tts audio', run: press('rpListen') },
  ];
  const open = () => openExternalPalette({ extra, notify: (m) => showToast(m, 6000), openArticle: (a) => { location.hash = '#id=' + encodeURIComponent(a.id); location.reload(); } });
  bindPaletteKey(open);
  $('rpPalette').addEventListener('click', () => { const m = $('rpMoreMenu'); if (m) m.hidden = true; open(); });
}

async function init() {
  let cfg = {};
  try { cfg = await chrome.storage.local.get(PREFS_KEY); } catch (_) { /* defaults */ }
  prefs = { ...DEFAULTS, ...(cfg[PREFS_KEY] || {}) };
  ({ appTheme } = await bootPage());
  labelControls(); wireControls(); wireMenus(); applyPrefs();
  wirePalette();
  await render();
  revealQuoteFromHash();
  wireHighlights();
  wireBookmark();
  await wireSend();
  wireListen();
  wireApp();
  // "#id=…&print=1": the PDF export of the article menu — print dialog (Save as PDF) once the page is laid out
  if (new URLSearchParams(window.location.hash.slice(1)).get('print') === '1' && raw) {
    setPref({ view: 'both' });
    setTimeout(() => window.print(), 400);
  }
}
init();
