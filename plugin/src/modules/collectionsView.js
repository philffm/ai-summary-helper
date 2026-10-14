// collectionsView.js — the UI of collections: the "Add to collection" sheet, the Collections tab in History (list and
// detail), and the source check (profile + lateral-reading questions) that is shown both in a collection and inline in
// an article. Data lives in collections.js; nothing here calls a model.
import { T } from './feedI18n.js';
import { trapFocus } from './sheet.js';
import StorageManager from './storageManager.js';
import { paperDoi, doiUrl } from './paperInfo.js';
import {
    MAX_SOURCES, SOURCE_TYPES, CHECK_QUESTIONS, listCollections, getCollection, createCollection, updateCollection, deleteCollection,
    addSource, removeSource, collectionsOfArticle, lastCollectionId, collectionArticles, effectiveProfile, profileHints, checkProgress,
    saveSourceProfile, saveSourceCheck, otherSourcesQuery, collectionMarkdown, saveOverview, parseOverview, rankCandidates, bumpStat, collectionWorksheet, displayTitle, profileFromCsl, mergeDoiProfile
} from './collections.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const btn = (label, cls, onClick) => { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', onClick); return b; };

export const typeLabel = (id) => ({
    primary: T('Primary source'), secondary: T('Secondary source'), peer: T('Peer-reviewed'), preprint: T('Preprint'),
    news: T('News'), opinion: T('Opinion / blog'), official: T('Authority / agency'), other: T('Other')
}[id] || '');
export const hintLabel = (id) => ({
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

// ── DOI → profile, automatically ────────────────────────────────────────────

const doiTried = new Set();   // one attempt per article and session (a failed lookup is not repeated on every open)

/**
 * When an article has a DOI, fills the EMPTY fields of its source profile (original title, authors, year, publisher, type) from
 * doi.org once. The cached record is used first; a lookup sends only the DOI. Never overwrites what the reader wrote.
 * Resolves to the new saved profile, or null when nothing changed.
 */
export async function autoFillFromDoi(article) {
    try {
        const doi = paperDoi(article);
        if (!article || !article.id || !doi || !doiUrl(doi)) return null;
        if (article.sourceProfile && article.sourceProfile.fromDoi) return null;
        if (doiTried.has(article.id)) return null;
        doiTried.add(article.id);
        const { ensureCsl } = await import('./citation.js');
        const csl = await ensureCsl(article, doi);
        const merged = mergeDoiProfile(article.sourceProfile, profileFromCsl(csl));
        if (!merged) return null;
        await saveSourceProfile(article.id, merged);
        bumpStat('profile_from_doi_auto').catch(() => {});
        return merged;
    } catch (_) { return null; }
}

// ── source check (profile + questions) ──────────────────────────────────────

/**
 * The reader's check of one source: profile (type, author, date, publisher), hints, four questions, a search link.
 * Saves as the reader types (on change). `onChange` runs after a save so callers can refresh counters.
 */
export function sourceCheckPanel(article, { question = '', onChange = () => {}, origin = 'collection', bare = false } = {}) {
    const root = el('div', 'coll-check');
    const profile = effectiveProfile(article);
    const check = article.sourceCheck || {};
    let counted = CHECK_QUESTIONS.some(q => String(check[q] || '').trim());   // 'check_started_<origin>' counts the first answer once
    const countStart = () => { if (!counted && CHECK_QUESTIONS.some(q => String(answers[q] || '').trim())) { counted = true; bumpStat('check_started_' + origin).catch(() => {}); } };

    const head = el('div', 'coll-check-head');
    const progress = el('span', 'coll-progress');
    head.append(el('strong', '', T('Source check')), progress);
    if (!bare) root.append(head);   // bare: the host (the source card) already has the title and the progress
    root.append(el('p', 'coll-note', T('Hints, not ratings: you decide how far to trust this source.')));

    // profile
    const grid = el('div', 'coll-profile');
    const field = (label, node) => { const l = el('label', 'coll-field coll-field--row'); l.append(el('span', '', label), node); return l; };
    const typeSel = el('select');
    typeSel.append(Object.assign(el('option', '', '—'), { value: '' }));
    SOURCE_TYPES.forEach(t => typeSel.append(Object.assign(el('option', '', typeLabel(t)), { value: t })));
    typeSel.value = profile.type;
    const author = Object.assign(el('input'), { type: 'text', value: profile.author, maxLength: 120 });
    const date = Object.assign(el('input'), { type: 'text', value: profile.date, maxLength: 10, placeholder: 'YYYY-MM-DD' });
    const publisher = Object.assign(el('input'), { type: 'text', value: profile.publisher, maxLength: 120 });
    const titleIn = Object.assign(el('input'), { type: 'text', value: (article.sourceProfile && article.sourceProfile.title) || '', maxLength: 300, placeholder: article.title || '' });
    const doiIn = Object.assign(el('input'), { type: 'text', value: paperDoi(article) || '', maxLength: 120, placeholder: '10.xxxx/…' });
    grid.append(field(T('Original title'), titleIn), field(T('DOI'), doiIn), field(T('Type'), typeSel), field(T('Author'), author), field(T('Date'), date), field(T('Publisher'), publisher));
    const hints = el('ul', 'coll-hints');
    const paintHints = () => {
        hints.textContent = '';
        profileHints({ type: typeSel.value, author: author.value.trim(), date: date.value.trim() }).forEach(h => hints.append(el('li', '', hintLabel(h))));
    };
    paintHints();
    let fromDoi = !!(article.sourceProfile && article.sourceProfile.fromDoi);
    let saveTimer = null;
    const saveProfile = async () => {
        paintHints();
        await saveSourceProfile(article.id, { type: typeSel.value, author: author.value, date: date.value, publisher: publisher.value, title: titleIn.value, fromDoi });
        onChange();
    };
    [typeSel, author, date, publisher, titleIn].forEach(n => n.addEventListener('change', saveProfile));
    // Fill the profile from the DOI (doi.org; only the DOI is sent). The reader's typed DOI is kept on the article.
    const fillMsg = el('p', 'coll-note'); fillMsg.hidden = true; fillMsg.setAttribute('role', 'status');
    const fill = btn(T('Fill from DOI'), 'button-secondary btn-sm coll-fill', async () => {
        const doi = doiIn.value.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
        if (!doiUrl(doi)) { fillMsg.hidden = false; fillMsg.textContent = T('Enter a valid DOI first.'); return; }
        fill.disabled = true; fillMsg.hidden = false; fillMsg.textContent = T('Looking up…');
        try {
            const { fetchCsl } = await import('./citation.js');
            const csl = await fetchCsl(doi);
            if (paperDoi(article) !== doi) await StorageManager.savePaperInfo(article.id, { doi, csl });
            else await StorageManager.savePaperInfo(article.id, { csl });
            fromDoi = true;
            const p = profileFromCsl(csl);
            if (p.title) titleIn.value = p.title;
            if (p.author) author.value = p.author;
            if (p.date) date.value = p.date;
            if (p.publisher) publisher.value = p.publisher;
            if (p.type) typeSel.value = p.type;
            await saveProfile(); paintSearch();
            bumpStat('profile_from_doi').catch(() => {});
            fillMsg.textContent = T('Filled from doi.org. Check and change anything.');
        } catch (e) { fillMsg.textContent = T('Citation lookup failed — try again'); } finally { fill.disabled = false; }
    });
    root.append(grid, fill, fillMsg, hints);
    // The search link uses the source's own title (the one in the field), not the AI headline.
    function paintSearch() { search.href = otherSourcesQuery({ ...article, sourceProfile: { ...(article.sourceProfile || {}), title: titleIn.value } }, question); }
    titleIn.addEventListener('input', () => paintSearch());
    // A DOI is known and the profile was never filled from it: do it now, for the fields still empty (the reader's input stays).
    autoFillFromDoi(article).then((p) => {
        if (!p || !root.isConnected) return;
        // p = the saved profile: the reader's own entries plus what the DOI added; it replaces the guessed values in the fields.
        if (p.title) titleIn.value = p.title; if (p.author) author.value = p.author; if (p.date) date.value = p.date; if (p.publisher) publisher.value = p.publisher;
        if (p.type) typeSel.value = p.type;
        fromDoi = true; paintHints(); paintSearch(); onChange();
    });

    // lateral reading
    const answers = {};
    const paintProgress = () => {
        const p = checkProgress(answers);
        progress.textContent = T('{a} of {n} answered', { a: p.answered, n: p.total });
        progress.classList.toggle('is-done', p.done);
    };
    const qs = el('div', 'coll-questions');
    const marks = {};
    CHECK_QUESTIONS.forEach(q => {
        answers[q] = check[q] || '';
        const ta = Object.assign(el('textarea'), { rows: 2, maxLength: 2000, value: answers[q] });
        ta.setAttribute('aria-label', questionLabel(q));
        ta.addEventListener('input', () => {
            answers[q] = ta.value; paintProgress(); paintMarks();
            clearTimeout(saveTimer);
            saveTimer = setTimeout(async () => { await saveSourceCheck(article.id, answers); countStart(); onChange(); }, 500);
        });
        ta.addEventListener('blur', async () => { clearTimeout(saveTimer); await saveSourceCheck(article.id, answers); countStart(); onChange(); });
        const d = el('details', 'coll-q');
        const sm = el('summary', 'coll-q-sum');
        const mark = el('span', 'coll-q-mark', '✓'); mark.setAttribute('aria-hidden', 'true');
        marks[q] = mark;
        sm.append(mark, el('span', 'coll-q-t', questionLabel(q)));
        d.append(sm, ta);
        d.open = !answers[q] && !CHECK_QUESTIONS.slice(0, CHECK_QUESTIONS.indexOf(q)).some(x => !answers[x]);
        qs.append(d);
    });
    function paintMarks() { CHECK_QUESTIONS.forEach(q => marks[q].classList.toggle('on', !!String(answers[q] || '').trim())); }
    paintMarks();
    paintProgress();
    root.append(qs);
    root.getProgress = () => checkProgress(answers);

    const search = el('a', 'button-secondary btn-sm coll-search', '🔍 ' + T('Find other sources about this'));
    paintSearch(); search.target = '_blank'; search.rel = 'noopener noreferrer';
    root.append(search);
    return root;
}

/** "In collections: A, B" + add button, for the article detail. */
export async function collectionsStrip(article) {
    const root = el('div', 'coll-strip');
    const paint = async () => {
        root.textContent = '';
        const list = await collectionsOfArticle(article.id);
        root.append(el('span', 'coll-strip-label', list.length ? T('In') : T('Not in a collection yet')));
        list.forEach(c => root.append(el('span', 'coll-chip', c.name)));
        const plus = btn('＋', 'coll-plus', () => openAddSheet(article, { onDone: paint }));
        plus.title = T('Add to collection'); plus.setAttribute('aria-label', T('Add to collection'));
        root.append(plus);
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
            const dot = el('span', 'coll-radio'); dot.setAttribute('aria-hidden', 'true');
            r.append(tx, dot);
            r.addEventListener('click', () => { chosen = c.id; creating = false; paint(); });
            group.append(r);
        });
        body.append(group);
        if (article && !creating && last && all.some(c => c.id === last)) body.append(el('p', 'coll-note coll-hint', T('Pre-selected: the collection you used last. You can change it.')));
        let nameIn = null, qIn = null;
        if (creating) {
            const form = el('div', 'coll-new');
            nameIn = Object.assign(el('input'), { type: 'text', placeholder: T('Name of the collection'), maxLength: 80 });
            qIn = Object.assign(el('input'), { type: 'text', placeholder: T('Your question (optional)'), maxLength: 300 });
            nameIn.setAttribute('aria-label', T('Name of the collection')); qIn.setAttribute('aria-label', T('Your question (optional)'));
            form.append(nameIn, qIn);
            body.append(form);
            setTimeout(() => nameIn.focus(), 0);
        } else if (article) body.append(btn('＋ ' + T('New collection'), 'coll-newrow', () => { creating = true; paint(); }));
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
                bumpStat(!creating && id === last ? 'add_lastused_kept' : 'add_other').catch(() => {});
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
                items.forEach(a => { autoFillFromDoi(a); });   // titles and authors from the DOI, in the background
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
        actions.append(btn(T('Cancel'), 'button-secondary', closeSheet), add);
        body.append(msg, actions);
    };
    paint();
}

