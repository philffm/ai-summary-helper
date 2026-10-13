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

const PREFS_KEY = 'reader:prefs';
const SIZES = [15, 17, 19, 21, 24, 28];
const DEFAULTS = { size: 2, font: 'serif', theme: 'auto', view: 'both' };
const root = document.documentElement;
const $ = (id) => document.getElementById(id);
let prefs = { ...DEFAULTS };
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
  root.dataset.rpFont = prefs.font; root.dataset.rpTheme = prefs.theme; root.dataset.rpView = prefs.view;
  document.querySelectorAll('[data-font]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.font === prefs.font)));
  document.querySelectorAll('[data-theme]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme === prefs.theme)));
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === prefs.view)));
  $('rpSmaller').disabled = prefs.size === 0; $('rpLarger').disabled = prefs.size === SIZES.length - 1;
}
const setPref = (patch) => { prefs = { ...prefs, ...patch }; applyPrefs(); try { chrome.storage.local.set({ [PREFS_KEY]: prefs }); } catch (_) { /* optional */ } };

function labelControls() {
  $('rpSmaller').setAttribute('aria-label', T('Smaller text')); $('rpLarger').setAttribute('aria-label', T('Larger text'));
  $('rpFontGroup').setAttribute('aria-label', T('Font')); $('rpThemeGroup').setAttribute('aria-label', T('Theme')); $('rpViewGroup').setAttribute('aria-label', T('Show'));
  const names = { serif: T('Serif font'), sans: T('Sans-serif font') };
  document.querySelectorAll('[data-font]').forEach(b => b.setAttribute('aria-label', names[b.dataset.font]));
  const th = { auto: T('Auto'), light: T('Light'), sepia: T('Sepia'), dark: T('Dark') };
  document.querySelectorAll('[data-theme]').forEach(b => { b.textContent = th[b.dataset.theme]; });
  const vw = { both: T('Both'), summary: T('Summary'), content: T('Full text') };
  document.querySelectorAll('[data-view]').forEach(b => { b.textContent = vw[b.dataset.view]; });
  $('rpPrint').textContent = T('Print');
  $('rpListen').textContent = T('Read aloud');
}

function wireControls() {
  $('rpSmaller').addEventListener('click', () => setPref({ size: prefs.size - 1 }));
  $('rpLarger').addEventListener('click', () => setPref({ size: prefs.size + 1 }));
  $('rpPrint').addEventListener('click', () => window.print());
  document.querySelectorAll('[data-font]').forEach(b => b.addEventListener('click', () => setPref({ font: b.dataset.font })));
  document.querySelectorAll('[data-theme]').forEach(b => b.addEventListener('click', () => setPref({ theme: b.dataset.theme })));
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

async function render() {
  const page = $('rpPage');
  const id = new URLSearchParams(window.location.hash.slice(1)).get('id');
  const article = id ? await loadArticle(id) : null;
  if (!article) { page.innerHTML = `<p class="rp-empty">${escapeHtml(T('This article is no longer available.'))}</p>`; return; }

  const annotations = await fetchAnnotationsForArticle(article);
  const placed = new Set();
  const contentRaw = article.content || article.html || article.text || '';
  const contentHtml = markHighlights(clean(contentRaw), annotations, placed);
  const summaryHtml = markHighlights(clean(article.summary), annotations, placed);

  const title = article.title || T('Article');
  document.title = title;
  let domain = '';
  try { domain = new URL(article.url).hostname.replace(/^www\./, ''); } catch (_) { /* no url */ }
  const minutes = Math.max(1, Math.round(countWords(contentHtml || summaryHtml) / 220));
  const meta = (article.meta || {});
  const bits = [];
  if (domain && /^https?:/i.test(article.url)) bits.push(`<a href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(domain)} ↗</a>`);
  if (article.timestamp) bits.push(`<span>${escapeHtml(new Date(article.timestamp).toLocaleDateString(document.documentElement.lang || undefined))}</span>`);
  bits.push(`<span>${escapeHtml(T('~{n} min read', { n: minutes }))}</span>`);

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
  try { pref = (await StorageManager.getAll()).deliveryPreference === 'localsend' ? 'localsend' : 'kindle'; } catch (_) { /* default */ }
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
    btn.textContent = s === 'playing' || s === 'waiting' ? T('Pause') : s === 'paused' ? T('Resume') : T('Read aloud');
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

async function init() {
  let cfg = {};
  let lang = 'en';
  try { cfg = await chrome.storage.local.get(PREFS_KEY); } catch (_) { /* defaults */ }
  try { lang = (await chrome.storage.sync.get('uiLanguage')).uiLanguage || 'en'; } catch (_) { /* English */ }
  prefs = { ...DEFAULTS, ...(cfg[PREFS_KEY] || {}) };
  try { await applyTranslations(lang); } catch (_) { /* English */ }
  labelControls(); wireControls(); applyPrefs();
  await render();
  await wireSend();
  wireListen();
  // "#id=…&print=1": the PDF export of the article menu — print dialog (Save as PDF) once the page is laid out
  if (new URLSearchParams(window.location.hash.slice(1)).get('print') === '1' && raw) {
    setPref({ view: 'both' });
    setTimeout(() => window.print(), 400);
  }
}
init();
