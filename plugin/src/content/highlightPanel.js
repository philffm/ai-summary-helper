// content/highlightPanel.js
// On-page highlights panel + scrollbar ticks. Lives in a closed shadow root so page
// CSS cannot touch it. Names are prefixed `hlp` (the bundler shares one scope).

const HLP_ID = 'aish-hl-host';
let hlpOpen = false;
let hlpFilter = 'all';
let hlpLast = null;
let hlpBusy = false;   // a summary started from this panel is running

function hlpEsc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

const HLP_CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  .ticks { position: fixed; top: 0; right: 0; bottom: 0; width: 10px; z-index: 2147483640; pointer-events: none; }
  .tick { position: absolute; right: 1px; width: 8px; height: 3px; border-radius: 2px; pointer-events: auto; cursor: pointer; outline: 1px solid rgba(255,255,255,.9); box-shadow: 0 0 0 2px rgba(0,0,0,.45); }   /* a light and a dark rim: visible on any page colour */
  .tick.user { background: #eab308; } .tick.ghost { background: #0284c7; }
  .split { position: fixed; right: 16px; bottom: 16px; z-index: 2147483641; display: flex; align-items: stretch; border-radius: 999px; overflow: hidden;
    border: 1px solid #fde047; box-shadow: 0 4px 12px rgba(0,0,0,.18); }
  .pill { all: unset; box-sizing: border-box; background: #fef08a; color: #854d0e; padding: 7px 12px 7px 14px; font-size: 12px; font-weight: 700; cursor: pointer; }
  .sum { all: unset; box-sizing: border-box; background: #2563eb; color: #fff; padding: 7px 14px 7px 12px; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; }
  .sum[disabled] { opacity: .7; cursor: default; }
  .pill:focus-visible, .sum:focus-visible, .go:focus-visible { outline: 2px solid #1d4ed8; outline-offset: -2px; }
  .foot { display: flex; align-items: center; gap: 8px; margin-top: 4px; padding-top: 8px; border-top: 1px solid #e5e7eb; }
  .foot .meta { flex: 1; }
  .go { all: unset; box-sizing: border-box; cursor: pointer; background: #2563eb; color: #fff; border-radius: 999px; padding: 6px 14px; font-size: 12px; font-weight: 700; white-space: nowrap; }
  .go[disabled] { opacity: .7; cursor: default; }
  .panel { position: fixed; right: 16px; bottom: 56px; z-index: 2147483641; width: 340px; max-height: 60vh; overflow: auto; background: #fff; color: #111827;
    border: 1px solid #e5e7eb; border-radius: 14px; box-shadow: 0 12px 32px rgba(0,0,0,.22); padding: 12px; }
  .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-weight: 700; font-size: 14px; }
  .chips { display: flex; gap: 6px; margin-bottom: 8px; }
  .chip { border: 1px solid #d1d5db; background: #fff; border-radius: 999px; padding: 2px 10px; font-size: 12px; cursor: pointer; }
  .chip.on { background: #111827; color: #fff; border-color: #111827; }
  .item { border: 1px solid #e5e7eb; border-left-width: 5px; border-radius: 10px; padding: 8px 10px; margin-bottom: 8px; }
  .item.user { border-left-color: #a16207; } .item.ghost { border-left-color: #0284c7; } .item.lost { background: #fffbeb; border-left-color: #dc2626; }
  .q { font-size: 13px; line-height: 1.4; margin-bottom: 4px; } .meta { font-size: 11px; color: #6b7280; }
  .acts { display: flex; gap: 10px; margin-top: 6px; font-size: 12px; }
  .acts button { all: unset; cursor: pointer; font-weight: 600; color: #2563eb; } .acts .rm { color: #dc2626; }
  .hint { font-size: 12px; background: #fef3c7; border-radius: 8px; padding: 6px 8px; margin-bottom: 8px; }
  .hide { all: unset; cursor: pointer; font-size: 11px; color: #6b7280; text-decoration: underline; }
  .x { all: unset; cursor: pointer; color: #6b7280; font-size: 16px; }
  @media (prefers-color-scheme: dark) {
    .panel { background: #1f2937; color: #f3f4f6; border-color: #374151; } .item { border-color: #374151; } .chip { background: #1f2937; color: #f3f4f6; border-color: #4b5563; }
    .item.lost { background: #3b2f12; } .meta { color: #9ca3af; } .foot { border-color: #374151; }
    .item.user { border-left-color: #ca8a04; } .acts button { color: #93c5fd; } .acts .rm { color: #fca5a5; } .hide, .x { color: #9ca3af; }   /* readable on the dark panel (4.5:1 and up) */
  }
`;

let hlpEdit = '';      // id of the highlight whose comment is being edited ('' = none)
let hlpNoteOpen = false;   // the "note about this page" editor
const hlpDraft = {};   // typed but not saved text, so a refresh of the panel never loses it
const NP_PANEL_CSS = `
  .cmt { margin: 4px 0 2px; padding: 4px 8px; border-radius: 8px; background: #fffbeb; font-size: 12px; white-space: pre-wrap; }
  .cm-ta { width: 100%; resize: vertical; min-height: 54px; margin: 4px 0; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 8px; font: inherit; font-size: 12px; background: #fff; color: #111827; }
  .cm-row { display: flex; gap: 6px; justify-content: flex-end; }
  .cm-row button, .acts .cmb { all: unset; cursor: pointer; font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 999px; border: 1px solid #d1d5db; }
  .cm-row .primary { background: #2563eb; color: #fff; border-color: #2563eb; }
  .foot .link { all: unset; cursor: pointer; font-size: 12px; font-weight: 700; color: #2563eb; }
  @media (prefers-color-scheme: dark) { .foot .link { color: #93c5fd; } .cmt { background: #3b2f12; } .cm-ta { background: #111827; color: #f3f4f6; border-color: #374151; } .cm-row button, .acts .cmb { border-color: #374151; color: #f3f4f6; } }
`;

function hlpRoot() {
  let host = document.getElementById(HLP_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HLP_ID;
    host.setAttribute('data-aish-ui', '1');
    document.documentElement.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const st = document.createElement('style'); st.textContent = HLP_CSS + NP_PANEL_CSS; root.appendChild(st);
    const body = document.createElement('div'); body.className = 'wrap'; root.appendChild(body);
    host._body = body;
  }
  return host;
}

/**
 * items: [{ id, type: 'user'|'ghost', text, status: 'ok'|'ambiguous'|'lost', frac: 0..1|null }]
 * actions: { jump(id), remove(id), keep(id), reattach(id), pending() }
 */
export function hlpRender(items, actions) {
  hlpLast = { items, actions };
  const host = document.getElementById(HLP_ID);
  if (host && host._body) { const a = host._body.querySelector('.cm-ta'), b = host._body.querySelector('.nt-ta'); if (a) hlpDraft.comment = a.value; if (b) hlpDraft.note = b.value; }
  if (!items.length) { if (host) host.remove(); return; }
  const h = hlpRoot();
  const lost = items.filter(i => i.status === 'lost').length;
  const shown = items.filter(i => hlpFilter === 'all' || (hlpFilter === 'user' && i.type === 'user') || (hlpFilter === 'ghost' && i.type === 'ghost'));
  const pending = actions.pending && actions.pending();
  const ticks = items.filter(i => i.frac !== null).map(i => `<div class="tick ${i.type}" data-id="${hlpEsc(i.id)}" style="top:${(i.frac * 100).toFixed(2)}%" title="${hlpEsc(i.text.slice(0, 60))}"></div>`).join('');
  h._body.innerHTML = `
    <div class="ticks">${ticks}</div>
    <div class="split">
      <button class="pill" data-act="toggle" aria-label="Highlights on this page">✏️ ${items.length}${lost ? ` · ${lost} ⚠` : ''}</button>
      <button class="sum" data-act="summarize" ${hlpBusy ? 'disabled' : ''}>${hlpBusy ? '⏳ Summarizing…' : '✨ Summarize'}</button>
    </div>
    ${hlpOpen ? `<div class="panel">
      <div class="head"><span>Highlights on this page</span><button class="x" data-act="toggle" aria-label="Close">✕</button></div>
      <div class="chips">${['all', 'user', 'ghost'].map(f => `<button class="chip ${hlpFilter === f ? 'on' : ''}" data-filter="${f}">${{ all: 'All', user: 'Yours', ghost: 'AI' }[f]}</button>`).join('')}</div>
      ${pending ? '<div class="hint">Select the new text on the page, then press “Attach here”.</div>' : ''}
      ${shown.map(i => `<div class="item ${i.status === 'lost' ? 'lost' : i.type}">
        <div class="q">“${hlpEsc(i.text.length > 140 ? i.text.slice(0, 140) + '…' : i.text)}”</div>
        ${i.comment && hlpEdit !== i.id ? `<div class="cmt">💬 ${hlpEsc(i.comment)}</div>` : ''}
        ${hlpEdit === i.id ? `<textarea class="cm-ta" data-for="${hlpEsc(i.id)}" placeholder="Add a comment… (end with #tags)" aria-label="Comment">${hlpEsc(hlpDraft.comment !== undefined ? hlpDraft.comment : (i.comment || ''))}</textarea><div class="cm-row" data-id="${hlpEsc(i.id)}"><button data-act="ccancel">Cancel</button><button class="primary" data-act="csave">Save</button></div>` : ''}
        <div class="meta">${i.status === 'lost' ? 'Can’t find this on the page' : i.status === 'ambiguous' ? 'Text appears more than once: first match' : i.type === 'ghost' ? 'AI suggestion' : 'Your highlight'}</div>
        <div class="acts" data-id="${hlpEsc(i.id)}">
          ${i.status !== 'lost' ? '<button data-act="jump">Jump</button>' : '<button data-act="reattach">Re-attach</button>'}
          ${actions.comment && hlpEdit !== i.id ? `<button data-act="comment">${i.comment ? 'Edit comment' : 'Comment'}</button>` : ''}
          ${i.type === 'ghost' && i.status !== 'lost' ? '<button data-act="keep">Keep</button>' : ''}
          <button class="rm" data-act="remove">${i.type === 'ghost' ? 'Dismiss' : 'Remove'}</button>
        </div></div>`).join('') || '<div class="meta">Nothing here.</div>'}
      ${hlpNoteOpen ? `<textarea class="nt-ta cm-ta" placeholder="A note about this page… (end with #tags)" aria-label="Note about this page">${hlpEsc(hlpDraft.note || '')}</textarea><div class="cm-row"><button data-act="ncancel">Cancel</button><button class="primary" data-act="nsave">Save note</button></div>` : ''}
      ${actions.note || actions.openNotes ? `<div class="foot">${actions.note && !hlpNoteOpen ? '<button class="link" data-act="note">📝 Note about this page</button>' : ''}${actions.openNotes ? '<button class="link" data-act="opennotes">Open in Notes ›</button>' : ''}</div>` : ''}
      ${actions.hideSite ? `<div class="foot"><button class="hide" data-act="hidesite">Don’t show highlights on ${hlpEsc(location.hostname.replace(/^www\./, ''))}</button></div>` : ''}
      <div class="foot"><span class="meta">${items.filter(i => i.type === 'user').length ? `${items.filter(i => i.type === 'user').length} of your highlights become the focus` : 'Summarizes this page'}</span>
        <button class="go" data-act="summarize" ${hlpBusy ? 'disabled' : ''}>${hlpBusy ? '⏳ Summarizing…' : '✨ Summarize page'}</button></div>
    </div>` : ''}`;
  h._body.onclick = (e) => {
    const t = e.target.closest('[data-act],[data-filter],.tick');
    if (!t) return;
    e.stopPropagation();
    if (t.classList.contains('tick')) { actions.jump(t.dataset.id); return; }
    if (t.dataset.filter) { hlpFilter = t.dataset.filter; hlpRender(hlpLast.items, hlpLast.actions); return; }
    const act = t.dataset.act;
    if (act === 'toggle') { hlpOpen = !hlpOpen; hlpRender(hlpLast.items, hlpLast.actions); return; }
    if (act === 'hidesite') { if (actions.hideSite) actions.hideSite(); return; }
    if (act === 'summarize') {
      if (hlpBusy || !actions.summarize) return;
      hlpBusy = true; hlpRender(hlpLast.items, hlpLast.actions);
      Promise.resolve(actions.summarize()).catch(() => {}).finally(() => hlpSetBusy(false));
      return;
    }
    if (act === 'note') { hlpNoteOpen = true; hlpRender(hlpLast.items, hlpLast.actions); const ta = h._body.querySelector('.nt-ta'); if (ta) ta.focus(); return; }
    if (act === 'ncancel') { hlpNoteOpen = false; delete hlpDraft.note; hlpRender(hlpLast.items, hlpLast.actions); return; }
    if (act === 'nsave') { const ta = h._body.querySelector('.nt-ta'); const v = ta ? ta.value : ''; Promise.resolve(actions.note(v)).then((ok) => { if (ok !== false) { hlpNoteOpen = false; delete hlpDraft.note; } hlpRender(hlpLast.items, hlpLast.actions); }); return; }
    if (act === 'opennotes') { if (actions.openNotes) actions.openNotes(); return; }
    if (act === 'comment') { hlpEdit = t.parentElement.dataset.id; delete hlpDraft.comment; hlpRender(hlpLast.items, hlpLast.actions); const ta = h._body.querySelector('.cm-ta'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } return; }
    if (act === 'ccancel') { hlpEdit = ''; delete hlpDraft.comment; hlpRender(hlpLast.items, hlpLast.actions); return; }
    if (act === 'csave') { const id2 = t.parentElement.dataset.id, ta = h._body.querySelector('.cm-ta'); const v = ta ? ta.value : ''; Promise.resolve(actions.comment(id2, v)).then((ok) => { if (ok !== false) { hlpEdit = ''; delete hlpDraft.comment; } hlpRender(hlpLast.items, hlpLast.actions); }); return; }
    const id = t.parentElement.dataset.id;
    if (act === 'jump') actions.jump(id);
    else if (act === 'remove') actions.remove(id);
    else if (act === 'keep') actions.keep(id);
    else if (act === 'reattach') { actions.reattach(id); hlpRender(hlpLast.items, hlpLast.actions); }
  };
}

/** Called when a summary started from the panel is over (or was cancelled). */
export function hlpSetBusy(v) {
  hlpBusy = !!v;
  if (hlpLast) hlpRender(hlpLast.items, hlpLast.actions);
}
