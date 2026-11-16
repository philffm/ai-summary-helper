// content/highlightPanel.js
// On-page highlights panel + scrollbar ticks + the ✏️ n | ✨ Summarize button. Lives in a shadow root so page CSS cannot touch it;
// the look comes from the design tokens in inPage.css (Figma AISH-039: Pill segmented filter, Note-card highlights, one Primary).
// Names are prefixed `hlp` (the bundler shares one scope).
import { ipsAttach } from './inPageStyles.js';

const HLP_ID = 'aish-hl-host';
let hlpOpen = false;
let hlpFilter = 'all';
let hlpLast = null;
let hlpBusy = false;   // a summary started from this panel is running

function hlpEsc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

let hlpEdit = '';      // id of the highlight whose comment is being edited ('' = none)
let hlpNoteOpen = false;   // the "note about this page" editor
const hlpDraft = {};   // typed but not saved text, so a refresh of the panel never loses it
function hlpRoot() {
  let host = document.getElementById(HLP_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HLP_ID;
    host.setAttribute('data-aish-ui', '1');
    document.documentElement.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const body = document.createElement('div'); body.className = 'hlp-wrap'; root.appendChild(body);
    host._body = body;
    ipsAttach(host, root);
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
  if (host && host._body) { const a = host._body.querySelector('.hlp-cm-ta'), b = host._body.querySelector('.hlp-nt-ta'); if (a) hlpDraft.comment = a.value; if (b) hlpDraft.note = b.value; }
  if (!items.length) { if (host) host.remove(); return; }
  const h = hlpRoot();
  const focusedAct = hlpFocusKey(h);
  const lost = items.filter(i => i.status === 'lost').length;
  const counts = { all: items.length, user: items.filter(i => i.type === 'user').length, ghost: items.filter(i => i.type === 'ghost').length };
  const shown = items.filter(i => hlpFilter === 'all' || (hlpFilter === 'user' && i.type === 'user') || (hlpFilter === 'ghost' && i.type === 'ghost'));
  const pending = actions.pending && actions.pending();
  const ticks = items.filter(i => i.frac !== null).map(i => `<div class="hlp-tick hlp-tick--${i.type}" data-id="${hlpEsc(i.id)}" style="top:${(i.frac * 100).toFixed(2)}%" title="${hlpEsc(i.text.slice(0, 60))}"></div>`).join('');
  const kind = (i) => i.status === 'lost' ? '⚠ Can’t find this on the page' : i.type === 'ghost' ? '✨ AI suggestion' : '✏️ Your highlight';
  const note = (i) => i.status === 'ambiguous' ? 'appears more than once' : '';
  const quote = (i) => '“' + hlpEsc(i.text.length > 140 ? i.text.slice(0, 140) + '…' : i.text) + '”';
  const btn = (act, label, cls = '') => `<button type="button" class="hlp-act${cls}" data-act="${act}">${label}</button>`;
  const card = (i) => `<article class="hlp-card hlp-card--${i.status === 'lost' ? 'lost' : i.type}" data-id="${hlpEsc(i.id)}" aria-label="${i.type === 'ghost' ? 'AI suggestion' : 'Your highlight'}">
        <header class="hlp-card-head"><span>${kind(i)}</span>${note(i) ? `<span class="hlp-card-note">${note(i)}</span>` : ''}</header>
        ${i.status !== 'lost' ? `<button type="button" class="hlp-q" data-act="jump" title="Jump to this text">${quote(i)}</button>` : `<p class="hlp-q">${quote(i)}</p>`}
        ${i.comment && hlpEdit !== i.id ? `<p class="hlp-cmt">💬 ${hlpEsc(i.comment)}</p>` : ''}
        ${hlpEdit === i.id ? `<textarea class="hlp-ta hlp-cm-ta" placeholder="Add a comment… (end with #tags)" aria-label="Comment">${hlpEsc(hlpDraft.comment !== undefined ? hlpDraft.comment : (i.comment || ''))}</textarea><div class="hlp-row">${btn('ccancel', 'Cancel', ' hlp-btn')}${btn('csave', 'Save', ' hlp-btn hlp-btn--primary')}</div>` : ''}
        <footer class="hlp-acts">
          ${i.status === 'lost' ? btn('reattach', 'Re-attach') : ''}
          ${actions.comment && hlpEdit !== i.id ? btn('comment', i.comment ? '💬 Edit comment' : '💬 Comment') : ''}
          <span class="hlp-acts-end">${i.type === 'ghost' && i.status !== 'lost' ? btn('keep', 'Keep') : ''}${btn('remove', i.type === 'ghost' ? 'Dismiss' : 'Remove', ' hlp-act--danger')}</span>
        </footer></article>`;
  const yours = counts.user;
  // eslint-disable-next-line no-unsanitized/property -- reviewed: labels are literals; highlight text, ids and comments go through hlpEsc
  h._body.innerHTML = `
    <div class="hlp-ticks">${ticks}</div>
    <div class="hlp-split">
      <button type="button" class="hlp-pill" data-act="toggle" aria-expanded="${hlpOpen}" aria-label="Highlights on this page: ${items.length}${lost ? `, ${lost} not found` : ''}">✏️ ${items.length}${lost ? ` · ${lost} ⚠` : ''}</button>
      <button type="button" class="hlp-sum" data-act="summarize" ${hlpBusy ? 'disabled' : ''} title="${yours ? `${yours} of your highlights become the focus` : 'Summarizes this page'}">${hlpBusy ? '⏳ Summarizing…' : '✨ Summarize'}</button>
    </div>
    ${hlpOpen ? `<section class="hlp-panel" role="dialog" aria-label="Highlights on this page">
      <header class="hlp-head"><h2>Highlights on this page</h2><button type="button" class="hlp-x" data-act="toggle" aria-label="Close highlights">✕</button></header>
      <div class="hlp-seg" role="radiogroup" aria-label="Show">${['all', 'user', 'ghost'].map(f => `<button type="button" role="radio" aria-checked="${hlpFilter === f}" tabindex="${hlpFilter === f ? 0 : -1}" class="${hlpFilter === f ? 'on' : ''}" data-filter="${f}">${{ all: 'All', user: 'Yours', ghost: 'AI' }[f]} · ${counts[f]}</button>`).join('')}</div>
      ${pending ? '<p class="hlp-hint" role="status">Select the new text on the page, then press “Attach here”.</p>' : ''}
      <div class="hlp-list">${shown.map(card).join('') || '<p class="hlp-meta">Nothing here.</p>'}</div>
      ${hlpNoteOpen ? `<textarea class="hlp-ta hlp-nt-ta" placeholder="A note about this page… (end with #tags)" aria-label="Note about this page">${hlpEsc(hlpDraft.note || '')}</textarea><div class="hlp-row">${btn('ncancel', 'Cancel', ' hlp-btn')}${btn('nsave', 'Save note', ' hlp-btn hlp-btn--primary')}</div>` : ''}
      ${(actions.note && !hlpNoteOpen) || actions.openNotes ? `<div class="hlp-foot">${actions.note && !hlpNoteOpen ? btn('note', '📝 Note about this page', ' hlp-ghost') : ''}${actions.openNotes ? btn('opennotes', 'Open in Notes ›', ' hlp-ghost') : ''}</div>` : ''}
      ${actions.hideSite ? `<button type="button" class="hlp-hide" data-act="hidesite">Don’t show highlights on ${hlpEsc(location.hostname.replace(/^www\./, ''))}</button>` : ''}
      <p class="hlp-meta hlp-sum-note">${yours ? `✨ Summarize: ${yours} of your highlights become the focus` : '✨ Summarize: summarizes this page'}</p>
    </section>` : ''}`;
  hlpRestoreFocus(h, focusedAct);
  h._body.onkeydown = (e) => {
    if (e.key === 'Escape' && hlpOpen) { e.stopPropagation(); hlpOpen = false; hlpRender(hlpLast.items, hlpLast.actions); const pill = h._body.querySelector('.hlp-pill'); if (pill) pill.focus(); return; }
    const r = e.target.closest && e.target.closest('[role=radio]');
    if (r && /^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
      e.preventDefault();
      const order = ['all', 'user', 'ghost'], step = /Right|Down/.test(e.key) ? 1 : -1;
      hlpFilter = order[(order.indexOf(r.dataset.filter) + step + order.length) % order.length];
      hlpRender(hlpLast.items, hlpLast.actions);
      const on = h._body.querySelector('[role=radio].on'); if (on) on.focus();
    }
  };
  h._body.onclick = (e) => {
    const t = e.target.closest('[data-act],[data-filter],.hlp-tick');
    if (!t) return;
    e.stopPropagation();
    if (t.classList.contains('hlp-tick')) { actions.jump(t.dataset.id); return; }
    if (t.dataset.filter) { hlpFilter = t.dataset.filter; hlpRender(hlpLast.items, hlpLast.actions); return; }
    const act = t.dataset.act;
    if (act === 'toggle') { hlpOpen = !hlpOpen; hlpRender(hlpLast.items, hlpLast.actions); const f = h._body.querySelector(hlpOpen ? '.hlp-x' : '.hlp-pill'); if (f) f.focus(); return; }
    if (act === 'hidesite') { if (actions.hideSite) actions.hideSite(); return; }
    if (act === 'summarize') {
      if (hlpBusy || !actions.summarize) return;
      hlpBusy = true; hlpRender(hlpLast.items, hlpLast.actions);
      Promise.resolve(actions.summarize()).catch(() => {}).finally(() => hlpSetBusy(false));
      return;
    }
    if (act === 'note') { hlpNoteOpen = true; hlpRender(hlpLast.items, hlpLast.actions); const ta = h._body.querySelector('.hlp-nt-ta'); if (ta) ta.focus(); return; }
    if (act === 'ncancel') { hlpNoteOpen = false; delete hlpDraft.note; hlpRender(hlpLast.items, hlpLast.actions); return; }
    if (act === 'nsave') { const ta = h._body.querySelector('.hlp-nt-ta'); const v = ta ? ta.value : ''; Promise.resolve(actions.note(v)).then((ok) => { if (ok !== false) { hlpNoteOpen = false; delete hlpDraft.note; } hlpRender(hlpLast.items, hlpLast.actions); }); return; }
    if (act === 'opennotes') { if (actions.openNotes) actions.openNotes(); return; }
    const id = (t.closest('[data-id]') || {}).dataset?.id;
    if (act === 'comment') { hlpEdit = id; delete hlpDraft.comment; hlpRender(hlpLast.items, hlpLast.actions); const ta = h._body.querySelector('.hlp-cm-ta'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } return; }
    if (act === 'ccancel') { hlpEdit = ''; delete hlpDraft.comment; hlpRender(hlpLast.items, hlpLast.actions); return; }
    if (act === 'csave') { const ta = h._body.querySelector('.hlp-cm-ta'); const v = ta ? ta.value : ''; Promise.resolve(actions.comment(id, v)).then((ok) => { if (ok !== false) { hlpEdit = ''; delete hlpDraft.comment; } hlpRender(hlpLast.items, hlpLast.actions); }); return; }
    if (act === 'jump') actions.jump(id);
    else if (act === 'remove') actions.remove(id);
    else if (act === 'keep') actions.keep(id);
    else if (act === 'reattach') { actions.reattach(id); hlpRender(hlpLast.items, hlpLast.actions); }
  };
}

// A re-render replaces the markup; keep keyboard focus on the same control (same action on the same highlight) when it still exists.
function hlpFocusKey(h) {
  const a = h.shadowRoot && h.shadowRoot.activeElement;
  if (!a || !a.dataset) return null;
  return { act: a.dataset.act || '', filter: a.dataset.filter || '', id: (a.closest('[data-id]') || { dataset: {} }).dataset.id || '' };
}
function hlpRestoreFocus(h, k) {
  if (!k || (!k.act && !k.filter)) return;
  const sel = k.filter ? `[data-filter="${k.filter}"]` : (k.id ? `[data-id="${CSS.escape(k.id)}"] [data-act="${k.act}"]` : `[data-act="${k.act}"]`);
  const el = h._body.querySelector(sel); if (el) el.focus({ preventScroll: true });
}

/** Called when a summary started from the panel is over (or was cancelled). */
export function hlpSetBusy(v) {
  hlpBusy = !!v;
  if (hlpLast) hlpRender(hlpLast.items, hlpLast.actions);
}
