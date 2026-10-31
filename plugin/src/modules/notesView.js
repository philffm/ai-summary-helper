// modules/notesView.js — the Notes tab: your notes, your highlights, the AI's highlights and the comments on them, newest first.
//   List (grouped by day) or Grid (sticky notes); the grid is the default from 720px. The composer is docked at the bottom, in
//   thumb and mouse reach, and opens upwards.
// Highlights live in hl:all and are only read here. A comment on a highlight is its own record in the notes store (see notesStore.js),
// so nothing on this tab rewrites the highlight array that page scripts write.
import { T, TN, TU } from './feedI18n.js';
import { SK, isNoteRecKey } from './storageKeys.js';
import { iconEl } from './icons.js';
import { createNotesStore } from './notesStore.js';
import { pageKeyForUrl } from './pageKey.js';

const store = createNotesStore();
const WIDE = 720;
const getL = (keys) => new Promise((r) => chrome.storage.local.get(keys, r));
const $ = (id) => document.getElementById(id);

const state = { view: null, filter: 'all', q: '', tag: '', editing: '', renderToken: 0, uiRef: null };
const lsGet = (k) => { try { return window.localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { window.localStorage.setItem(k, v); } catch (_) { /* private mode */ } };

// ── tiny DOM helpers ──
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function button(label, cls, onClick) { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', onClick); return b; }
const stripQuery = (u) => String(u || '').split('#')[0].split('?')[0];

/** Hashtags at the end of what was typed become tags: "Ask Anna #todo #inflation" → text + ['todo','inflation']. */
export function splitTags(input) {
    let text = String(input || '').trim(); const tags = [];
    for (;;) {
        const m = /(?:^|\s)#([\p{L}\p{N}_-]{1,40})\s*$/u.exec(text);
        if (!m) break;
        tags.unshift(m[1]); text = text.slice(0, m.index).trim();
    }
    return { text, tags };
}

/** The stream: notes and highlights together, newest first. Pure: everything it needs is passed in. */
export function buildStream({ notes, comments, highlights, articles }) {
    const byKey = new Map();
    for (const a of articles || []) { if (!a || !a.url) continue; const s = { id: a.id, title: a.title || a.url, site: (() => { try { return new URL(a.url).host.replace(/^www\./, ''); } catch (_) { return ''; } })() }; byKey.set(pageKeyForUrl(a.url), s); byKey.set(stripQuery(a.url), s); }
    const source = (url) => (url ? (byKey.get(url) || byKey.get(pageKeyForUrl(url)) || byKey.get(stripQuery(url)) || null) : null);
    const out = [];
    for (const n of notes || []) out.push({ kind: 'note', id: n.id, text: n.text, tags: n.tags || [], when: n.created, url: n.url || '', quote: n.quote || '', source: source(n.url) });
    for (const h of highlights || []) {
        if (!h || !h.id || !h.text || h.dismissed) continue;
        const c = comments && comments[h.id];
        out.push({ kind: h.type === 'ghost' ? 'ghost' : 'user', id: h.id, text: h.text, tags: (c && c.tags) || [], when: h.timestamp, url: h.url || '', comment: c ? c.text : '', source: source(h.url) });
    }
    return out.sort((a, b) => String(b.when).localeCompare(String(a.when)));
}

export function filterStream(items, { filter = 'all', q = '', tag = '' } = {}) {
    const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((i) => {
        if (filter === 'mine' && i.kind !== 'user') return false;
        if (filter === 'ai' && i.kind !== 'ghost') return false;
        if (filter === 'notes' && i.kind !== 'note') return false;
        if (tag && !(i.tags || []).some((t) => t.toLowerCase() === tag.toLowerCase())) return false;
        if (!words.length) return true;
        const hay = [i.text, i.comment, (i.tags || []).join(' '), i.source && i.source.title, i.source && i.source.site].filter(Boolean).join(' ').toLowerCase();
        return words.every((w) => hay.includes(w));
    });
}

const dayKey = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
function dayLabel(iso) {
    const d = new Date(iso); if (isNaN(d)) return '';
    const now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
    if (dayKey(d) === dayKey(now)) return T('Today');
    if (dayKey(d) === dayKey(y)) return T('Yesterday');
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}
const timeLabel = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : (dayKey(d) === dayKey(new Date()) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })); };

const KIND = () => ({ user: { icon: 'pencil', label: T('Highlight') }, ghost: { icon: 'sparkles', label: T('AI highlight') }, note: { icon: 'sticky-note', label: T('Note') } });