// ── Add sources from inside a collection ────────────────────────────────────

/** Picker: choose saved articles (with search) and add them to `rec` without leaving the collection. */
export async function openPickSheet(rec, { onDone = () => {} } = {}) {
    closeSheet();
    const all = (await StorageManager.getArticlesIndex()) || [];
    const have = new Set(rec.sources.map(x => x.articleId));
    const ranked = rankCandidates(all.filter(a => !have.has(a.id)), rec, await collectionArticles(rec));
    const room = Math.max(0, MAX_SOURCES - rec.sources.length);
    const picked = new Set();
    sheet = el('div', 'sendsheet');
    const scrim = el('div', 'sendsheet-scrim'); scrim.addEventListener('click', closeSheet);
    const panel = el('div', 'sendsheet-panel');
    const body = el('div', 'sendsheet-body');
    panel.append(el('div', 'sendsheet-grab'), body);
    sheet.append(scrim, panel);
    document.body.append(sheet);
    sheetTrap = trapFocus(panel, { label: T('Add sources'), onEscape: closeSheet });
    const head = el('div', 'sendsheet-head');
    head.append(el('div', 'sendsheet-title', T('Add sources')), el('div', 'sendsheet-sub', T('{n} of {max} sources', { n: rec.sources.length, max: MAX_SOURCES })));
    const search = Object.assign(el('input', 'coll-search-in'), { type: 'search', placeholder: T('Search') });
    search.setAttribute('aria-label', T('Search'));
    const list = el('div', 'coll-pick coll-pick--scroll');
    const msg = el('p', 'coll-note'); msg.setAttribute('role', 'status');
    const add = btn('', 'button-primary', async () => {
        add.disabled = true;
        let n = 0;
        for (const id of picked) { const r = await addSource(rec.id, id); if (!r.ok) break; if (r.added) n++; }
        closeSheet();
        toast(T('{a} added to “{name}”', { a: n, name: rec.name }));
        onDone();
    });
    const sync = () => {
        add.textContent = T('Add') + (picked.size ? ' (' + picked.size + ')' : '');
        add.disabled = !picked.size;
        msg.textContent = room - picked.size <= 0 ? T('This collection is full ({n} sources).', { n: MAX_SOURCES }) : '';
    };
    const paint = () => {
        list.textContent = '';
        const q = search.value.trim().toLowerCase();
        const hits = ranked.filter(x => !q || ((x.a.title || '') + ' ' + (x.a.url || '')).toLowerCase().includes(q)).slice(0, 80);
        if (!hits.length) list.append(el('p', 'coll-note', T('No sources match.')));
        if (!q && hits.some(x => x.score > 0)) list.append(el('p', 'coll-note coll-pick-h', T('Suggested: fits your sources')));
        let sepDone = false;
        hits.forEach(({ a, score }) => {
            if (!q && !sepDone && score === 0 && hits[0].score > 0) { sepDone = true; list.append(el('p', 'coll-note coll-pick-h', T('Other saved articles'))); }
            const on = picked.has(a.id);
            const r = el('button', 'sendsheet-row' + (on ? ' on' : '')); r.type = 'button';
            r.setAttribute('role', 'checkbox'); r.setAttribute('aria-checked', String(on));
            const tx = el('span', 'sendsheet-row-tx');
            let host = ''; try { host = new URL(a.url).hostname; } catch (_) { /* no url */ }
            tx.append(el('span', 'sendsheet-row-t', a.title || a.url || T('Untitled')), el('span', 'sendsheet-row-s', host));
            const dot = el('span', 'coll-radio coll-radio--box'); dot.setAttribute('aria-hidden', 'true');
            r.append(tx, dot);
            r.addEventListener('click', () => {
                if (picked.has(a.id)) picked.delete(a.id); else if (picked.size < room) picked.add(a.id);
                paint(); sync();
            });
            list.append(r);
        });
    };
    search.addEventListener('input', paint);
    const actions = el('div', 'coll-actions'); actions.append(btn(T('Cancel'), 'button-secondary', closeSheet), add);
    body.append(head, search, list, msg, actions);
    paint(); sync();
    setTimeout(() => search.focus(), 0);
}

