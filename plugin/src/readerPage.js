// Read mode page: opened in its own tab from an article's "Read" button (reader.html#id=<article id>).
// Shows the summary (with pinned questions) and the saved text with highlights, in a calm layout: text size, font,
// theme and width are the reader's choice and are remembered. Stored page HTML is untrusted — cleaned before display.
import { applyTranslations } from './modules/i18n.js';
import { T } from './modules/feedI18n.js';
import { escapeHtml, cleanUntrustedHtml, countWords } from './modules/textUtils.js';
import { withQuestions } from './modules/conversation.js';
import { fetchAnnotationsForArticle, markHighlights } from './modules/annotationExporter.js';
import StorageManager from './modules/storageManager.js';
import { SK } from './modules/storageKeys.js';
import { stripEmoji } from './modules/icons.js';
import { getReader, speechUnits, detectLang } from './modules/reader.js';
import { ttsLang } from './modules/languages.js';
import { createReadTracker } from './modules/readProgress.js';
import { applyA11y } from './modules/a11y.js';
import { bp } from './modules/breakpoints.js';
import { createHighlightStore } from './modules/highlightStore.js';
import { createReaderHighlights, selectionIn } from './modules/readerHighlights.js';

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
  const pairs = [['rpDisplayBtn', 'rpDisplayMenu'], ['rpMoreBtn', 'rpMoreMenu']].map(([b, m]) => [$(b), $(m)]);
  const closeAll = (except) => pairs.forEach(([b, m]) => { if (m !== except) { m.hidden = true; b.setAttribute('aria-expanded', 'false'); } });
  pairs.forEach(([b, m]) => b.addEventListener('click', (e) => { e.stopPropagation(); const open = m.hidden; closeAll(m); m.hidden = !open; b.setAttribute('aria-expanded', String(open)); }));
  document.addEventListener('click', (e) => { if (!e.target.closest('.rp-menu-wrap')) closeAll(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const open = pairs.find(([, m]) => !m.hidden); if (open) { closeAll(); open[0].focus(); } } });
  $('rpMoreMenu').addEventListener('click', (e) => { if (e.target.closest('button')) closeAll(); });
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
  setText($('rpListen'), T('Read aloud'));
  setText($('rpApp'), T('Open app'), T('App'));
  setText($('rpMoreBtn'), T('More'));
  setText($('rpDisplayBtn'), T('Text and theme'), 'Aa');
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
  if (!article) { page.innerHTML = `<p class="rp-empty">${escapeHtml(T('This article is no longer available.'))}</p>`; return; }

  const annotations = await fetchAnnotationsForArticle(article);
  hlList = annotations; hlPage = article.url || '';
  const placed = new Set();
  const contentRaw = article.content || article.html || article.text || '';
  const contentHtml = markHighlights(clean(contentRaw), annotations, placed, { ids: true });
  const summaryHtml = markHighlights(clean(article.summary), annotations, placed, { ids: true });

  const title = article.title || T('Article');
  document.title = title;
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
  const toc = buildToc(page);
  if (toc) page.querySelector('.rp-meta').after(toc);
  if (!summaryHtml || !contentHtml) { prefs.view = 'both'; root.dataset.rpView = 'both'; $('rpViewGroup').hidden = true; }
}

