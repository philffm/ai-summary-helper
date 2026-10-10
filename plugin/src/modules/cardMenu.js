// cardMenu.js — the "⋯" actions menu on summary cards (History list and the main-screen feed).
// One popover at a time, mounted on <body> (never clipped by a card), keyboard friendly.
// The heavy work (copy, share, LocalSend, Kindle, Markdown, delete) lives in articleManager.js and is
// loaded only when an action is picked, so the first paint does not pay for it.
import { iconEl } from './icons.js';
import { T } from './feedI18n.js';
import { getReader, streamText, speakable } from './reader.js';
import { ttsLang } from './languages.js';
import { canSelect, startSelectionWith } from './sendSheet.js';

let current = null;   // { close }
const closeMenu = () => { if (current) { const c = current; current = null; c.close(); } };

const activeReading = (a) => {
  const r = getReader(); const m = r.state.meta;
  return !!(m && m.tool === 'instant' && m.id === a.id && ['playing', 'paused', 'waiting'].includes(r.state.state)) ? r.state.state : '';
};

async function readAloud(a) {
  const reader = getReader();
  if (activeReading(a)) { reader.toggle(); return; }
  let code = 'en';
  try { code = (await chrome.storage.sync.get('selectedLanguage')).selectedLanguage || 'en'; } catch (_) { /* default */ }
  const lang = ttsLang(code);
  const units = speakable(streamText(a.summary || ''), true).map(text => ({ text, lang }));
  if (units.length) await reader.start(units, lang, { meta: { tool: 'instant', lang, id: a.id } });
}

const am = () => import('./articleManager.js');

/** Menu entries for an article (hidden ones are left out). */
export function menuItems(a, { onRemoved } = {}) {
  const hasSummary = !!(a.summary && String(a.summary).trim()) && !a.feedStub;
  const st = activeReading(a);
  const items = [];
  if (a.url) items.push({ icon: 'link', label: T('Open original'), run: () => window.open(a.url, '_blank', 'noopener') });
  if (hasSummary) {
    items.push({ icon: st === 'paused' ? 'play' : st ? 'pause' : 'volume-2', label: st === 'paused' ? T('Play') : st ? T('Pause') : T('Read aloud'), run: () => readAloud(a), needsSpeech: true });
    items.push({ icon: 'copy', label: T('Copy'), run: async () => (await am()).copyArticleToClipboard(a) });
    if (navigator.share) items.push({ icon: 'external-link', label: T('Share'), run: async () => (await am()).shareArticle(a) });
    items.push({ icon: 'send', label: T('Send via LocalSend'), run: async () => (await am()).dispatchToLocalSend(a), sep: true });
    items.push({ icon: 'book-open', label: T('Send to Kindle'), run: async () => (await am()).sendToKindle(a) });
    items.push({ icon: 'download', label: T('Export as Markdown'), run: async () => (await am()).exportToMarkdown(a) });
  }
  if (a.id && canSelect(a)) items.push({ icon: 'square-check-big', label: T('Select'), run: () => startSelectionWith(a), sep: true });
  if (a.id) {
    if (!a.feedStub) items.push({ icon: a.archived ? 'undo-2' : 'archive', label: a.archived ? T('Restore to Inbox') : T('Archive'), run: async () => (await am()).applyStatus([a.id], { archived: !a.archived }), sep: true });
    items.push({ icon: 'trash-2', label: T('Delete'), danger: true, sep: !hasSummary || a.feedStub, run: async () => { const ok = await (await am()).removeArticle(a); if (ok && onRemoved) onRemoved(a); } });
  }
  return items;
}

function openMenu(btn, a, opts) {
  closeMenu();
  const items = menuItems(a, opts);
  if (!items.length) return;
  const menu = document.createElement('div');
  menu.className = 'card-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', T('More actions'));
  const speech = getReader();
  items.forEach((it) => {
    if (it.sep) { const s = document.createElement('div'); s.className = 'card-menu-sep'; s.setAttribute('role', 'separator'); menu.appendChild(s); }
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'menuitem');
    b.className = 'card-menu-item' + (it.danger ? ' is-danger' : '');
    const ic = document.createElement('span'); ic.className = 'card-menu-ic'; ic.setAttribute('aria-hidden', 'true'); ic.append(iconEl(it.icon));
    const tx = document.createElement('span'); tx.textContent = it.label;
    b.append(ic, tx);
    if (it.needsSpeech) { b.hidden = true; speech.ready.then((ok) => { b.hidden = !ok; }); }
    b.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); Promise.resolve().then(it.run).catch(() => {}); });
    menu.appendChild(b);
  });
  document.body.appendChild(menu);
  btn.setAttribute('aria-expanded', 'true');
  // place under the button, right aligned; flip up when there is no room
  const r = btn.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw));
  let top = r.bottom + 4; if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  menu.style.left = left + 'px'; menu.style.top = top + 'px';
  const enabled = () => [...menu.querySelectorAll('.card-menu-item')].filter(x => !x.hidden);
  const outside = (e) => { if (!menu.contains(e.target) && e.target !== btn) closeMenu(); };
  const keys = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); btn.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); const l = enabled(); if (!l.length) return;
      const i = l.indexOf(document.activeElement); l[(i + (e.key === 'ArrowDown' ? 1 : -1) + l.length) % l.length].focus();
    }
    if (e.key === 'Tab') closeMenu();
  };
  const close = () => {
    menu.remove(); btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', keys, true);
    window.removeEventListener('scroll', closeMenu, true); window.removeEventListener('resize', closeMenu);
  };
  document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', keys, true);
  window.addEventListener('scroll', closeMenu, true); window.addEventListener('resize', closeMenu);
  current = { close };
  const f = enabled()[0]; if (f) f.focus({ preventScroll: true });
}

/** Adds the ellipsis button to `host` and wires the menu. Returns the button. */
export function attachCardMenu(host, article, opts = {}) {
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'card-menu-btn';
  btn.append(iconEl('ellipsis'));
  btn.title = T('More actions'); btn.setAttribute('aria-label', T('More actions'));
  btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', (e) => { e.stopPropagation(); if (current && btn.getAttribute('aria-expanded') === 'true') { closeMenu(); return; } openMenu(btn, article, opts); });
  btn.addEventListener('keydown', (e) => { e.stopPropagation(); });   // Enter / Space belong to the button, not to the card
  host.appendChild(btn);
  return btn;
}