// ── AI overview of a collection (summaries only) ────────────────────────────

const overviewLabel = (k) => ({ agree: T('Agree'), disagree: T('Disagree'), missing: T('Missing') }[k] || '');

/**
 * Card at the top of a collection: agree / disagree / missing across the sources, written from their stored summaries only
 * (never the full texts). Stored on the collection; marked as out of date when the sources changed since.
 */
function overviewCard(rec, articles, repaint) {
    const card = el('div', 'coll-overview');
    const withSummary = articles.filter(a => String(a.summary || a.snippet || '').trim());
    const byId = new Map(articles.map(a => [a.id, a]));
    const head = el('div', 'coll-overview-head');
    head.append(el('strong', '', '✨ ' + T('Overview')));
    card.append(head);
    const run = async (btnEl) => {
        btnEl.disabled = true; msg.hidden = false; msg.textContent = T('Reading {n} summaries…', { n: withSummary.length });
        try {
            const { askCluster } = await import('./feedAi.js');
            const r = await askCluster(withSummary.map(a => ({ ...a, title: displayTitle(a) })), { topic: rec.name, question: rec.question, layout: 'compare' });
            await saveOverview(rec.id, { text: r.text, ids: r.articles.map(a => a.id), used: r.used });
            bumpStat('overview_created').catch(() => {});
            repaint();
        } catch (e) {
            btnEl.disabled = false; msg.hidden = false; msg.textContent = String((e && e.message) || e);
        }
    };
    const msg = el('p', 'coll-note'); msg.hidden = true; msg.setAttribute('role', 'status');
    const ov = rec.overview;
    if (!ov || !ov.text) {
        card.append(el('p', 'coll-note', T('Compare what your sources say: where they agree, disagree and what is missing.')));
        const go = btn(T('Create overview'), 'button-primary', () => run(go));
        go.disabled = withSummary.length < 2;
        card.append(go);
        card.append(el('p', 'coll-note', withSummary.length < 2 ? T('Needs at least 2 sources with a summary.')
            : T('Sends your question and {n} summaries to your AI model. Full texts stay on your device.', { n: withSummary.length })), msg);
        return card;
    }
    head.append(el('span', 'coll-pill', T('From summaries')));
    const cited = (ov.ids || []).map(id => { const a = byId.get(id); return a ? { ...a, title: displayTitle(a) } : { title: T('Untitled') }; });
    parseOverview(ov.text).forEach(s => {
        const sec = el('div', 'coll-ov-sec coll-ov-' + (s.key || 'plain'));
        if (s.key) sec.append(el('span', 'coll-pill coll-ov-pill', overviewLabel(s.key)));
        const body = el('div', 'coll-ov-body md-body'); sec.append(body);
        card.append(sec);
        import('./qaView.js').then(({ renderAnswer }) => import('./graphClusters.js').then(({ linkCitations }) => { renderAnswer(body, s.body); linkCitations(body, cited, (a) => { if (a && a.id) openArticle(a); }); })).catch(() => { body.textContent = s.body; });
    });
    const stale = JSON.stringify(articles.map(a => a.id).sort()) !== JSON.stringify((ov.ids || []).slice().sort());
    const foot = el('div', 'coll-ov-foot');
    foot.append(btn(T('Refresh'), 'button-secondary btn-sm', function () { run(this); }));
    card.append(foot, msg);
    card.append(el('p', 'coll-note', T('Not checked against the full texts.') + ' ' + T('Created {d}, {n} sources.', { d: new Date(ov.at).toLocaleDateString(), n: ov.used || (ov.ids || []).length })
        + (stale ? ' ' + T('The sources changed since — refresh.') : '')));
    return card;
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
    const top = el('div', 'coll-toolbar coll-toolbar--head');
    const plus = btn('＋', 'coll-plus coll-plus--lg', () => openCreate(host, onCount));
    plus.title = T('New collection'); plus.setAttribute('aria-label', T('New collection'));
    top.append(el('h3', 'coll-h', T('Collections')), plus);
    wrap.append(top);
    let searchIn = null;
    if (list.length > 3) {
        searchIn = Object.assign(el('input', 'coll-search-in'), { type: 'search', placeholder: T('Search') });
        searchIn.setAttribute('aria-label', T('Search'));
        wrap.append(searchIn);
    }
    if (!list.length) {
        const empty = el('div', 'coll-empty coll-empty--card');
        empty.append(el('div', 'coll-empty-ic', '🗂'), el('strong', '', T('A collection bundles saved articles under one question.')), el('p', 'coll-note', T('Open an article’s ⋯ menu and choose “Add to collection”, or start one here.')), btn(T('New collection'), 'button-primary', () => openCreate(host, onCount)));
        wrap.append(empty);
    }
    list.forEach(c => {
        const card = el('button', 'coll-card'); card.type = 'button';
        const top2 = el('span', 'coll-card-top');
        top2.append(el('strong', 'coll-card-t', c.name), el('span', 'coll-card-go', '›'));
        card.append(top2);
        if (c.question) card.append(el('span', 'coll-card-q', c.question));
        const pills = el('span', 'coll-card-pills');
        const upd = c.updated ? new Date(c.updated).toLocaleDateString() : '';
        const cnt = el('span', 'coll-card-n', [T('{n} sources', { n: c.n }), upd && T('updated {d}', { d: upd })].filter(Boolean).join(' · '));
        card.append(pills, cnt);
        getCollection(c.id).then(r => r && collectionArticles(r)).then(arts => {
            if (!arts || !card.isConnected) return;
            const types = [...new Set(arts.map(a => effectiveProfile(a).type).filter(Boolean))].slice(0, 3);
            types.forEach(t => pills.append(el('span', 'coll-pill', typeLabel(t))));
            const done = arts.filter(a => checkProgress(a.sourceCheck).done).length;
            if (arts.length) pills.append(el('span', 'coll-pill' + (done === arts.length ? ' is-done' : ' is-open'), T('{a} of {n} checked', { a: done, n: arts.length })));
        }).catch(() => {});
        card.addEventListener('click', () => { openId = c.id; renderCollectionsTab(host, { onCount }); });
        card.dataset.q = (c.name + ' ' + (c.question || '')).toLowerCase();
        wrap.append(card);
    });
    if (searchIn) searchIn.addEventListener('input', () => {
        const q = searchIn.value.trim().toLowerCase();
        wrap.querySelectorAll('.coll-card').forEach(cd => { cd.hidden = !!q && !cd.dataset.q.includes(q); });
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
    const top = el('div', 'coll-toolbar coll-toolbar--sub');
    top.append(btn('← ' + T('Collections'), 'button-secondary btn-sm', () => { openId = ''; renderCollectionsTab(host, { onCount }); }));
    top.append(btn('＋ ' + T('Add sources'), 'button-primary btn-sm', () => openPickSheet(rec, { onDone: () => renderCollectionsTab(host, { onCount }) })));
    top.append(btn(T('Export Markdown'), 'button-secondary btn-sm', async () => {
        const md = collectionMarkdown(rec, articles, {
            label: (k) => k.startsWith('type_') ? typeLabel(k.slice(5)) : k.startsWith('hint_') ? hintLabel(k.slice(5)) : k.startsWith('q_') ? questionLabel(k.slice(2))
                : ({ Collection: T('Collection'), Overview: T('Overview'), ov_agree: T('Agree'), ov_disagree: T('Disagree'), ov_missing: T('Missing'), 'From summaries, not checked against the full texts.': T('From summaries, not checked against the full texts.'), sources: T('sources'), Untitled: T('Untitled'), Type: T('Type'), Author: T('Author'), Date: T('Date'), Publisher: T('Publisher'), 'Source check': T('Source check') }[k] || k),
        });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
        a.download = (rec.name || 'collection').replace(/[^\p{L}\p{N}]+/gu, '_').toLowerCase() + '.md';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }));
    top.append(btn(T('Copy references'), 'button-secondary btn-sm', async function () {
        const b = this; b.disabled = true; b.title = T('Looks the citation up at doi.org. Only the DOI is sent.');
        try {
            const { ensureCsl, formatList, getCiteStyle, loadCiteStyle, copyText } = await import('./citation.js');
            await loadCiteStyle();
            const items = []; let skipped = 0;
            for (const a of articles) {
                const doi = paperDoi(a);
                if (!doi) { skipped++; continue; }
                try { items.push({ csl: await ensureCsl(a, doi) }); } catch (_) { skipped++; }
            }
            if (!items.length) { toast(T('Citation unavailable — no DOI found')); return; }
            await copyText(formatList(items, getCiteStyle()));
            bumpStat('refs_copied').catch(() => {});
            toast(skipped ? T('{n} references copied, {m} without DOI skipped', { n: items.length, m: skipped }) : T('{n} references copied', { n: items.length }));
        } catch (e) { toast(T('Citation lookup failed — try again')); } finally { b.disabled = false; }
    }));
    top.append(btn(T('Worksheet'), 'button-secondary btn-sm', () => {
        const md = collectionWorksheet(rec, articles, { label: (k) => k.startsWith('q_') ? questionLabel(k.slice(2)) : ({ Worksheet: T('Worksheet'), Collection: T('Collection'), Task: T('Task'), Type: T('Type'), Author: T('Author'), Date: T('Date'), Publisher: T('Publisher'), Untitled: T('Untitled'),
            'Check each source before you trust it. Do not stay on the page: search for who is behind it and what others say.': T('Check each source before you trust it. Do not stay on the page: search for who is behind it and what others say.'),
            'Hints, not ratings: you decide how far to trust this source.': T('Hints, not ratings: you decide how far to trust this source.') }[k] || k) });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
        a.download = (rec.name || 'collection').replace(/[^\p{L}\p{N}]+/gu, '_').toLowerCase() + '_worksheet.md';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        bumpStat('worksheet').catch(() => {});
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
    const qcard = el('div', 'coll-qcard');
    qcard.append(el('span', 'coll-qcard-l', T('Your question')), q);
    wrap.append(name, qcard, el('p', 'coll-note', T('{n} of {max} sources', { n: articles.length, max: MAX_SOURCES })));
    if (articles.length >= 2 || rec.overview) wrap.append(overviewCard(rec, articles, () => renderCollectionsTab(host, { onCount })));
    if (articles.length) {
        const open = articles.filter(x => !checkProgress(x.sourceCheck).done).length;
        wrap.append(el('p', 'coll-next', open
            ? T('Next: check your sources ({n} still open), then export the collection.', { n: open })
            : T('All sources checked. Export the collection as Markdown to write it up or share it.')));
    }

    if (!articles.length) {
        const e = el('div', 'coll-empty coll-empty--card');
        e.append(el('strong', '', T('No sources yet. Use “Add to collection” in an article’s ⋯ menu.')), btn('＋ ' + T('Add sources'), 'button-primary', () => openPickSheet(rec, { onDone: () => renderCollectionsTab(host, { onCount }) })));
        wrap.append(e);
    }
    articles.forEach(a => {
        const item = el('div', 'coll-source');
        const row = el('div', 'coll-source-row');
        const title = btn(displayTitle(a) || T('Untitled'), 'coll-source-title', () => openArticle(a));
        const p = effectiveProfile(a);
        const facts = [p.type && typeLabel(p.type), p.author, p.date, p.publisher].filter(Boolean).join(' · ');
        const prog = checkProgress(a.sourceCheck);
        const meta = el('span', 'coll-source-meta', facts || T('No source details yet'));
        const status = el('span', 'coll-source-status coll-pill' + (prog.done ? ' is-done' : ' is-open'), T('{a}/{n} checked', { a: prog.answered, n: prog.total }));
        const tx = el('div', 'coll-source-tx'); tx.append(title, meta, status);
        const toggle = btn(T('Check'), 'button-secondary btn-sm', () => {
            const open = item.querySelector('.coll-check');
            if (open) { open.remove(); toggle.setAttribute('aria-expanded', 'false'); return; }
            item.append(sourceCheckPanel(a, { question: rec.question, origin: 'collection', onChange: async () => {
                const fresh = (await collectionArticles({ sources: [{ articleId: a.id }] }))[0];
                if (fresh) { title.textContent = displayTitle(fresh) || T('Untitled'); const pr = checkProgress(fresh.sourceCheck); status.textContent = T('{a}/{n} checked', { a: pr.answered, n: pr.total }); status.classList.toggle('is-done', pr.done); status.classList.toggle('is-open', !pr.done); meta.textContent = [effectiveProfile(fresh).type && typeLabel(effectiveProfile(fresh).type), effectiveProfile(fresh).author, effectiveProfile(fresh).date, effectiveProfile(fresh).publisher].filter(Boolean).join(' · ') || T('No source details yet'); }
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
