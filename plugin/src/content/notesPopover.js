// content/notesPopover.js
// The selection toolbar (✏️ highlight · 💬 comment · 📝 note) and its small composer, for any page. Lives in its own shadow root so
// the page's CSS cannot touch it. Names are prefixed `np` (the content-script bundle shares one scope).
// Nothing here writes storage: the caller turns a click into a highlight or sends a message to the background.
import { splitTags } from '../modules/noteText.js';

const NP_ID = 'aish-np-host';
const NP_CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  .bar { position: absolute; display: flex; gap: 2px; padding: 3px; background: #111827; border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.3); }
  .bar button { all: unset; box-sizing: border-box; cursor: pointer; padding: 6px 10px; font-size: 15px; line-height: 1; border-radius: 8px; color: #fff; }
  .bar button:hover, .bar button:focus-visible { background: #1f2937; outline: 2px solid #60a5fa; outline-offset: -2px; }
  .card { position: absolute; width: 320px; max-width: calc(100vw - 16px); background: #fff; color: #111827; border: 1px solid #e5e7eb; border-radius: 14px; box-shadow: 0 12px 32px rgba(0,0,0,.25); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
  .head { display: flex; justify-content: space-between; align-items: center; font-size: 12px; font-weight: 700; color: #6b7280; letter-spacing: .02em; }
  .head button { all: unset; cursor: pointer; font-size: 14px; padding: 0 4px; color: #6b7280; }
  .quote { margin: 0; font-size: 12px; font-style: italic; color: #4b5563; border-left: 3px solid #eab308; padding-left: 8px; max-height: 3.9em; overflow: hidden; }
  textarea { width: 100%; resize: none; font: inherit; font-size: 14px; line-height: 1.4; min-height: 64px; max-height: 160px; padding: 8px; border: 1px solid #d1d5db; border-radius: 8px; background: #fff; color: #111827; outline: none; }
  textarea:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.18); }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .hint { font-size: 11px; color: #6b7280; }
  .go { all: unset; box-sizing: border-box; cursor: pointer; background: #2563eb; color: #fff; border-radius: 999px; padding: 6px 14px; font-size: 12px; font-weight: 700; }
  .go[disabled] { opacity: .5; cursor: default; }
  .go:focus-visible { outline: 2px solid #1d4ed8; outline-offset: 2px; }
  .toast { position: absolute; background: #111827; color: #fff; font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 999px; box-shadow: 0 6px 18px rgba(0,0,0,.3); }
  @media (prefers-color-scheme: dark) {
    .card { background: #1f2937; color: #f3f4f6; border-color: #374151; } .quote { color: #d1d5db; } .head, .head button, .hint { color: #9ca3af; }
    textarea { background: #111827; color: #f3f4f6; border-color: #374151; }
  }
`;

let npClose = null;   // what to undo when the toolbar or composer goes away

function npEnsureHost() {
  let host = document.getElementById(NP_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = NP_ID;
    host.setAttribute('data-aish-ui', '1');
    host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483646;';
    const root = host.attachShadow({ mode: 'open' });
    const st = document.createElement('style'); st.textContent = NP_CSS; root.appendChild(st);
    for (const type of ['keydown', 'keyup', 'keypress']) host.addEventListener(type, (e) => e.stopPropagation());   // page shortcuts must not fire while typing here
    document.documentElement.appendChild(host);
    host._root = root;
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
  const bar = document.createElement('div'); bar.className = 'bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Highlight, comment or note on the selection');
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
 * The composer. onSave(text, tags) may return a promise; true or undefined = saved, false = failed (the text stays).
 * heading: 'Comment' | 'Note'. quote: the selected text, shown above the field.
 */
export function npShowComposer({ x, y, heading, quote = '', placeholder = 'Write here…', saveLabel = 'Save', onSave }) {
  npHide();
  const host = npEnsureHost(), root = host._root;
  const card = document.createElement('div'); card.className = 'card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', heading);
  const head = document.createElement('div'); head.className = 'head';
  const title = document.createElement('span'); title.textContent = heading;
  const x_ = document.createElement('button'); x_.type = 'button'; x_.textContent = '✕'; x_.setAttribute('aria-label', 'Close'); x_.addEventListener('click', npHide);
  head.append(title, x_); card.appendChild(head);
  if (quote) { const q = document.createElement('p'); q.className = 'quote'; q.textContent = '“' + (quote.length > 160 ? quote.slice(0, 160) + '…' : quote) + '”'; card.appendChild(q); }
  const ta = document.createElement('textarea'); ta.placeholder = placeholder; ta.setAttribute('aria-label', heading); card.appendChild(ta);
  const row = document.createElement('div'); row.className = 'row';
  const hint = document.createElement('span'); hint.className = 'hint'; hint.textContent = 'End with #tags · ⌘/Ctrl+Enter';
  const go = document.createElement('button'); go.type = 'button'; go.className = 'go'; go.textContent = saveLabel; go.disabled = true;
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
  const p = npClamp(x - 20, y + 10, 330); card.style.left = p.left + 'px'; card.style.top = p.top + 'px';
  root.appendChild(card);
  npWatchOutside(host, () => !!ta.value.trim());   // a click elsewhere does not throw away what is being typed
  ta.focus();
  return card;
}

function npToast(x, y, text) {
  const host = npEnsureHost(), t = document.createElement('div'); t.className = 'toast'; t.textContent = text; t.setAttribute('role', 'status');
  const p = npClamp(x - 20, y + 10, 90); t.style.left = p.left + 'px'; t.style.top = p.top + 'px';
  host._root.appendChild(t);
  setTimeout(() => { t.remove(); const h = document.getElementById(NP_ID); if (h && h._root && !h._root.querySelector('.bar, .card, .toast')) h.remove(); }, 1400);
}
