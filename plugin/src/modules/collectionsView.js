// collectionsView.js — the UI of collections: the "Add to collection" sheet, the Collections tab in History (list and
// detail), and the source check (profile + lateral-reading questions) that is shown both in a collection and inline in
// an article. Data lives in collections.js; nothing here calls a model.
import { T } from './feedI18n.js';
import { trapFocus } from './sheet.js';
import {
    MAX_SOURCES, SOURCE_TYPES, CHECK_QUESTIONS, listCollections, getCollection, createCollection, updateCollection, deleteCollection,
    addSource, removeSource, collectionsOfArticle, lastCollectionId, collectionArticles, effectiveProfile, profileHints, checkProgress,
    saveSourceProfile, saveSourceCheck, otherSourcesQuery, collectionMarkdown
} from './collections.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const btn = (label, cls, onClick) => { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', onClick); return b; };

const typeLabel = (id) => ({
    primary: T('Primary source'), secondary: T('Secondary source'), peer: T('Peer-reviewed'), preprint: T('Preprint'),
    news: T('News'), opinion: T('Opinion / blog'), official: T('Authority / agency'), other: T('Other')
}[id] || '');
const hintLabel = (id) => ({
    no_author: T('No author found'), no_date: T('No date found'), old: T('Older than 5 years'), preprint: T('Preprint, not peer reviewed')
}[id] || id);
const questionLabel = (id) => ({
    who: T('Who is behind this?'), others: T('What do other sources say about it?'),
    origin: T('Where does the claim come from?'), missing: T('What is missing?')
}[id] || id);

let toast = (m) => { try { console.info(m); } catch (_) { /* no console */ } };
let openArticle = () => {};
/** Wiring from articleManager: how to show a message, and how to open an article's detail view. */
export function initCollectionsView(deps = {}) {
    if (deps.toast) toast = deps.toast;
    if (deps.openArticle) openArticle = deps.openArticle;
}

// ── source check (profile + questions) ──────────────────────────────────────

/**
 * The reader's check of one source: profile (type, author, date, publisher), hints, four questions, a search link.
 * Saves as the reader types (on change). `onChange` runs after a save so callers can refresh counters.
 */
export function sourceCheckPanel(article, { question = '', onChange = () => {} } = {}) {
    const root = el('div', 'coll-check');
    const profile = effectiveProfile(article);
    const check = article.sourceCheck || {};

    const head = el('div', 'coll-check-head');
    const progress = el('span', 'coll-progress');
    head.append(el('strong', '', T('Source check')), progress);
    root.append(head, el('p', 'coll-note', T('Hints, not ratings: you decide how far to trust this source.')));

    // profile
    const grid = el('div', 'coll-profile');
    const field = (label, node) => { const l = el('label', 'coll-field'); l.append(el('span', '', label), node); return l; };
    const typeSel = el('select');
    typeSel.append(Object.assign(el('option', '', '—'), { value: '' }));
    SOURCE_TYPES.forEach(t => typeSel.append(Object.assign(el('option', '', typeLabel(t)), { value: t })));
    typeSel.value = profile.type;
    const author = Object.assign(el('input'), { type: 'text', value: profile.author, maxLength: 120 });
    const date = Object.assign(el('input'), { type: 'text', value: profile.date, maxLength: 10, placeholder: 'YYYY-MM-DD' });
    const publisher = Object.assign(el('input'), { type: 'text', value: profile.publisher, maxLength: 120 });
    grid.append(field(T('Type'), typeSel), field(T('Author'), author), field(T('Date'), date), field(T('Publisher'), publisher));
    const hints = el('ul', 'coll-hints');
    const paintHints = () => {
        hints.textContent = '';
        profileHints({ type: typeSel.value, author: author.value.trim(), date: date.value.trim() }).forEach(h => hints.append(el('li', '', hintLabel(h))));
    };
    paintHints();
    let saveTimer = null;
    const saveProfile = async () => {
        paintHints();
        await saveSourceProfile(article.id, { type: typeSel.value, author: author.value, date: date.value, publisher: publisher.value });
        onChange();
    };
    [typeSel, author, date, publisher].forEach(n => n.addEventListener('change', saveProfile));
    root.append(grid, hints);

    // lateral reading
    const answers = {};
    const paintProgress = () => {
        const p = checkProgress(answers);
        progress.textContent = T('{a} of {n} answered', { a: p.answered, n: p.total });
        progress.classList.toggle('is-done', p.done);
    };
    const qs = el('div', 'coll-questions');
    CHECK_QUESTIONS.forEach(q => {
        answers[q] = check[q] || '';
        const ta = Object.assign(el('textarea'), { rows: 2, maxLength: 2000, value: answers[q] });
        ta.setAttribute('aria-label', questionLabel(q));
        ta.addEventListener('input', () => {
            answers[q] = ta.value; paintProgress();
            clearTimeout(saveTimer);
            saveTimer = setTimeout(async () => { await saveSourceCheck(article.id, answers); onChange(); }, 500);
        });
        ta.addEventListener('blur', async () => { clearTimeout(saveTimer); await saveSourceCheck(article.id, answers); onChange(); });
        const l = el('label', 'coll-field coll-field--q'); l.append(el('span', '', questionLabel(q)), ta);
        qs.append(l);
    });
    paintProgress();
    root.append(qs);

    const search = el('a', 'button-secondary btn-sm coll-search', T('Find other sources about this'));
    search.href = otherSourcesQuery(article, question); search.target = '_blank'; search.rel = 'noopener noreferrer';
    root.append(search);
    return root;
}