// ── Share / send: the same actions as the article's detail view, reusing articleManager ──
let toastTimer = null;
function toast(msg) {
  const t = $('rpToast'); if (!t || !msg) return;
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
}
let am = null;
async function actions() {
  if (!am) {
    am = await import('./modules/articleManager.js');
    // No popup around: messages become toasts, "go to Settings" becomes a hint
    am.bindUiManager({ showToast: toast, showScreen: () => toast(T('Open the extension and set it up under Settings → Send.')) });
  }
  return am;
}
async function runAction(btn, fn) {
  if (!raw || btn.disabled) return;
  btn.disabled = true;
  try { await fn(await actions(), { ...raw }); } catch (e) { toast(String((e && e.message) || e)); } finally { btn.disabled = false; }
}
async function wireSend() {
  const group = $('rpSendGroup'), share = $('rpShare'), send = $('rpSend');
  if (!group || !raw) return;
  let pref = 'kindle';
  try { pref = (await StorageManager.get('deliveryPreference')).deliveryPreference === 'localsend' ? 'localsend' : 'kindle'; } catch (_) { /* default */ }
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  share.hidden = !canShare;
  share.textContent = stripEmoji(T('Share 🔗'));
  share.addEventListener('click', () => runAction(share, (m, a) => m.shareArticle(a)));
  send.hidden = false;
  send.textContent = pref === 'localsend' ? stripEmoji(T('LocalSend 📱')) : stripEmoji(T('Kindle 📚'));
  send.addEventListener('click', () => runAction(send, (m, a) => (pref === 'localsend' ? m.dispatchToLocalSend(a) : m.sendToKindle(a))));
  group.hidden = false;
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
const DOCK_MIN = 320, DOCK_DEFAULT = 420;
const dockMax = () => Math.max(DOCK_MIN, Math.min(760, Math.round(window.innerWidth * 0.6)));
const clampDock = (w) => Math.min(dockMax(), Math.max(DOCK_MIN, Math.round(Number(w) || DOCK_DEFAULT)));
function wireApp() {
  const btn = $('rpApp'); if (!btn) return;
  let frame = null, grip = null;
  const setDock = (w) => { root.style.setProperty('--rp-dock', clampDock(w) + 'px'); if (grip) { grip.setAttribute('aria-valuenow', String(clampDock(w))); grip.setAttribute('aria-valuemin', String(DOCK_MIN)); grip.setAttribute('aria-valuemax', String(dockMax())); } };
  const saveDock = () => { prefs.dock = clampDock(parseInt(getComputedStyle(root).getPropertyValue('--rp-dock'), 10)); try { chrome.storage.local.set({ [PREFS_KEY]: prefs }); } catch (_) { /* optional */ } };
  // the edge tab: a slim handle on the right edge of the window says the app lives there and can be pulled in
  const edge = document.createElement('button');
  edge.type = 'button'; edge.className = 'rp-edge'; edge.setAttribute('aria-label', T('Open app'));
  edge.innerHTML = '<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-panel-right-open"/></svg>';
  document.body.appendChild(edge);
  const close = () => {
    const f = frame; frame = null;
    if (f) { f.classList.remove('rp-in'); setTimeout(() => { f.remove(); if (!frame) root.classList.remove('rp-docked'); }, 320); }   // slides out first (the CSS transition is shorter than this)
    if (grip) { grip.remove(); grip = null; }
    root.classList.remove('rp-open'); btn.setAttribute('aria-pressed', 'false'); setIcon(btn, 'panel-right-open');
    edge.hidden = false;
  };
  function makeGrip() {
    const g = document.createElement('div');
    g.className = 'rp-grip'; g.setAttribute('role', 'separator'); g.setAttribute('aria-orientation', 'vertical'); g.tabIndex = 0;
    g.setAttribute('aria-label', T('Resize the app panel'));
    g.addEventListener('pointerdown', (e) => {
      e.preventDefault(); g.setPointerCapture(e.pointerId); root.classList.add('rp-resizing');   // the frame must not swallow the drag
      const move = (ev) => setDock(window.innerWidth - ev.clientX);
      const up = () => { g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up); root.classList.remove('rp-resizing'); saveDock(); };
      g.addEventListener('pointermove', move); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
    });
    g.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowLeft' ? 24 : e.key === 'ArrowRight' ? -24 : 0; if (!d) return;
      e.preventDefault(); setDock(parseInt(getComputedStyle(root).getPropertyValue('--rp-dock'), 10) + d); saveDock();
    });
    return g;
  }
  const layout = () => {   // wide enough: beside the text (with a grip); narrow: over it
    if (!frame) return;
    const wide = window.innerWidth >= bp('split');
    root.classList.toggle('rp-docked', wide);
    if (wide && !grip) { grip = makeGrip(); document.body.appendChild(grip); setDock(prefs.dock); }
    if (!wide && grip) { grip.remove(); grip = null; }
    if (wide) setDock(parseInt(getComputedStyle(root).getPropertyValue('--rp-dock'), 10) || prefs.dock);
  };
  const toggle = () => {
    if (frame) { close(); return; }
    frame = document.createElement('iframe');
    frame.className = 'rp-float'; frame.title = T('Open app');
    frame.src = chrome.runtime.getURL('popup.html') + '?surface=float';
    document.body.appendChild(frame);
    btn.setAttribute('aria-pressed', 'true'); setIcon(btn, 'panel-right-close'); edge.hidden = true;
    root.classList.add('rp-open');
    setDock(prefs.dock); layout();
    requestAnimationFrame(() => requestAnimationFrame(() => { if (frame) frame.classList.add('rp-in'); }));   // after the first paint, so it slides
  };
  btn.addEventListener('click', toggle);
  edge.addEventListener('click', toggle);
  window.addEventListener('resize', layout);
  window.addEventListener('message', (e) => {
    if (frame && e.source === frame.contentWindow && e.origin === location.origin && e.data && e.data.aishFloat === 'close') close();
  });
}

async function init() {
  let cfg = {};
  let lang = 'en';
  try { cfg = await chrome.storage.local.get(PREFS_KEY); } catch (_) { /* defaults */ }
  try { lang = (await chrome.storage.sync.get('uiLanguage')).uiLanguage || 'en'; } catch (_) { /* English */ }
  prefs = { ...DEFAULTS, ...(cfg[PREFS_KEY] || {}) };
  try {   // brand colours, colour scheme, text size, icon style: the same appearance settings as the popup
    const a = await StorageManager.get(['theme', 'textScale', 'lineSpacing', 'readableFont', 'reduceMotion', 'iconStyle', 'colorScheme']);
    appTheme = a.theme === 'dark' || a.theme === 'light' || a.theme === 'contrast' ? a.theme : '';
    applyA11y({ ...a, theme: appTheme });
  } catch (_) { /* tokens' own defaults */ }
  try { await applyTranslations(lang); } catch (_) { /* English */ }
  labelControls(); wireControls(); wireMenus(); applyPrefs();
  await render();
  revealQuoteFromHash();
  wireHighlights();
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
