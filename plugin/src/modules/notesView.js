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
import { splitTags } from './noteText.js';

const store = createNotesStore();
const WIDE = 720;
export const FREE = '__free';   // the "no article" group in the By article pane
const getL = (keys) => new Promise((r) => chrome.storage.local.get(keys, r));
const $ = (id) => document.getElementById(id);

const state = { view: null, uiRef: null };            // the List/Grid choice is shared by every pane
const shared = { tag: '', article: '' };               // filters that every pane follows (a tag or an article picked in any pane)
const instances = new Set();                           // every mounted pane: the Notes screen itself, and Notes shown inside a split view
const lsGet = (k) => { try { return window.localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { window.localStorage.setItem(k, v); } catch (_) { /* private mode */ } };

// ── tiny DOM helpers ──
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function button(label, cls, onClick) { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', onClick); return b; }
const stripQuery = (u) => String(u || '').split('#')[0].split('?')[0];

export { splitTags };

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

export function filterStream(items, { filter = 'all', q = '', tag = '', article = '' } = {}) {
    const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((i) => {
        if (filter === 'mine' && i.kind !== 'user') return false;
        if (filter === 'ai' && i.kind !== 'ghost') return false;
        if (filter === 'notes' && i.kind !== 'note') return false;
        if (tag && !(i.tags || []).some((t) => t.toLowerCase() === tag.toLowerCase())) return false;
        if (article && (article === FREE ? !!i.source : !(i.source && i.source.id === article))) return false;
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
function sticky(item, inst) {
    const k = KIND()[item.kind];
    const card = el('article', 'st st-' + item.kind);
    const head = el('header'); const kind = el('span', 'st-kind'); kind.append(iconEl(k.icon), document.createTextNode(' ' + k.label)); head.append(kind, el('span', 'st-when', timeLabel(item.when)));
    card.append(head);
    card.append(el('p', item.kind === 'note' ? 'st-note-text' : 'st-q', item.text));
    if (item.kind === 'note' && item.quote) card.append(el('p', 'st-quote', '“' + item.quote + '”'));
    const editing = inst.editing === item.id;
    if (item.comment && !editing) { const c = el('p', 'st-c'); c.append(iconEl('message-square'), document.createTextNode(' ' + item.comment)); card.append(c); }
    if (editing) card.append(editor(item, inst));
    const foot = el('footer');
    if (item.source) { const a = button(item.source.title, 'st-src', () => { if (item.url && chrome.tabs && chrome.tabs.create) chrome.tabs.create({ url: item.url }); }); a.title = T('Open the page'); foot.append(a); }
    for (const t of item.tags || []) foot.append(button('#' + t, 'st-tag', () => { shared.tag = shared.tag === t ? '' : t; renderAll(); }));
    const actions = el('span', 'st-actions');
    if (!editing) {
        if (item.kind === 'note') {
            actions.append(button(T('Edit'), 'st-act', () => { inst.editing = item.id; render(inst); }));
            actions.append(button(T('Delete'), 'st-act st-del', async () => { if (!window.confirm(T('Delete this note?'))) return; await store.remove(item.id); renderAll(); }));
        } else actions.append(button(item.comment ? T('Edit comment') : T('Comment'), 'st-act', () => { inst.editing = item.id; render(inst); }));
    }
    foot.append(actions);
    card.append(foot);
    return card;
}

function editor(item, inst) {
    const box = el('div', 'st-edit');
    const ta = document.createElement('textarea'); ta.rows = 3; ta.className = 'st-ta'; ta.value = item.kind === 'note' ? item.text : (item.comment || '');
    ta.placeholder = item.kind === 'note' ? T('Write a note…') : T('Add a comment…'); ta.setAttribute('aria-label', ta.placeholder);
    const row = el('div', 'st-edit-row');
    const save = button(T('Save'), 'button-primary btn-sm', async () => {
        const { text, tags } = splitTags(ta.value);
        if (item.kind === 'note') await store.update(item.id, { text: text || item.text, tags: tags.length ? tags : item.tags });
        else await store.setComment(item.id, { text, tags: tags.length ? tags : item.tags, url: item.url });
        inst.editing = ''; renderAll();
    });
    const cancel = button(T('Cancel'), 'button-secondary btn-sm', () => { inst.editing = ''; render(inst); });
    if (item.kind !== 'note' && item.comment) row.append(button(T('Remove comment'), 'button-danger-outline btn-sm', async () => { await store.setComment(item.id, { text: '', tags: [] }); inst.editing = ''; renderAll(); }));
    row.append(cancel, save);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') { inst.editing = ''; render(inst); } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save.click(); });
    box.append(ta, row);
    setTimeout(() => ta.focus(), 0);
    return box;
}

// ── the panes ──
function viewMode() { return state.view || lsGet('aish.notesView') || ((window.innerWidth || 0) >= WIDE ? 'grid' : 'list'); }

async function load() {
    const [d, { notes, comments }] = await Promise.all([getL({ [SK.annotations]: [], [SK.articlesIndex]: [] }), store.list()]);
    return { notes, comments, highlights: Array.isArray(d[SK.annotations]) ? d[SK.annotations] : [], articles: Array.isArray(d[SK.articlesIndex]) ? d[SK.articlesIndex] : [] };
}

/** Which articles carry items, and how many of each kind: the By article pane. */
export function groupByArticle(all) {
    const g = new Map();
    for (const i of all) {
        const key = i.source ? i.source.id : FREE;
        const row = g.get(key) || { key, title: i.source ? i.source.title : '', site: i.source ? i.source.site : '', n: 0, mine: 0, ai: 0, notes: 0, newest: '' };
        row.n++; row[i.kind === 'user' ? 'mine' : i.kind === 'ghost' ? 'ai' : 'notes']++;
        if (String(i.when) > row.newest) row.newest = String(i.when);
        g.set(key, row);
    }
    return [...g.values()].sort((a, b) => String(b.newest).localeCompare(String(a.newest)));
}
export function tagCounts(all) {
    const counts = {}; for (const i of all) for (const t of i.tags || []) counts[t] = (counts[t] || 0) + 1;
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b)).map((t) => ({ tag: t, n: counts[t] }));
}

async function render(inst) {
    if (!inst || !inst.body) return;
    const token = ++inst.token;
    const data = await load();
    if (token !== inst.token) return;
    const all = buildStream(data);
    if (inst.mode === 'articles') return renderArticles(inst, all);
    if (inst.mode === 'tags') return renderTags(inst, all);
    const list = filterStream(all, { filter: inst.filter, q: inst.q, tag: shared.tag, article: shared.article });
    const mode = viewMode();
    const frag = document.createDocumentFragment();

    const top = tagCounts(all).slice(0, 8);
    if (top.length) { const row = el('div', 'notes-tags'); for (const t of top) { const b = button('#' + t.tag, 'mcp-chip' + (shared.tag === t.tag ? ' is-selected' : ''), () => { shared.tag = shared.tag === t.tag ? '' : t.tag; renderAll(); }); b.setAttribute('aria-pressed', String(shared.tag === t.tag)); row.append(b); } frag.append(row); }
    if (shared.article) { const a = all.find((i) => (i.source ? i.source.id : FREE) === shared.article); const row = el('div', 'notes-tags'); const b = button('✕ ' + (shared.article === FREE ? T('Notes without an article') : (a && a.source ? a.source.title : T('Article'))), 'mcp-chip is-selected', () => { shared.article = ''; renderAll(); }); row.append(b); frag.append(row); }

    if (!all.length) {
        const empty = el('div', 'notes-empty'); empty.append(el('p', null, T('No notes yet.')), el('p', 'mcp-row-hint', T('Write one below, or highlight text on any page. Your highlights and the AI’s show up here too.')));
        frag.append(empty);
    } else if (!list.length) frag.append(el('div', 'notes-empty', T('Nothing matches.')));
    else if (mode === 'grid') {
        const grid = el('div', 'notes-grid'); for (const i of list) grid.append(sticky(i, inst)); frag.append(grid);
    } else {
        let last = '';
        for (const i of list) {
            const day = dayKey(i.when);
            if (day !== last) { last = day; frag.append(el('p', 'settings-caption', TU(dayLabel(i.when)))); }
            frag.append(sticky(i, inst));
        }
    }
    inst.body.replaceChildren(frag);
    if (inst.toggle) inst.toggle.querySelectorAll('button').forEach((b) => { const on = b.dataset.view === mode; b.setAttribute('aria-checked', String(on)); b.classList.toggle('on', on); });
    if (inst.count) inst.count.textContent = list.length === all.length ? TN(all.length, '{n} item', '{n} items') : T('{a} of {b}', { a: list.length, b: all.length });
}

function renderArticles(inst, all) {
    const rows = groupByArticle(all), frag = document.createDocumentFragment();
    if (!rows.length) frag.append(el('div', 'notes-empty', T('Nothing here yet.')));
    for (const r of rows) {
        const b = button('', 'notes-row' + (shared.article === r.key ? ' is-selected' : ''), () => { shared.article = shared.article === r.key ? '' : r.key; renderAll(); });
        b.setAttribute('aria-pressed', String(shared.article === r.key));
        b.append(el('span', 'notes-row-title', r.key === FREE ? T('Notes without an article') : r.title), el('span', 'mcp-row-hint', [r.site, [r.mine && '✏️ ' + r.mine, r.ai && '✨ ' + r.ai, r.notes && '📝 ' + r.notes].filter(Boolean).join('  ')].filter(Boolean).join(' · ')));
        frag.append(b);
    }
    inst.body.replaceChildren(frag);
}

function renderTags(inst, all) {
    const rows = tagCounts(all), frag = document.createDocumentFragment();
    if (!rows.length) frag.append(el('div', 'notes-empty', T('No tags yet. End a note with #tag.')));
    const cloud = el('div', 'notes-tags notes-cloud');
    for (const r of rows) { const b = button('#' + r.tag, 'mcp-chip' + (shared.tag === r.tag ? ' is-selected' : ''), () => { shared.tag = shared.tag === r.tag ? '' : r.tag; renderAll(); }); b.append(el('small', null, ' ' + r.n)); b.setAttribute('aria-pressed', String(shared.tag === r.tag)); cloud.append(b); }
    frag.append(cloud);
    inst.body.replaceChildren(frag);
}

function renderAll() { for (const i of instances) render(i); }

/** Builds one pane in `root`. mode: 'stream' (the notes, with search and filters), 'articles' or 'tags'. `primary` panes carry the ids and the composer. */
export function createNotesPane(root, { mode = 'stream', primary = false, composer: withComposer = primary } = {}) {
    const inst = { root, mode, primary, filter: 'all', q: '', editing: '', token: 0, body: null, toggle: null, count: null };
    const id = (name) => (primary ? name : '');
    const withId = (e, name) => { if (primary && name) e.id = name; return e; };
    const head = el('div', 'notes-head');
    head.append(el('h2', null, mode === 'articles' ? T('By article') : mode === 'tags' ? T('Tags') : T('Notes')));
    const parts = [head];
    if (mode === 'stream') {
        const toggle = withId(el('div', 'a11y-seg notes-toggle'), id('notesViewToggle')); toggle.setAttribute('role', 'radiogroup'); toggle.setAttribute('aria-label', T('View'));
        for (const [v, label] of [['list', '☰ ' + T('List')], ['grid', '▦ ' + T('Grid')]]) {
            const b = button(label, '', () => { state.view = v; lsSet('aish.notesView', v); renderAll(); }); b.dataset.view = v; b.setAttribute('role', 'radio'); toggle.append(b);
        }
        head.append(toggle); inst.toggle = toggle;
        const bar = el('div', 'notes-bar');
        const search = withId(document.createElement('input'), id('notesSearch')); search.type = 'search'; search.className = 'notes-search'; search.placeholder = T('Search highlights, comments, notes…'); search.autocomplete = 'off'; search.setAttribute('aria-label', T('Search'));
        let t = 0; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { inst.q = search.value; render(inst); }, 120); });
        bar.append(search);
        const filters = el('div', 'notes-filters'); filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', T('Show'));
        for (const [fid, label] of [['all', T('Everything')], ['mine', T('Mine')], ['ai', T('AI')], ['notes', T('Notes')]]) {
            const b = button(label, 'mcp-chip' + (fid === 'all' ? ' is-selected' : ''), () => { inst.filter = fid; filters.querySelectorAll('button').forEach((x) => { x.classList.toggle('is-selected', x === b); x.setAttribute('aria-pressed', String(x === b)); }); render(inst); });
            b.setAttribute('aria-pressed', String(fid === 'all')); filters.append(b);
        }
        const count = withId(el('span', 'mcp-row-hint notes-count'), id('notesCount')); filters.append(count); inst.count = count;
        parts.push(bar, filters);
    }
    inst.body = withId(el('div', 'notes-body'), id('notesBody'));
    parts.push(inst.body);
    if (withComposer) parts.push(composerEl(primary));
    root.replaceChildren(...parts);
    instances.add(inst);
    render(inst);
    return inst;
}