/** "In collections: A, B" + add button, for the article detail. */
export async function collectionsStrip(article) {
    const root = el('div', 'coll-strip');
    const paint = async () => {
        root.textContent = '';
        const list = await collectionsOfArticle(article.id);
        root.append(el('span', 'coll-strip-label', list.length ? T('In collections:') : T('Not in a collection yet')));
        list.forEach(c => root.append(el('span', 'coll-chip', c.name)));
        root.append(btn(T('+ Add to collection'), 'button-secondary btn-sm', () => openAddSheet(article, { onDone: paint })));
    };
    await paint();
    return root;
}

// ── "Add to collection" sheet ───────────────────────────────────────────────

let sheet = null, sheetTrap = null;
const closeSheet = () => { if (sheetTrap) { sheetTrap.release(); sheetTrap = null; } if (sheet) { sheet.remove(); sheet = null; } };

/**
 * Pre-selects the collection used last (marked "last used"); the reader always sees where the pages go.
 * `target` is one article, a list of articles (History selection), or null: then it only creates a collection.
 */
export async function openAddSheet(target, { onDone = () => {} } = {}) {
    closeSheet();
    const items = Array.isArray(target) ? target.filter(Boolean) : target ? [target] : [];
    const article = items.length ? items[0] : null;
    const [all, last] = await Promise.all([listCollections(), lastCollectionId()]);
    // Without an article this is "New collection": only the form, nothing is added.
    let chosen = article && all.some(c => c.id === last) ? last : '';
    let creating = !article || all.length === 0;

    sheet = el('div', 'sendsheet');
    const scrim = el('div', 'sendsheet-scrim'); scrim.addEventListener('click', closeSheet);
    const panel = el('div', 'sendsheet-panel');
    const body = el('div', 'sendsheet-body');
    panel.append(el('div', 'sendsheet-grab'), body);
    sheet.append(scrim, panel);
    document.body.append(sheet);
    sheetTrap = trapFocus(panel, { label: T('Add to collection'), onEscape: closeSheet });

    const paint = () => {
        body.textContent = '';
        const head = el('div', 'sendsheet-head');
        head.append(el('div', 'sendsheet-title', article ? T('Add to collection') : T('New collection')), el('div', 'sendsheet-sub', article ? (items.length > 1 ? T('{n} articles', { n: items.length }) : (article.title || article.url || '')) : ''));
        body.append(head);
        const group = el('div', 'coll-pick'); group.setAttribute('role', 'radiogroup');
        (article ? all : []).forEach(c => {
            const r = el('button', 'sendsheet-row' + (chosen === c.id && !creating ? ' on' : ''));
            r.type = 'button'; r.setAttribute('role', 'radio'); r.setAttribute('aria-checked', String(chosen === c.id && !creating));
            const tx = el('span', 'sendsheet-row-tx');
            const t = el('span', 'sendsheet-row-t', c.name);
            if (c.id === last) t.append(' ', el('span', 'coll-badge', T('last used')));
            tx.append(t, el('span', 'sendsheet-row-s', c.question || T('{n} sources', { n: c.n })));
            r.append(tx, el('span', 'sendsheet-row-go', chosen === c.id && !creating ? '●' : '○'));
            r.addEventListener('click', () => { chosen = c.id; creating = false; paint(); });
            group.append(r);
        });
        body.append(group);
        let nameIn = null, qIn = null;
        if (creating) {
            const form = el('div', 'coll-new');
            nameIn = Object.assign(el('input'), { type: 'text', placeholder: T('Name of the collection'), maxLength: 80 });
            qIn = Object.assign(el('input'), { type: 'text', placeholder: T('Your question (optional)'), maxLength: 300 });
            nameIn.setAttribute('aria-label', T('Name of the collection')); qIn.setAttribute('aria-label', T('Your question (optional)'));
            form.append(nameIn, qIn);
            body.append(form);
            setTimeout(() => nameIn.focus(), 0);
        } else if (article) body.append(btn(T('+ New collection'), 'button-secondary', () => { creating = true; paint(); }));
        const msg = el('p', 'coll-note'); msg.hidden = true; msg.setAttribute('role', 'status');
        const actions = el('div', 'coll-actions');
        const add = btn(article ? T('Add') : T('Create'), 'button-primary', async () => {
            add.disabled = true;
            try {
                let id = chosen, name = (all.find(c => c.id === id) || {}).name;
                if (creating) {
                    const c = await createCollection({ name: nameIn.value, question: qIn.value });
                    id = c.id; name = c.name;
                }
                if (!article) { closeSheet(); onDone(id); return; }
                let added = 0, already = 0, full = false, missing = false;
                for (const a of items) {
                    const r = await addSource(id, a.id);
                    if (!r.ok) { if (r.reason === 'full') full = true; else missing = true; break; }
                    if (r.added) added++; else already++;
                }
                if (missing || (full && !added && !already)) {
                    msg.hidden = false;
                    msg.textContent = missing ? T('That collection no longer exists.') : T('This collection is full ({n} sources).', { n: MAX_SOURCES });
                    add.disabled = false; return;
                }
                closeSheet();
                if (full) toast(T('{a} added to “{name}”; the collection is full ({n} sources).', { a: added, name, n: MAX_SOURCES }));
                else if (items.length > 1) toast(T('{a} added to “{name}”', { a: added, name }));
                else toast(added ? T('Added to “{name}”', { name }) : T('Already in “{name}”', { name }));
                onDone(id);
            } catch (e) { msg.hidden = false; msg.textContent = String((e && e.message) || e); add.disabled = false; }
        });
        add.disabled = !creating && !chosen;
        if (creating) nameIn.addEventListener('input', () => { add.disabled = !nameIn.value.trim(); });
        if (creating) add.disabled = true;
        actions.append(add, btn(T('Cancel'), 'button-secondary', closeSheet));
        body.append(msg, actions);
    };
    paint();
}