// ── one sticky ──
function sticky(item, rerender) {
    const k = KIND()[item.kind];
    const card = el('article', 'st st-' + item.kind);
    const head = el('header'); const kind = el('span', 'st-kind'); kind.append(iconEl(k.icon), document.createTextNode(' ' + k.label)); head.append(kind, el('span', 'st-when', timeLabel(item.when)));
    card.append(head);
    card.append(el('p', item.kind === 'note' ? 'st-note-text' : 'st-q', item.text));
    if (item.kind === 'note' && item.quote) card.append(el('p', 'st-quote', '“' + item.quote + '”'));
    const editing = state.editing === item.id;
    if (item.comment && !editing) { const c = el('p', 'st-c'); c.append(iconEl('message-square'), document.createTextNode(' ' + item.comment)); card.append(c); }
    if (editing) card.append(editor(item, rerender));
    const foot = el('footer');
    if (item.source) { const a = button(item.source.title, 'st-src', () => { if (item.url && chrome.tabs && chrome.tabs.create) chrome.tabs.create({ url: item.url }); }); a.title = T('Open the page'); foot.append(a); }
    for (const t of item.tags || []) foot.append(button('#' + t, 'st-tag', () => { state.tag = state.tag === t ? '' : t; render(); }));
    const actions = el('span', 'st-actions');
    if (!editing) {
        if (item.kind === 'note') {
            actions.append(button(T('Edit'), 'st-act', () => { state.editing = item.id; rerender(); }));
            actions.append(button(T('Delete'), 'st-act st-del', async () => { if (!window.confirm(T('Delete this note?'))) return; await store.remove(item.id); render(); }));
        } else actions.append(button(item.comment ? T('Edit comment') : T('Comment'), 'st-act', () => { state.editing = item.id; rerender(); }));
    }
    foot.append(actions);
    card.append(foot);
    return card;
}

function editor(item, rerender) {
    const box = el('div', 'st-edit');
    const ta = document.createElement('textarea'); ta.rows = 3; ta.className = 'st-ta'; ta.value = item.kind === 'note' ? item.text : (item.comment || '');
    ta.placeholder = item.kind === 'note' ? T('Write a note…') : T('Add a comment…'); ta.setAttribute('aria-label', ta.placeholder);
    const row = el('div', 'st-edit-row');
    const save = button(T('Save'), 'button-primary btn-sm', async () => {
        const { text, tags } = splitTags(ta.value);
        if (item.kind === 'note') await store.update(item.id, { text: text || item.text, tags: tags.length ? tags : item.tags });
        else await store.setComment(item.id, { text, tags: tags.length ? tags : item.tags, url: item.url });
        state.editing = ''; render();
    });
    const cancel = button(T('Cancel'), 'button-secondary btn-sm', () => { state.editing = ''; rerender(); });
    if (item.kind !== 'note' && item.comment) row.append(button(T('Remove comment'), 'button-danger-outline btn-sm', async () => { await store.setComment(item.id, { text: '', tags: [] }); state.editing = ''; render(); }));
    row.append(cancel, save);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') { state.editing = ''; rerender(); } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save.click(); });
    box.append(ta, row);
    setTimeout(() => ta.focus(), 0);
    return box;
}

// ── the screen ──
function viewMode() { return state.view || lsGet('aish.notesView') || ((window.innerWidth || 0) >= WIDE ? 'grid' : 'list'); }

async function load() {
    const [d, { notes, comments }] = await Promise.all([getL({ [SK.annotations]: [], [SK.articlesIndex]: [] }), store.list()]);
    return { notes, comments, highlights: Array.isArray(d[SK.annotations]) ? d[SK.annotations] : [], articles: Array.isArray(d[SK.articlesIndex]) ? d[SK.articlesIndex] : [] };
}

async function render() {
    const root = $('notesRoot'); if (!root) return;
    const token = ++state.renderToken;
    const data = await load();
    if (token !== state.renderToken) return;
    const all = buildStream(data);
    const list = filterStream(all, state);
    const mode = viewMode();

    const body = $('notesBody'); if (!body) return;
    const frag = document.createDocumentFragment();

    // tags in use (top few), as filter chips
    const counts = {}; for (const i of all) for (const t of i.tags || []) counts[t] = (counts[t] || 0) + 1;
    const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 8);
    if (top.length) { const row = el('div', 'notes-tags'); for (const t of top) { const b = button('#' + t, 'mcp-chip' + (state.tag === t ? ' is-selected' : ''), () => { state.tag = state.tag === t ? '' : t; render(); }); b.setAttribute('aria-pressed', String(state.tag === t)); row.append(b); } frag.append(row); }

    if (!all.length) {
        const empty = el('div', 'notes-empty'); empty.append(el('p', null, T('No notes yet.')), el('p', 'mcp-row-hint', T('Write one below, or highlight text on any page. Your highlights and the AI’s show up here too.')));
        frag.append(empty);
    } else if (!list.length) frag.append(el('div', 'notes-empty', T('Nothing matches.')));
    else if (mode === 'grid') {
        const grid = el('div', 'notes-grid'); for (const i of list) grid.append(sticky(i, render)); frag.append(grid);
    } else {
        let last = '';
        for (const i of list) {
            const day = dayKey(i.when);
            if (day !== last) { last = day; frag.append(el('p', 'settings-caption', TU(dayLabel(i.when)))); }
            frag.append(sticky(i, render));
        }
    }
    body.replaceChildren(frag);
    const toggle = $('notesViewToggle');
    if (toggle) toggle.querySelectorAll('button').forEach((b) => { const on = b.dataset.view === mode; b.setAttribute('aria-checked', String(on)); b.classList.toggle('on', on); });
    const count = $('notesCount'); if (count) count.textContent = list.length === all.length ? TN(all.length, '{n} item', '{n} items') : T('{a} of {b}', { a: list.length, b: all.length });
}