/** Removes a pane (a split view that no longer shows it). */
export function destroyNotesPane(inst) { if (!inst) return; instances.delete(inst); if (inst.root) inst.root.replaceChildren(); }

/** The docked composer: the Summarize screen's own pill (field + primary button) above the nav, in thumb and mouse reach. */
function composerEl(primary) {
    const dock = el('div', 'controls-bar notes-dock notes-composer'); if (primary) dock.id = 'notesComposer';
    const card = el('div', 'input-card');
    const label = el('label', 'input-card-label', T('New note'));
    const hintRow = el('div', 'chip-row'); hintRow.append(el('span', 'notes-hint', T('End with #tags · ⌘/Ctrl+Enter to add')));
    const pill = el('div', 'composer-pill');
    const ta = document.createElement('textarea'); ta.rows = 1; ta.className = 'input-card-textarea'; ta.placeholder = T('Write a note, or a thought worth keeping…'); ta.setAttribute('aria-label', T('New note'));
    if (primary) { ta.id = 'notesInput'; label.htmlFor = 'notesInput'; }
    const add = button('', 'button-primary notes-add', async () => { await submit(); });
    add.append(iconEl('plus'), document.createTextNode(' '), el('span', null, T('Add')));
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(96, ta.scrollHeight) + 'px'; };
    async function submit() {
        const { text, tags } = splitTags(ta.value); if (!text) { ta.focus(); return; }
        add.disabled = true;
        try { await store.add({ text, tags }); ta.value = ''; grow(); renderAll(); } finally { add.disabled = false; }
    }
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); } else if (e.key === 'Escape') { ta.value = ''; grow(); ta.blur(); } });
    pill.append(ta, add);
    card.append(label, hintRow, pill);
    dock.append(card);
    return dock;
}