// ── Collections tab (History) ───────────────────────────────────────────────

let openId = '';

/** Renders the tab into `host` (the history list element). `onCount(n)` lets the tab bar show the number. */
export async function renderCollectionsTab(host, { onCount = () => {} } = {}) {
    host.textContent = '';
    const list = await listCollections();
    onCount(list.length);
    if (openId && list.some(c => c.id === openId)) return renderDetail(host, openId, onCount);
    openId = '';
    const wrap = el('div', 'coll-list');
    const top = el('div', 'coll-toolbar');
    top.append(btn(T('+ New collection'), 'button-primary btn-sm', () => openCreate(host, onCount)));
    wrap.append(top);
    if (!list.length) {
        const empty = el('div', 'coll-empty');
        empty.append(el('p', '', T('A collection bundles saved articles under one question.')), el('p', 'coll-note', T('Open an article’s ⋯ menu and choose “Add to collection”, or start one here.')));
        wrap.append(empty);
    }
    list.forEach(c => {
        const card = el('button', 'coll-card'); card.type = 'button';
        card.append(el('strong', 'coll-card-t', c.name));
        if (c.question) card.append(el('span', 'coll-card-q', c.question));
        card.append(el('span', 'coll-card-n', T('{n} sources', { n: c.n })));
        card.addEventListener('click', () => { openId = c.id; renderCollectionsTab(host, { onCount }); });
        wrap.append(card);
    });
    host.append(wrap);
}

function openCreate(host, onCount) {
    openAddSheet(null, { onDone: (id) => { openId = id; renderCollectionsTab(host, { onCount }); } });
}