function build() {
    const root = $('notesRoot'); if (!root || $('notesBody')) return;
    const head = el('div', 'notes-head'); head.append(el('h2', null, T('Notes')));
    const toggle = el('div', 'a11y-seg notes-toggle'); toggle.id = 'notesViewToggle'; toggle.setAttribute('role', 'radiogroup'); toggle.setAttribute('aria-label', T('View'));
    for (const [v, label] of [['list', '☰ ' + T('List')], ['grid', '▦ ' + T('Grid')]]) {
        const b = button(label, '', () => { state.view = v; lsSet('aish.notesView', v); render(); }); b.dataset.view = v; b.setAttribute('role', 'radio'); toggle.append(b);
    }
    head.append(toggle);
    const bar = el('div', 'notes-bar');
    const search = document.createElement('input'); search.type = 'search'; search.id = 'notesSearch'; search.className = 'notes-search'; search.placeholder = T('Search highlights, comments, notes…'); search.autocomplete = 'off'; search.setAttribute('aria-label', T('Search'));
    let t = 0; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { state.q = search.value; render(); }, 120); });
    bar.append(search);
    const filters = el('div', 'notes-filters'); filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', T('Show'));
    for (const [id, label] of [['all', T('Everything')], ['mine', T('Mine')], ['ai', T('AI')], ['notes', T('Notes')]]) {
        const b = button(label, 'mcp-chip' + (id === 'all' ? ' is-selected' : ''), () => { state.filter = id; filters.querySelectorAll('button').forEach((x) => { x.classList.toggle('is-selected', x === b); x.setAttribute('aria-pressed', String(x === b)); }); render(); });
        b.setAttribute('aria-pressed', String(id === 'all')); filters.append(b);
    }
    const count = el('span', 'mcp-row-hint notes-count'); count.id = 'notesCount'; filters.append(count);
    const body = el('div', 'notes-body'); body.id = 'notesBody';
    root.replaceChildren(head, bar, filters, body, composer());
}

/** The docked composer: a slim bar that opens upwards. */
function composer() {
    const wrap = el('div', 'notes-composer'); wrap.id = 'notesComposer';
    const ta = document.createElement('textarea'); ta.id = 'notesInput'; ta.rows = 1; ta.className = 'notes-input'; ta.placeholder = T('Write a note…'); ta.setAttribute('aria-label', T('Write a note'));
    const hintRow = el('div', 'notes-composer-row');
    const hint = el('span', 'mcp-row-hint', T('End with #tags. ⌘/Ctrl+Enter to add.'));
    const add = button(T('Add'), 'button-primary btn-sm', async () => { await submit(); });
    hintRow.append(hint, add);
    const open = () => { wrap.classList.add('is-open'); ta.rows = 3; };
    const close = () => { if (!ta.value.trim()) { wrap.classList.remove('is-open'); ta.rows = 1; } };
    async function submit() {
        const { text, tags } = splitTags(ta.value); if (!text) { ta.focus(); return; }
        add.disabled = true;
        try { await store.add({ text, tags }); ta.value = ''; wrap.classList.remove('is-open'); ta.rows = 1; render(); } finally { add.disabled = false; }
    }
    ta.addEventListener('focus', open);
    ta.addEventListener('blur', () => setTimeout(() => { if (!wrap.contains(document.activeElement)) close(); }, 120));
    ta.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); } else if (e.key === 'Escape') { ta.value = ''; ta.blur(); close(); } });
    wrap.append(ta, hintRow);
    return wrap;
}

export function onNotesScreenShown() { build(); render(); }

export function initNotesView(ui) {
    state.uiRef = ui || null;
    build();
    let timer = 0;
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (!(SK.annotations in changes || SK.notesIndex in changes || Object.keys(changes).some((k) => isNoteRecKey(k)) || SK.articlesIndex in changes)) return;
        if (document.body.dataset.screen !== 'notes' || state.editing) return;   // not while someone is typing in a note
        clearTimeout(timer); timer = setTimeout(render, 150);
    });
    window.addEventListener('resize', () => { if (!state.view && !lsGet('aish.notesView') && document.body.dataset.screen === 'notes') render(); }, { passive: true });
}