// ── wiring ──
let screenPane = null;
function build() { const root = $('notesRoot'); if (root && !screenPane) screenPane = createNotesPane(root, { mode: 'stream', primary: true }); }
export function onNotesScreenShown() { build(); renderAll(); }

// Split view: a pane choice in History or Feeds ("Notes"), and the Notes screen's own panes ("By article", "Tags").
const PANES = { history: { notes: 'historyNotesPane' }, feeds: { notes: 'feedsNotesPane' }, notes: { articles: 'notesArticlesPane', tags: 'notesTagsPane' } };
const mounted = new Map();
function onWorkspaceView(e) {
    const { scope, view, open } = e.detail || {};
    const id = PANES[scope] && PANES[scope][view]; if (!id) return;
    const root = $(id); if (!root) return;
    if (open && !mounted.has(id)) mounted.set(id, createNotesPane(root, { mode: view === 'notes' ? 'stream' : view, primary: false, composer: view === 'notes' }));
    if (!open && mounted.has(id)) { destroyNotesPane(mounted.get(id)); mounted.delete(id); }
}

export function initNotesView(ui) {
    state.uiRef = ui || null;
    build();
    document.addEventListener('aish:ws-view', onWorkspaceView);
    let timer = 0;
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (!(SK.annotations in changes || SK.notesIndex in changes || Object.keys(changes).some((k) => isNoteRecKey(k)) || SK.articlesIndex in changes)) return;
        if ([...instances].some((i) => i.editing)) return;   // not while someone is typing in a note
        const visible = document.body.dataset.screen === 'notes' || [...mounted.values()].length;
        if (!visible) return;
        clearTimeout(timer); timer = setTimeout(renderAll, 150);
    });
    window.addEventListener('resize', () => { if (!state.view && !lsGet('aish.notesView') && document.body.dataset.screen === 'notes') renderAll(); }, { passive: true });
}