async function renderDetail(host, id, onCount) {
    const rec = await getCollection(id);
    if (!rec) { openId = ''; return renderCollectionsTab(host, { onCount }); }
    const articles = await collectionArticles(rec);
    host.textContent = '';
    const wrap = el('div', 'coll-detail');
    const top = el('div', 'coll-toolbar');
    top.append(btn('← ' + T('Collections'), 'button-secondary btn-sm', () => { openId = ''; renderCollectionsTab(host, { onCount }); }));
    top.append(btn(T('Export Markdown'), 'button-secondary btn-sm', async () => {
        const md = collectionMarkdown(rec, articles, {
            label: (k) => k.startsWith('type_') ? typeLabel(k.slice(5)) : k.startsWith('hint_') ? hintLabel(k.slice(5)) : k.startsWith('q_') ? questionLabel(k.slice(2))
                : ({ Collection: T('Collection'), sources: T('sources'), Untitled: T('Untitled'), Type: T('Type'), Author: T('Author'), Date: T('Date'), Publisher: T('Publisher'), 'Source check': T('Source check') }[k] || k),
        });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
        a.download = (rec.name || 'collection').replace(/[^\p{L}\p{N}]+/gu, '_').toLowerCase() + '.md';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }));
    top.append(btn(T('Delete collection'), 'button-secondary btn-sm coll-danger', async () => {
        if (!window.confirm(T('Delete the collection “{name}”? The articles stay in your history.', { name: rec.name }))) return;
        await deleteCollection(id); openId = ''; renderCollectionsTab(host, { onCount });
    }));
    wrap.append(top);

    const name = Object.assign(el('input', 'coll-name'), { type: 'text', value: rec.name, maxLength: 80 });
    name.setAttribute('aria-label', T('Name of the collection'));
    const q = Object.assign(el('textarea', 'coll-question'), { rows: 2, value: rec.question, maxLength: 300, placeholder: T('Your question (optional)') });
    q.setAttribute('aria-label', T('Your question (optional)'));
    name.addEventListener('change', async () => { if (name.value.trim()) await updateCollection(id, { name: name.value }); else name.value = rec.name; });
    q.addEventListener('change', async () => { await updateCollection(id, { question: q.value }); });
    wrap.append(name, q, el('p', 'coll-note', T('{n} of {max} sources', { n: articles.length, max: MAX_SOURCES })));

    if (!articles.length) wrap.append(el('p', 'coll-empty', T('No sources yet. Use “Add to collection” in an article’s ⋯ menu.')));
    articles.forEach(a => {
        const item = el('div', 'coll-source');
        const row = el('div', 'coll-source-row');
        const title = btn(a.title || a.url || T('Untitled'), 'coll-source-title', () => openArticle(a));
        const p = effectiveProfile(a);
        const facts = [p.type && typeLabel(p.type), p.author, p.date, p.publisher].filter(Boolean).join(' · ');
        const prog = checkProgress(a.sourceCheck);
        const meta = el('span', 'coll-source-meta', facts || T('No source details yet'));
        const status = el('span', 'coll-source-status' + (prog.done ? ' is-done' : ''), T('{a}/{n} checked', { a: prog.answered, n: prog.total }));
        const tx = el('div', 'coll-source-tx'); tx.append(title, meta, status);
        const toggle = btn(T('Check'), 'button-secondary btn-sm', () => {
            const open = item.querySelector('.coll-check');
            if (open) { open.remove(); toggle.setAttribute('aria-expanded', 'false'); return; }
            item.append(sourceCheckPanel(a, { question: rec.question, onChange: async () => {
                const fresh = (await collectionArticles({ sources: [{ articleId: a.id }] }))[0];
                if (fresh) { const pr = checkProgress(fresh.sourceCheck); status.textContent = T('{a}/{n} checked', { a: pr.answered, n: pr.total }); status.classList.toggle('is-done', pr.done); meta.textContent = [effectiveProfile(fresh).type && typeLabel(effectiveProfile(fresh).type), effectiveProfile(fresh).author, effectiveProfile(fresh).date, effectiveProfile(fresh).publisher].filter(Boolean).join(' · ') || T('No source details yet'); }
            } }));
            toggle.setAttribute('aria-expanded', 'true');
        });
        toggle.setAttribute('aria-expanded', 'false');
        const rm = btn('✕', 'button-secondary btn-sm coll-remove', async () => { await removeSource(id, a.id); renderCollectionsTab(host, { onCount }); });
        rm.title = T('Remove from collection'); rm.setAttribute('aria-label', T('Remove from collection'));
        row.append(tx, toggle, rm);
        item.append(row);
        wrap.append(item);
    });
    host.append(wrap);
}

/** Forget which collection was open (after a language change or reset). */
export function resetCollectionsView() { openId = ''; }
