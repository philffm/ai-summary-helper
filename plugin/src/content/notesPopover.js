// content/notesPopover.js
// The selection toolbar (✏️ highlight · 💬 comment · 📝 note) and its small composer, for any page. Lives in its own shadow root so
// the page's CSS cannot touch it; the look comes from the design tokens in inPage.css (Figma AISH-039).
// Names are prefixed `np` (the content-script bundle shares one scope).
// Nothing here writes storage: the caller turns a click into a highlight or sends a message to the background.
import { splitTags } from '../modules/noteText.js';
import { ipsAttach } from './inPageStyles.js';

const NP_ID = 'aish-np-host';
let npClose = null;   // what to undo when the toolbar or composer goes away

function npEnsureHost() {
  let host = document.getElementById(NP_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = NP_ID;
    host.setAttribute('data-aish-ui', '1');
    host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483646;';
    const root = host.attachShadow({ mode: 'open' });
    for (const type of ['keydown', 'keyup', 'keypress', 'mouseup']) host.addEventListener(type, (e) => e.stopPropagation());   // page shortcuts must not fire while typing here, and a press on our own button is not a new text selection
    document.documentElement.appendChild(host);
    host._root = root;
    ipsAttach(host, root);
  }
  return host;
}

export function npHide() {
  if (npClose) { const c = npClose; npClose = null; c(); }
  const host = document.getElementById(NP_ID);
  if (host) host.remove();
}

function npClamp(x, y, w) {
  const left = Math.max(window.scrollX + 8, Math.min(x, window.scrollX + window.innerWidth - w - 8));
  return { left, top: Math.max(window.scrollY + 8, y) };
}

function npWatchOutside(host, keep = () => false) {
  const onDown = (e) => { if (e.composedPath && e.composedPath().includes(host)) return; if (keep(e)) return; npHide(); };
  const onKey = (e) => { if (e.key === 'Escape') npHide(); };
  const t = setTimeout(() => { document.addEventListener('mousedown', onDown, true); }, 60);   // not for the very click that opened this
  document.addEventListener('keydown', onKey, true);
  npClose = () => { clearTimeout(t); document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey, true); };
}

/** The three-button toolbar above a selection. x, y are page coordinates (event.pageX/pageY). */
export function npShowToolbar({ x, y, onHighlight, onComment, onNote }) {
  npHide();
  const host = npEnsureHost(), root = host._root;
  const bar = document.createElement('div'); bar.className = 'np-bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Highlight, comment or note on the selection');
  for (const [glyph, label, fn] of [['✏️', 'Highlight', onHighlight], ['💬', 'Highlight and comment', onComment], ['📝', 'Note with this quote', onNote]]) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = glyph; b.title = label; b.setAttribute('aria-label', label);
    b.addEventListener('mousedown', (e) => e.preventDefault());   // keep the selection while pressing
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); npHide(); fn(); });
    bar.appendChild(b);
  }
  const p = npClamp(x - 40, y - 46, 126); bar.style.left = p.left + 'px'; bar.style.top = p.top + 'px';
  root.appendChild(bar);
  npWatchOutside(host);
  return bar;
}

/**
 * A small menu of text buttons at a point on the page: what to do with a highlight that was clicked (Keep / Dismiss / Remove)
 * or "Attach here" for a highlight being re-attached. items: [[label, fn, 'primary'|'danger'|undefined], …]
 */
export function npShowActions({ x, y, label, items }) {
  npHide();
  const host = npEnsureHost(), root = host._root;
  const bar = document.createElement('div'); bar.className = 'np-bar np-bar--text'; bar.setAttribute('role', 'menu'); bar.setAttribute('aria-label', label);
  for (const [text, fn, kind] of items) {
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.textContent = text;
    if (kind) b.className = 'np-' + kind;
    b.addEventListener('mousedown', (e) => e.preventDefault());   // keep a selection (re-attach) while pressing
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); npHide(); fn(); });
    bar.appendChild(b);
  }
  const p = npClamp(x - 20, y - 50, 60 + 110 * items.length); bar.style.left = p.left + 'px'; bar.style.top = p.top + 'px';
  root.appendChild(bar);
  npWatchOutside(host);
  return bar;
}

/**
 * The composer. onSave(text, tags) may return a promise; true or undefined = saved, false = failed (the text stays).
 * heading: 'Comment' | 'Note'. quote: the selected text, shown above the field.
 */
export function npShowComposer({ x, y, heading, quote = '', placeholder = 'Write here…', saveLabel = 'Save', onSave }) {
  npHide();
  // a phone: the keyboard and the browser's bar take the lower half, so the box sits at the top of what is visible
  const phone = !!window.matchMedia?.('(pointer: coarse)').matches && window.innerWidth < 600;
  const host = npEnsureHost(), root = host._root;
  const card = document.createElement('div'); card.className = 'np-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', heading);
  const head = document.createElement('div'); head.className = 'np-head';
  const title = document.createElement('span'); title.textContent = heading;
  const x_ = document.createElement('button'); x_.type = 'button'; x_.textContent = '✕'; x_.className = 'np-x'; x_.setAttribute('aria-label', 'Close'); x_.addEventListener('click', npHide);
  head.append(title, x_); card.appendChild(head);
  if (quote) { const q = document.createElement('p'); q.className = 'np-quote'; q.textContent = '“' + (quote.length > 160 ? quote.slice(0, 160) + '…' : quote) + '”'; card.appendChild(q); }
  const ta = document.createElement('textarea'); ta.className = 'np-ta'; ta.placeholder = placeholder; ta.setAttribute('aria-label', heading); card.appendChild(ta);
  const row = document.createElement('div'); row.className = 'np-row';
  const hint = document.createElement('span'); hint.className = 'np-hint'; hint.textContent = phone ? 'End with #tags' : 'End with #tags · ⌘/Ctrl+Enter';
  const go = document.createElement('button'); go.type = 'button'; go.className = 'np-go'; go.textContent = saveLabel; go.disabled = true;
  row.append(hint, go); card.appendChild(row);
  ta.addEventListener('input', () => { go.disabled = !splitTags(ta.value).text; });
  const save = async () => {
    const { text, tags } = splitTags(ta.value); if (!text || go.disabled) return;
    go.disabled = true; go.textContent = '…';
    let ok = true; try { ok = (await onSave(text, tags)) !== false; } catch (_) { ok = false; }
    if (ok) { npHide(); npToast(x, y, 'Saved'); } else { go.disabled = false; go.textContent = 'Try again'; }
  };
  go.addEventListener('click', save);
  ta.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(); } });
  const p = phone ? npClamp(window.scrollX + (window.innerWidth - 320) / 2, window.scrollY + 16, 320) : npClamp(x - 20, y + 10, 330);
  card.style.left = p.left + 'px'; card.style.top = p.top + 'px';
  root.appendChild(card);
  npWatchOutside(host, () => !!ta.value.trim());   // a click elsewhere does not throw away what is being typed
  ta.focus();
  return card;
}

function npToast(x, y, text) {
  const host = npEnsureHost(), t = document.createElement('div'); t.className = 'np-toast'; t.textContent = text; t.setAttribute('role', 'status');
  const p = npClamp(x - 20, y + 10, 90); t.style.left = p.left + 'px'; t.style.top = p.top + 'px';
  host._root.appendChild(t);
  setTimeout(() => { t.remove(); const h = document.getElementById(NP_ID); if (h && h._root && !h._root.querySelector('.np-bar, .np-card, .np-toast')) h.remove(); }, 1400);
}
