// articleManager.js — the History screen: tabs, list, search, filters, graph scope, delete/undo.
// The detail view lives in history/detail.js and export/send in history/export.js; both load the first time they are used
// (the wrappers below keep the old exports). Shared state: history/state.js.
import { destroyReadingTools } from './readingTools.js';
import { showSkeleton, clearSkeleton } from './skeleton.js';
import { modelIcon } from './modelBadge.js';
import { icon, setIconLabel, stripEmoji } from './icons.js';
import { SK, isNoteRecKey, isHlPageKey } from './storageKeys.js';
import { escapeHtml } from './textUtils.js';
import StorageManager from './storageManager.js';
import { syncTabbarLater } from './tabbar.js';
import { buildIndex, search as tfidfSearch, similarTo } from './localSearch.js';
import { computeMetrics } from './textMetrics.js';
import { initSelection, registerCard, toggleCard, selectionActive, canSelect, startSelectionWith } from './sendSheet.js';
import { attachCardMenu } from './cardMenu.js';
import { T, TN, locale, uiLocale } from './feedI18n.js';
import { topicLabel } from './topicConcepts.js';
import { tagMatches, learnTagPairs } from './topicConcepts.js';
import { loadLexicon, saveLexicon } from './topicLexicon.js';
import { paperState, paperChips, paperType, paperSearchText } from './paperInfo.js';
import { mountPhoneCards, loadPhoneEntries, pollInbox } from './inboxView.js';
import { hist } from './history/state.js';

// Escapes translated text for use inside double-quoted HTML attributes.
const escAttr = escapeHtml;
// ── Export / send (history/export.js) and the detail view (history/detail.js) load the first time they are used ──
const exportModule = () => import('./history/export.js');
export const shareArticle = async (...args) => (await exportModule()).shareArticle(...args);
export const exportToMarkdown = async (...args) => (await exportModule()).exportToMarkdown(...args);
export const exportToWord = async (...args) => (await exportModule()).exportToWord(...args);
export const exportToDocument = async (...args) => (await exportModule()).exportToDocument(...args);
export const exportToPdf = async (...args) => (await exportModule()).exportToPdf(...args);
export const sendToObsidian = async (...args) => (await exportModule()).sendToObsidian(...args);
export const copyArticleToClipboard = async (...args) => (await exportModule()).copyArticleToClipboard(...args);
export const sendToKindle = async (...args) => (await exportModule()).sendToKindle(...args);
export const dispatchToLocalSend = async (...args) => (await exportModule()).dispatchToLocalSend(...args);
export const sendToPhone = async (...args) => (await exportModule()).sendToPhone(...args);
export const deliverKindle = async (...args) => (await exportModule()).deliverKindle(...args);
export const deliverLocalSend = async (...args) => (await exportModule()).deliverLocalSend(...args);
export const exportManyMarkdown = async (...args) => (await exportModule()).exportManyMarkdown(...args);
export const includeAllQuestions = async (...args) => (await exportModule()).includeAllQuestions(...args);
export const exportView = async (...args) => (await exportModule()).exportView(...args);
export const __test_buildDoc = async (a) => (await exportModule()).__test_buildDoc(a);

let detailModule = null, detailLoaded = null;
const loadDetail = () => (detailModule ||= import('./history/detail.js').then((m) => (detailLoaded = m)));
export async function showArticleDetail(article) { hist.detailChosenAt = Date.now(); return (await loadDetail()).showArticleDetail(article); }
export async function openArticleInHistory(article) { hist.detailChosenAt = Date.now(); return (await loadDetail()).openArticleInHistory(article); }
const layoutDetailActions = (...args) => (detailLoaded ? detailLoaded.layoutDetailActions(...args) : undefined);   // no detail module = no detail open

/** Translated label whose translations still carry the old emoji, text only (the control gets an SVG icon). */
export const lbl = (key) => escapeHtml(stripEmoji(T(key)));

const pendingArticleDeletes = new Set();   // hidden while their Undo toast runs; deleted from storage when it runs out           // archived entries (Archive tab)
let historyTab = 'inbox';         // 'inbox' | 'read' | 'sent' | 'archive'
let pendingRender = false;
let historyLoaded = false;        // the archive has been read once: before that a phone-inbox event must not paint a half list

const isSent = (a) => Array.isArray(a.sentTo) && a.sentTo.length > 0;
const TAB_DEFS = [['inbox', () => T('Inbox')], ['read', () => T('Read')], ['sent', () => T('Sent')], ['research', () => T('Research')], ['collections', () => T('Collections')], ['archive', () => T('Archive')]];
let collectionCount = 0;   // shown on the Collections tab; refreshed when that tab renders or a collection changes
const RESEARCH_FILTERS = [['all', () => T('All')], ['review', () => T('Reviews')], ['trial', () => T('Trials')], ['preprint', () => T('Preprints')]];
let researchFilter = 'all';

function tabList(tab) {
    if (tab === 'read') return hist.cached.filter(a => a.readAt);
    if (tab === 'sent') return hist.cached.filter(isSent);
    if (tab === 'archive') return hist.archived;
    if (tab === 'collections') return [];   // not articles: collectionsView.js draws this tab
    if (tab === 'research') return hist.cached.filter(a => paperState(a) && (researchFilter === 'all' || paperType(a) === researchFilter));
    return hist.cached;
}

export const currentHistoryTab = () => historyTab;

/** Re-render the list for the active tab (Inbox = everything not archived). */
export function renderTab() { renderArticles(tabList(historyTab)); }

// One persistent bar (like Feeds' scope row): re-attached on every render, updated in place,
// so the brand indicator slides between tabs instead of being rebuilt.
let historyNav = null;
function buildTabs() {
    if (!historyNav) {
        const nav = document.createElement('div');
        nav.className = 'history-tabs tabbar';
        nav.dataset.tabbar = 'history';
        nav.setAttribute('role', 'tablist');
        TAB_DEFS.forEach(([id]) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'history-tab tabbar-btn';
            b.setAttribute('role', 'tab');
            b.dataset.tab = id;
            b.append(document.createElement('span'), Object.assign(document.createElement('span'), { className: 'history-tab-n tabbar-n' }));
            b.addEventListener('click', () => { if (historyTab === id) return; historyTab = id; renderTab(); const f = document.getElementById('searchInput'); if (f && f.value.trim()) filterArticles(); });
            nav.appendChild(b);
        });
        historyNav = nav;
    }
    const nav = historyNav;
    TAB_DEFS.forEach(([id, label]) => {
        const b = nav.querySelector(`.tabbar-btn[data-tab="${id}"]`);
        if (!b) return;
        b.classList.toggle('on', historyTab === id);
        b.setAttribute('aria-selected', String(historyTab === id));
        b.firstChild.textContent = label();
        if (id === 'research') b.hidden = historyTab !== 'research' && !hist.cached.some(a => paperState(a));   // only for people who save papers
        b.lastChild.textContent = String(id === 'research' ? hist.cached.filter(a => paperState(a)).length : id === 'collections' ? collectionCount : tabList(id).length);
    });
    syncTabbarLater(nav);
    return nav;
}

function fmtDay(iso) { try { return new Date(iso).toLocaleDateString(locale(), { month: 'short', day: 'numeric' }); } catch (_) { return ''; } }

/** [tone, text] badges for a card: Sent (per target) else Read else New; Archived is added first. */
export function statusBadges(a) {
    if (!a || a.feedStub) return [];
    const out = [];
    if (a.savedOnly && !(a.summary && String(a.summary).trim())) out.push(['saved', T('📥 Saved · no AI')]);
    if (a.fromPhone) out.push(['phone', '📱 ' + T('From phone')]);   // it came in through the phone inbox; stays after it was summarized or saved
    if (a.archived) out.push(['arch', T('🗄️ Archived · {date}', { date: fmtDay(a.archivedAt || a.timestamp) })]);
    const latest = new Map();
    (isSent(a) ? a.sentTo : []).forEach(x => latest.set(x.kind + '|' + (x.label || ''), x));
    [...latest.values()].sort((x, y) => String(x.at).localeCompare(String(y.at))).slice(-2).forEach(x => {
        const date = fmtDay(x.at);
        out.push(['sent', x.kind === 'kindle' ? T('📚 Sent to Kindle · {date}', { date }) : x.kind === 'localsend' ? T('📡 Sent via LocalSend · {date}', { date }) : T('✅ Sent · {date}', { date })]);
    });
    if (!isSent(a)) out.push(a.readAt ? ['read', T('👀 Read')] : ['new', T('🆕 New')]);
    return out;
}

/** Cards that leave the list shrink and fade first, so the rest closes the gap instead of jumping. */
function collapseCards(ids) {
    const list = document.getElementById('articleList');
    if (!list || list.style.display === 'none' || !ids.length) return Promise.resolve();
    let reduce = document.documentElement.getAttribute('data-motion') === 'reduce';
    try { reduce = reduce || window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { /* no matchMedia */ }
    if (reduce) return Promise.resolve();
    const want = new Set(ids.map(String));
    const gone = [...list.querySelectorAll('li[data-id]')].filter(li => want.has(li.dataset.id) && li.animate);
    return Promise.all(gone.map((li) => {
        const h = li.getBoundingClientRect().height;
        li.style.overflow = 'hidden'; li.style.pointerEvents = 'none';
        return li.animate(
            [{ height: h + 'px', opacity: 1, marginBottom: getComputedStyle(li).marginBottom }, { height: '0px', opacity: 0, marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px' }],
            { duration: 200, easing: 'ease-out', fill: 'forwards' }
        ).finished.catch(() => {});
    })).then(() => {});
}

/**
 * Change reading status for several articles (storage + caches + list).
 * patch: { read?, sent?: {kind,label}, archived? } — see StorageManager.patchArticleStatus.
 */
export async function applyStatus(ids, patch) {
    await StorageManager.patchArticleStatus(ids, patch);
    const all = await StorageManager.getArticlesIndex({ includeArchived: true });
    hist.cached = all.filter(a => !a.archived && !pendingArticleDeletes.has(a.id));
    hist.archived = all.filter(a => a.archived && !pendingArticleDeletes.has(a.id));
    invalidateSearchIndex();
    const list = document.getElementById('articleList');
    if (list && list.style.display !== 'none') {
        const stay = new Set(tabList(historyTab).map(a => String(a.id)));
        await collapseCards(ids.filter(id => !stay.has(String(id))));
        renderTab();
    } else pendingRender = true;
}

// Whether the knowledge graph's node set is hard-filtered by the archive
// search box ('filtered', the default — nodes for non-matches are removed)
// or the whole archive stays rendered and the search box just dims
// non-matches instead ('all'). Set via the inline toggle button in the
// search input itself (only shown while the graph is open — see
// setGraphScopeMode()/graphScopeToggleBtn in initArticleManager()).
let graphScopeMode = 'filtered';

// On-device TF-IDF index, shared by search, "similar articles", and (via
// tagIntelligence.js elsewhere) tag suggestions. Built lazily on first use
// and rebuilt only when the archive actually changes — not on every
// keystroke or render.
let searchIndex = null;
let searchIndexDirty = true;

export function invalidateSearchIndex() {
    searchIndexDirty = true;
}

// Debounces applyGraphSearchDim() calls driven by search-box keystrokes.
// Dimming touches every node/link/label in the graph (O(archive size)); on
// a large archive, running that on every single keystroke visibly lags
// typing. Waiting for a short pause collapses a fast typing burst into one
// pass instead of one per character.
let graphSearchDimTimer = null;
const GRAPH_SEARCH_DIM_DELAY = 150;

function scheduleGraphSearchDim(container, query) {
    if (graphSearchDimTimer) clearTimeout(graphSearchDimTimer);
    graphSearchDimTimer = setTimeout(() => {
        graphSearchDimTimer = null;
        import('./archiveGraph.js').then(mod => mod.applyGraphSearchDim(container, query));
    }, GRAPH_SEARCH_DIM_DELAY);
}

/**
 * The article set to actually render as graph nodes, given graphScopeMode:
 * the full archive when scope is 'all' (the search box narrows via dimming
 * instead — see applyGraphSearchDim, applied separately, not here),
 * otherwise the cheap title/tag match against the search text for a hard
 * rebuild — falling back to the full archive if that match is empty, so an
 * over-narrow query doesn't leave the graph blank.
 */
function graphScopeVisibleArticles() {
    if (graphScopeMode === 'all') return hist.cached;
    const searchInput = document.getElementById('searchInput');
    const filterText = (searchInput?.value || '').toLowerCase();
    if (!filterText) return hist.cached;
    const filtered = hist.cached.filter(a => {
        const titleMatch = (a.title || '').toLowerCase().includes(filterText);
        const tagMatch = (a.tags || []).some(t => tagMatches(t, filterText));
        return titleMatch || tagMatch;
    });
    return filtered.length > 0 ? filtered : hist.cached;
}

/**
 * Records that an article was opened (viewed in the detail view). This is
 * the "follow-through" signal the knowledge graph uses to surface neglected
 * saves — an article that sits unopened past the threshold fades/shrinks
 * in the graph. Persisted to storage so it survives reloads.
 */
export function recordArticleOpened(article) {
    if (!article || !article.id) return;
    const now = new Date().toISOString();
    article.lastOpened = now;
    // Keep the in-memory cache in sync so the graph (which reads from
    // hist.cached) reflects the update immediately.
    const idx = hist.cached.findIndex(a => a.id === article.id);
    if (idx !== -1) hist.cached[idx].lastOpened = now;
    StorageManager.touchArticleOpened(article.id).catch(() => {});
}

function ensureSearchIndex() {
    if (!searchIndex || searchIndexDirty) {
        searchIndex = buildIndex(hist.cached);
        searchIndexDirty = false;
    }
    return searchIndex;
}


export const wsActive = () => !!document.getElementById('historyScreen')?.classList.contains('ws-active');

/** Keeps every star in sync (list card, detail bar, caches) after a favorite change. */
function paintFavorite(id, on) {
    const c = hist.cached.find(a => a.id === id); if (c) c.favorite = on;
    const ar = hist.archived.find(a => a.id === id); if (ar) ar.favorite = on;
    if (hist.detail && hist.detail.id === id) hist.detail.favorite = on;
    const li = document.querySelector(`#articleList li[data-id="${CSS.escape(String(id))}"]`);
    if (li) { li.classList.toggle('is-favorite', on); const b = li.querySelector('.star-button'); if (b) { b.setAttribute('aria-pressed', String(on)); } }
    const d = document.getElementById('detailStarBtn');
    if (d && hist.detail && hist.detail.id === id) paintDetailStar(on);
}
export function paintDetailStar(on) {
    const d = document.getElementById('detailStarBtn'); if (!d) return;
    d.setAttribute('aria-pressed', String(!!on)); d.classList.toggle('is-on', !!on);
    // the star icon is filled by CSS from aria-pressed / .is-on
}

/** Collections: the "Add to collection" sheet (card ⋯ menu and the article detail). */
export async function addToCollection(article) {
    const { openAddSheet } = await import('./collectionsView.js');
    await openAddSheet(article, { onDone: () => { if (historyTab === 'collections') renderTab(); } });
}

// ── "Free up space" hint ────────────────────────────────────────────────────
// When the saved data is heavy (the index is read on every open) and there are large articles nobody opened for months,
// a dismissible note at the top of the list opens a sheet to delete them. Measured once per popup; dismissed for 14 days.
let storageHint = null;   // null = not measured yet · 'pending' · 'none' · { report }
const HINT_QUIET_DAYS = 14;

async function measureStorageHint() {
    try {
        const { [SK.storageHint]: dismissed } = await StorageManager.getLocal({ [SK.storageHint]: '' });
        if (dismissed && Date.now() - new Date(dismissed).getTime() < HINT_QUIET_DAYS * 86400000) return 'none';
        const [{ measure }, C, index] = await Promise.all([import('./storageHealth.js'), import('./collections.js'), StorageManager.getArticlesIndex({ includeArchived: true })]);
        const keep = new Set();
        for (const c of await C.listCollections()) { const rec = await C.getCollection(c.id); (rec ? rec.sources : []).forEach(s => keep.add(s.articleId)); }
        const report = await measure(index, SK.articlesIndex, keep);
        return report.level === 'heavy' && report.candidates.list.length ? { report, index, keep } : 'none';
    } catch (_) { return 'none'; }
}

async function mountStorageHint(articleList) {
    if (storageHint === null) {
        storageHint = 'pending';
        storageHint = await measureStorageHint();
    }
    if (!storageHint || storageHint === 'pending' || storageHint === 'none') return;
    if (!articleList.isConnected || historyTab === 'collections' || articleList.querySelector('.storage-hint')) return;
    const { report, index: hintIndex, keep: hintKeep } = storageHint;
    const { formatBytes, openStorageSheet } = await import('./storageHealth.js');
    const box = document.createElement('div'); box.className = 'storage-hint'; box.setAttribute('role', 'note');
    const tx = document.createElement('span');
    tx.textContent = T('Saved data is getting large ({size}). {n} big articles have not been opened for months.', { size: formatBytes(report.totalBytes), n: report.candidates.total });
    const go = document.createElement('button'); go.type = 'button'; go.className = 'button-secondary btn-sm'; go.textContent = T('Free up space');
    const later = document.createElement('button'); later.type = 'button'; later.className = 'button-secondary btn-sm'; later.textContent = T('Not now');
    go.addEventListener('click', () => openStorageSheet({
        report, index: hintIndex, keep: hintKeep,
        deleteIds: async (ids) => {
            for (const id of ids) await StorageManager.deleteArticle(id);
            const gone = new Set(ids);
            hist.cached = hist.cached.filter(a => !gone.has(a.id)); hist.archived = hist.archived.filter(a => !gone.has(a.id));
            invalidateSearchIndex();
        },
        pruneIds: async (ids) => {
            const sh = await import('./storageHealth.js');
            const all = await StorageManager.getArticlesIndex({ includeArchived: true });
            await sh.dropPageText(all, ids, SK.articlesIndex);
            const done = new Set(ids);
            [hist.cached, hist.archived].forEach(l => l.forEach(a => { if (done.has(a.id)) a.contentPruned = true; }));
        },
        onDone: (n, how) => { storageHint = null; renderTab(); if (hist.ui) hist.ui.showToast(how === 'pruned' ? T('Page text of {n} articles removed', { n }) : T('{n} articles deleted', { n })); },
    }));
    later.addEventListener('click', async () => { storageHint = 'none'; box.remove(); await StorageManager.setLocal({ [SK.storageHint]: new Date().toISOString() }); });
    box.append(tx, go, later);
    articleList.prepend(box);
}


/**
 * Delete flow (AISH-032 · A4, instead of window.confirm): a sheet says what is deleted and what stays; the articles
 * disappear at once and are deleted from storage only when the Undo toast runs out.
 */
async function confirmArticleDelete(ids) {
    const { confirmSheet } = await import('./confirmSheet.js');
    let inColl = 0;
    try { const C = await import('./collections.js'); for (const id of ids) if ((await C.collectionsOfArticle(id)).length) inColl++; } catch (_) { /* no collections */ }
    const n = ids.length, one = n === 1;
    return confirmSheet({
        title: one ? T('Delete this article?') : T('Delete {n} articles?', { n }),
        text: (one ? T('The article is deleted with its summary and saved page text.') : T('The articles are deleted with their summaries and saved page text.'))
            + (inColl ? ' ' + (one ? T('It also leaves the collections it is in.') : T('They also leave the collections they are in.')) : ''),
        keeps: T('Your highlights and notes stay in Notes.'),
        confirmLabel: one ? T('Delete article') : T('Delete {n} articles', { n }),
        undo: true,
    });
}
async function deleteArticlesWithUndo(ids) {
    const gone = new Set(ids);
    ids.forEach(id => pendingArticleDeletes.add(id));
    await collapseCards(ids);
    hist.cached = hist.cached.filter(i => !gone.has(i.id));
    hist.archived = hist.archived.filter(i => !gone.has(i.id));
    invalidateSearchIndex();
    if (document.getElementById('articleList')) renderTab();
    const { undoToast } = await import('./confirmSheet.js');
    undoToast(ids.length === 1 ? T('Article deleted') : T('{n} articles deleted', { n: ids.length }), {
        commit: async () => { await StorageManager.deleteArticles(ids); ids.forEach(id => pendingArticleDeletes.delete(id)); },
        undo: async () => {
            ids.forEach(id => pendingArticleDeletes.delete(id));
            const all = await StorageManager.getArticlesIndex({ includeArchived: true });
            hist.cached = all.filter(a => !a.archived && !pendingArticleDeletes.has(a.id));
            hist.archived = all.filter(a => a.archived && !pendingArticleDeletes.has(a.id));
            invalidateSearchIndex();
            if (document.getElementById('articleList')) renderTab();
        },
    });
}

/** Bulk delete (History selection): one sheet, then Undo. */
export async function removeMany(ids) {
    if (!ids || !ids.length) return false;
    if (!(await confirmArticleDelete(ids))) return false;
    await deleteArticlesWithUndo(ids);
    return true;
}

/** Delete one article (card ⋯ menu): sheet, then Undo. */
export async function removeArticle(article) {
    if (!article || !article.id) return false;
    if (!(await confirmArticleDelete([article.id]))) return false;
    await deleteArticlesWithUndo([article.id]);
    return true;
}

/**
 * Lets a page that is not the popup (the reader) use shareArticle / sendToKindle / dispatchToLocalSend: they report
 * through `ui.showToast` and send people to Settings through `ui.showScreen`. initArticleManager() does this itself.
 */
export function bindUiManager(ui) { hist.ui = ui; }

export function initArticleManager(uiManager) {
    loadLexicon();   // learned tag names (History search, graph and charts group tags across languages with them)
    hist.ui = uiManager;
    import('./collectionsView.js').then(m => m.initCollectionsView({ toast: (msg, o = {}) => uiManager.showToast(msg, o.duration || 3000, o.action || null), openArticle: (a) => showArticleDetail(a) })).catch(() => {});
    // The lexicon grew (tag naming in Settings or a background run): tag chips change language, so redraw the list.
    // Waiting phone links changed. Before the first load the archive is empty here: painting now would show the phone
    // cards alone and the rest a moment later. loadHistory() mounts both together, so wait for it.
    document.addEventListener('aish:phone-inbox', () => { try { if (historyLoaded && historyTab === 'inbox' && document.getElementById('articleList')) renderTab(); } catch (e) { /* list not mounted */ } });
    // The archive changed behind the list's back (a summary finished in a background tab, a phone link was saved, another
    // popup wrote): re-read it and redraw, so a new article shows up without reopening History.
    let indexTimer = null;
    try {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local' || !changes[SK.articlesIndex]) return;
            clearTimeout(indexTimer);
            indexTimer = setTimeout(async () => {
                if (!historyLoaded) return;   // the first load reads it anyway
                try {
                    const all = await StorageManager.getArticlesIndex({ includeArchived: true });
                    hist.cached = all.filter(a => !a.archived && !pendingArticleDeletes.has(a.id));
                    hist.archived = all.filter(a => a.archived && !pendingArticleDeletes.has(a.id));
                    invalidateSearchIndex();
                    const list = document.getElementById('articleList');
                    if (list && list.style.display !== 'none') {
                        renderTab();
                        const f = document.getElementById('searchInput');
                        if (f && f.value.trim()) filterArticles();
                    } else pendingRender = true;
                } catch (e) { /* the next change or loadHistory() will catch up */ }
            }, 250);
        });
    } catch (e) { /* no storage events in this context */ }
    document.addEventListener('aish:lexiconChanged', () => { try { if (document.getElementById('articleList')) renderTab(); } catch (e) { /* list not mounted */ } });
    initSelection({
        deliverKindle, deliverLocalSend,
        applyStatus, exportManyMarkdown, removeMany, currentTab: () => historyTab,
        toast: (m) => uiManager.showToast(m),
        openSettings: (section, target) => { uiManager.showScreen('settings'); import('./settingsNav.js').then(m => m.openSettingsPanel(section, target)).catch(() => {}); }
    });
    {   // re-render the list once it becomes visible again after a status change made elsewhere (detail view)
        const list = document.getElementById('articleList');
        if (list) new MutationObserver(() => { if (pendingRender && list.style.display !== 'none') { pendingRender = false; renderTab(); } }).observe(list, { attributes: true, attributeFilter: ['style'] });
    }
    const searchInput = document.getElementById('searchInput');
    const detailBackBtn = document.getElementById('detailBackButton');
    const detailDeleteBtn = document.getElementById('detailDeleteBtn');
    const historyTopBar = document.getElementById('historyTopBar');
    const detailTopBar = document.getElementById('detailTopBar');
    const historyScreen = document.getElementById('historyScreen');
    let lastHistoryScrollTop = 0;

    const setTopBarsHidden = (hidden) => {
        if (historyTopBar) historyTopBar.classList.toggle('scroll-hidden', hidden);
        if (detailTopBar) detailTopBar.classList.toggle('scroll-hidden', hidden);
    };

    // ── Graph search-scope toggle (lives inline in the search input) ──────
    const graphScopeToggleBtn = document.getElementById('graphScopeInlineToggle');

    const syncGraphScopeToggleBtn = () => {
        if (!graphScopeToggleBtn) return;
        if (graphScopeMode === 'all') {
            graphScopeToggleBtn.textContent = T('View: Highlighted');
            graphScopeToggleBtn.title = T('Highlighting matches in the whole archive — click to filter to matches only');
            graphScopeToggleBtn.setAttribute('aria-label', T('Switch graph search to filter mode'));
        } else {
            graphScopeToggleBtn.textContent = T('View: Filtered');
            graphScopeToggleBtn.title = T('Filtering graph to matches only — click to highlight matches in the whole archive instead');
            graphScopeToggleBtn.setAttribute('aria-label', T('Switch graph search to highlight mode'));
        }
    };

    const setGraphScopeToggleVisible = (visible) => {
        if (graphScopeToggleBtn) graphScopeToggleBtn.style.display = visible ? 'flex' : 'none';
        if (searchInput) searchInput.classList.toggle('graph-scope-toggle-visible', visible);
    };

    // Only relevant once there's something to filter/highlight against —
    // shown while the graph is open AND the search box has text, hidden
    // otherwise (including as soon as the box is cleared).
    const updateGraphScopeToggleVisibility = () => {
        const graphContainer = document.getElementById('graphContainer');
        const graphOpen = !!graphContainer && graphContainer.style.display === 'block';
        setGraphScopeToggleVisible(graphOpen && !!(searchInput && searchInput.value.length > 0));
    };

    // Switches graphScopeMode and, if the graph is currently open, re-renders
    // it immediately in the new scope (mirrors what toggleGraph's fresh-open
    // path does, just triggered by the inline button instead).
    const setGraphScopeMode = (nextMode) => {
        if (nextMode === graphScopeMode) return;
        graphScopeMode = nextMode;
        syncGraphScopeToggleBtn();

        const graphContainer = document.getElementById('graphContainer');
        if (!graphContainer || graphContainer.style.display !== 'block') return;
        if (nextMode === 'all') graphContainer.style.opacity = '1';

        const source = graphScopeVisibleArticles();
        import('./archiveGraph.js').then(mod => {
            const rendered = mod.initArchiveGraph(graphContainer, source, hist.detail?.timestamp, ensureSearchIndex());
            if (nextMode === 'all') {
                Promise.resolve(rendered).then(() => mod.applyGraphSearchDim(graphContainer, searchInput?.value || ''));
            }
        });
    };

    if (graphScopeToggleBtn) {
        graphScopeToggleBtn.addEventListener('click', () => {
            setGraphScopeMode(graphScopeMode === 'all' ? 'filtered' : 'all');
        });
    }

    const deleteCurrentDetailArticle = async () => {
        if (!hist.detail) return;
        const deletedId = hist.detail.id;
        if (!(await confirmArticleDelete([deletedId]))) return;
        hist.detail = null;
        await deleteArticlesWithUndo([deletedId]);
        {

            const articleDetail = document.getElementById('articleDetail');
            const articleList = document.getElementById('articleList');
            const graphContainer = document.getElementById('graphContainer');
            const reportContainer = document.getElementById('reportContainer');
            if (articleDetail) articleDetail.style.display = 'none';
            if (graphContainer && !wsActive()) graphContainer.style.display = 'none';
            if (reportContainer && !wsActive()) reportContainer.style.display = 'none';
            if (articleList) articleList.style.display = 'block';
            if (historyTopBar) historyTopBar.style.display = 'flex';
            if (detailTopBar) detailTopBar.style.display = 'none';
        }
    };

    // ── Handle Detail Back Button ───────────────────────────────────────
    if (detailBackBtn) {
        detailBackBtn.addEventListener('click', () => {
            destroyReadingTools();
            const openedId = hist.detail && hist.detail.id;
            const articleDetail = document.getElementById('articleDetail');
            const articleList = document.getElementById('articleList');
            const graphContainer = document.getElementById('graphContainer');
            const reportContainer = document.getElementById('reportContainer');
            if (articleDetail) articleDetail.style.display = 'none';
            if (graphContainer && !wsActive()) graphContainer.style.display = 'none';
            if (reportContainer && !wsActive()) reportContainer.style.display = 'none';
            if (articleList) { articleList.style.display = 'block'; playEnter(articleList); }
            if (historyTopBar) historyTopBar.style.display = 'flex';
            if (detailTopBar) detailTopBar.style.display = 'none';
            restoreCardFocus(openedId);
        });
    }

    if (detailDeleteBtn) {
        detailDeleteBtn.addEventListener('click', deleteCurrentDetailArticle);
    }
    if (detailTopBar && typeof ResizeObserver !== 'undefined') {   // wider / narrower pane: move the action buttons up or down
        let raf = 0;
        new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (hist.detail && detailTopBar.style.display !== 'none') layoutDetailActions(); }); }).observe(detailTopBar);
    }
    {   // ★ favorite from the article view
        const ds = document.getElementById('detailStarBtn');
        if (ds) { ds.title = T('Favorite'); ds.setAttribute('aria-label', T('Favorite')); }
        if (ds) ds.addEventListener('click', async () => {
            const a = hist.detail; if (!a || !a.id) return;
            const next = await StorageManager.toggleFavorite(a.id);
            if (next === null) return;
            a.favorite = next; paintFavorite(a.id, next);
            if (hist.ui) hist.ui.showToast(next ? T('Added to favorites') : T('Removed from favorites'));
        });
    }
    {   // ⋯ menu in the detail top bar: Graph / Analytics / Delete
        const moreBtn = document.getElementById('detailMoreBtn');
        const moreMenu = document.getElementById('detailMoreMenu');
        if (moreBtn && moreMenu) {
            const setOpen = (open) => { moreMenu.hidden = !open; moreBtn.setAttribute('aria-expanded', String(open)); };
            moreBtn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(moreMenu.hidden); });
            moreMenu.addEventListener('click', () => setOpen(false));
            document.addEventListener('click', (e) => { if (!moreMenu.hidden && !moreMenu.contains(e.target)) setOpen(false); });
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !moreMenu.hidden) { setOpen(false); moreBtn.focus(); } });
        }
    }

    if (historyScreen) {
        historyScreen.addEventListener('scroll', () => {
            const currentTop = Math.max(0, historyScreen.scrollTop);
            const delta = currentTop - lastHistoryScrollTop;

            if (currentTop <= 8) {
                setTopBarsHidden(false);
            } else if (delta > 6) {
                setTopBarsHidden(true);
            } else if (delta < -4) {
                setTopBarsHidden(false);
            }

            lastHistoryScrollTop = currentTop;
        }, { passive: true });
    }

    if (searchInput) {
        searchInput.addEventListener('input', filterArticles);
        searchInput.addEventListener('input', updateGraphScopeToggleVisibility);
        // The ✕ clear button is wired by searchField.js (initSearchFields).
    }

    // ⌘F / Ctrl+F and / are handled centrally in shortcuts.js

    // ── Split-screen workspace hooks ────────────────────────────────────
    // In the multi-pane layout (workspaceManager.js) graph/analytics are shown
    // next to the list instead of replacing it, so they need open/close paths
    // that leave the list and detail alone.
    const initGraphView = () => {
        const graphContainer = document.getElementById('graphContainer');
        graphScopeMode = 'filtered';
        graphContainer.__archiveGraphStatsDismissed = false;
        syncGraphScopeToggleBtn();
        updateGraphScopeToggleVisibility();
        const source = graphScopeVisibleArticles();
        if (source.length > 0) {
            import('./archiveGraph.js').then(mod => {
                mod.initArchiveGraph(graphContainer, source, hist.detail?.timestamp, ensureSearchIndex());
            });
        } else {
            StorageManager.getArticlesIndex().then(articles => {
                if (articles.length > 0) {
                    import('./archiveGraph.js').then(mod => {
                        mod.initArchiveGraph(graphContainer, articles, hist.detail?.timestamp, buildIndex(articles));
                    });
                } else {
                    graphContainer.innerHTML = `<div class="graph-empty">${T('No articles to graph yet.')}</div>`;
                }
            });
        }
    };
    const initReportView = () => {
        const reportContainer = document.getElementById('reportContainer');
        StorageManager.getArticlesIndex({ includeArchived: true }).then(articles => {
            import('./analyticsManager.js').then(mod => {
                mod.initAnalyticsReport(reportContainer, articles);
            });
        });
    };
    document.addEventListener('aish:ws-view', (e) => {
        const { view, open, scope } = e.detail || {};
        if (scope && scope !== 'history') return;
        const graphContainer = document.getElementById('graphContainer');
        const reportContainer = document.getElementById('reportContainer');
        if (view === 'graph' && graphContainer) {
            const isOpen = graphContainer.style.display === 'block';
            if (open && !isOpen) { graphContainer.style.display = 'block'; graphContainer.style.opacity = '1'; initGraphView(); }
            if (!open && isOpen) graphContainer.style.display = 'none'; // observer destroys the simulation
        }
        if (view === 'report' && reportContainer) {
            const isOpen = reportContainer.style.display === 'block';
            if (open && !isOpen) { reportContainer.style.display = 'block'; initReportView(); }
            if (!open && isOpen) reportContainer.style.display = 'none';
        }
    });

    // Graph / Analytics buttons mirror what is open (same as the Feeds toolbar): pressed = that view is showing.
    const syncViewButtons = () => {
        const open = (id) => { const c = document.getElementById(id); return !!c && c.style.display === 'block'; };
        const g = open('graphContainer'), r = open('reportContainer');
        [['graphToggleBtn', g], ['detailGraphToggleBtn', g], ['reportToggleBtn', r], ['detailReportToggleBtn', r]].forEach(([id, on]) => {
            const b = document.getElementById(id);
            if (!b) return;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', String(on));
        });
    };
    const viewObserver = new MutationObserver(syncViewButtons);
    ['graphContainer', 'reportContainer'].forEach(id => { const c = document.getElementById(id); if (c) viewObserver.observe(c, { attributes: true, attributeFilter: ['style'] }); });
    syncViewButtons();

    // ── Shared graph toggle ─────────────────────────────────────────────
    const toggleGraph = () => {
        const articleList = document.getElementById('articleList');
        const articleDetail = document.getElementById('articleDetail');
        const graphContainer = document.getElementById('graphContainer');
        if (!graphContainer) return;
        const isGraph = graphContainer.style.display === 'block';
        if (isGraph) {
            graphContainer.style.display = 'none';
            // Stop the D3 force simulation + release its listeners when the
            // graph is hidden — otherwise it keeps ticking on an animation
            // loop and retaining the node/link object graph in memory.
            // Hiding the inline scope toggle happens via the shared
            // graphVisibilityObserver below (covers every hide path, not
            // just this one).
            import('./archiveGraph.js').then(mod => mod.destroyArchiveGraph(graphContainer));
            if (detailTopBar?.style.display === 'flex') {
                if (articleDetail) articleDetail.style.display = 'block';
            } else {
                if (articleList) articleList.style.display = 'block';
            }
        } else {
            if (articleList) articleList.style.display = 'none';
            if (articleDetail) articleDetail.style.display = 'none';
            const rc = document.getElementById('reportContainer');
            const split = document.getElementById('historyScreen')?.classList.contains('ws-active');
            if (rc && !split) rc.style.display = 'none';   // one pane: one view at a time, graph replaces analytics
            graphContainer.style.display = 'block';
            graphContainer.style.opacity = '1';
            viewChosenAt = Date.now();
            initGraphView();
        }
        syncViewButtons();
    };

    const graphToggleBtn = document.getElementById('graphToggleBtn');
    const detailGraphToggleBtn = document.getElementById('detailGraphToggleBtn');
    if (graphToggleBtn) graphToggleBtn.addEventListener('click', toggleGraph);
    if (detailGraphToggleBtn) detailGraphToggleBtn.addEventListener('click', toggleGraph);

    // ── Shared report toggle ────────────────────────────────────────────
    const toggleReport = () => {
        const articleList = document.getElementById('articleList');
        const articleDetail = document.getElementById('articleDetail');
        const graphContainer = document.getElementById('graphContainer');
        const reportContainer = document.getElementById('reportContainer');
        if (!reportContainer) return;
        const isReport = reportContainer.style.display === 'block';
        if (isReport) {
            reportContainer.style.display = 'none';
            if (detailTopBar?.style.display === 'flex') {
                if (articleDetail) articleDetail.style.display = 'block';
            } else {
                if (articleList) articleList.style.display = 'block';
            }
        } else {
            if (articleList) articleList.style.display = 'none';
            if (articleDetail) articleDetail.style.display = 'none';
            if (graphContainer) graphContainer.style.display = 'none';
            reportContainer.style.display = 'block';
            viewChosenAt = Date.now();
            initReportView();
        }
        syncViewButtons();
    };

    const reportToggleBtn = document.getElementById('reportToggleBtn');
    const detailReportToggleBtn = document.getElementById('detailReportToggleBtn');
    if (reportToggleBtn) reportToggleBtn.addEventListener('click', toggleReport);
    if (detailReportToggleBtn) detailReportToggleBtn.addEventListener('click', toggleReport);

    // ── Listen for open-article events from the graph preview card ────
    const graphContainer = document.getElementById('graphContainer');
    if (graphContainer) {
        // Stop the D3 force simulation whenever the graph container is
        // hidden (toggle, back button, delete, report switch, screen
        // change). A single observer covers every hide path instead of
        // sprinkling destroyArchiveGraph() calls at each call site. The
        // simulation otherwise keeps ticking on an animation loop and
        // retains the node/link object graph while the graph is invisible.
        const graphVisibilityObserver = new MutationObserver(() => {
            if (graphContainer.style.display === 'none') {
                import('./archiveGraph.js').then(mod => mod.destroyArchiveGraph(graphContainer));
                setGraphScopeToggleVisible(false);
            }
        });
        graphVisibilityObserver.observe(graphContainer, { attributes: true, attributeFilter: ['style'] });

        graphContainer.addEventListener('open-article', (e) => {
            if (e.detail) {
                openArticleInHistory(e.detail);
            }
        });

        // ── Listen for filter-by-tag events from the graph ────────────
        // Clicking a tag node in the graph filters to that tag via the
        // shared search box, but stays in graph mode (dims/narrows the
        // graph itself per the current filter/highlight scope) rather than
        // switching away to the plain article list.
        graphContainer.addEventListener('filter-by-tag', (e) => {
            const tag = e.detail?.tag;
            if (!tag) return;
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.value = tag;
                // A real 'input' event, not a direct filterArticles() call,
                // so the clear button's own 'input' listener (toggling its
                // visibility + the input's has-clear class) fires too.
                searchInput.dispatchEvent(new Event('input'));
            }
        });

    }

    // ── Listen for tag-search events from the analytics report ────────
    const reportContainerEl = document.getElementById('reportContainer');
    if (reportContainerEl) {
        reportContainerEl.addEventListener('tag-search', (e) => {
            const tag = e.detail?.tag;
            if (!tag) return;
            // Hide report, show article list
            if (!wsActive()) reportContainerEl.style.display = 'none';
            const articleList = document.getElementById('articleList');
            const historyTopBar = document.getElementById('historyTopBar');
            if (articleList) articleList.style.display = 'block';
            if (historyTopBar) historyTopBar.style.display = 'flex';
            // Pre-fill search and filter
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.value = tag;
                searchInput.dispatchEvent(new Event('input'));
                searchInput.focus();
            }
        });
    }
}

// When Graph or Analytics was last opened by the user. Switching to History reloads it 350 ms later (after the slide
// animation, see uiManager.js); that reload must not close a view the user opened in the meantime.
let viewChosenAt = 0;
// When an article was last opened. Opening one from the summary bubble, a feed or the graph switches to History and shows the
// article at once; the reload the switch schedules must then only refresh the data behind it, not bring the list back on top.

/** @param {{since?: number}} [opts] since: when the reload was requested; a view opened after that stays open. */
export function loadHistory({ since = 0 } = {}) {
    const keepView = since > 0 && viewChosenAt >= since;
    const keepDetail = since > 0 && hist.detailChosenAt >= since;
    const graphContainer = document.getElementById('graphContainer');
    const reportContainer = document.getElementById('reportContainer');
    const articleList = document.getElementById('articleList');
    const articleDetail = document.getElementById('articleDetail');
    const historyTopBar = document.getElementById('historyTopBar');
    const detailTopBar = document.getElementById('detailTopBar');
    if (!keepDetail) {
        if (graphContainer && !wsActive() && !keepView) graphContainer.style.display = 'none';
        if (reportContainer && !wsActive() && !keepView) reportContainer.style.display = 'none';
        if (articleDetail) articleDetail.style.display = 'none';
        if (detailTopBar) detailTopBar.style.display = 'none';
        hist.toolbarEditing = false; document.getElementById('toolbarTray')?.remove();
        if (historyTopBar) historyTopBar.classList.remove('scroll-hidden');
        if (detailTopBar) detailTopBar.classList.remove('scroll-hidden');
        if (historyTopBar) historyTopBar.style.display = 'flex';
        if (articleList && !keepView) articleList.style.display = 'block';
        showSkeleton(articleList);
    }
    document.dispatchEvent(new Event('aish:ws-refresh'));
    import('./feedManager.js')
        .then(m => m.reconcileStubs())
        .catch(() => {})
        .then(() => StorageManager.getArticlesIndex({ includeArchived: true }))
        .then(articles => {
            hist.cached = articles.filter(a => !a.archived && !pendingArticleDeletes.has(a.id));
            hist.archived = articles.filter(a => a.archived && !pendingArticleDeletes.has(a.id));
            invalidateSearchIndex();
            // New summaries carry the English name of each tag: teach them to the lexicon here (not in the content script, so no page races the others), so the same
            // topic in two languages is one tag in search, graph and charts.
            loadLexicon().then(() => { if (learnTagPairs(articles)) return saveLexicon(); }).catch(() => {});
            // the phone links are read before the first paint, so they appear together with the archive
            return loadPhoneEntries().catch(() => {}).then(() => {
                historyLoaded = true; renderTab();
                // Opening History checks the phone inbox too (new links join the list by themselves when they arrive).
                pollInbox().catch(() => {});
            });
        }).catch(() => clearSkeleton(articleList));
}

function renderResearchFilters(bar) {
    if (!bar) return;
    let row = bar.querySelector('.research-filters');
    if (historyTab !== 'research') { if (row) row.remove(); return; }
    if (!row) { row = document.createElement('div'); row.className = 'research-filters'; bar.appendChild(row); }
    row.replaceChildren();
    RESEARCH_FILTERS.forEach(([id, label]) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'research-filter' + (researchFilter === id ? ' on' : ''); b.dataset.filter = id;
        b.textContent = label(); b.setAttribute('aria-pressed', String(researchFilter === id));
        b.addEventListener('click', () => { researchFilter = id; renderTab(); });
        row.appendChild(b);
    });
}

/** Replays a one-shot CSS entrance (the .is-entering rule) on `el`. */
export function playEnter(el) {
    if (!el) return;
    el.classList.remove('is-entering'); void el.offsetWidth; el.classList.add('is-entering');
    el.addEventListener('animationend', () => el.classList.remove('is-entering'), { once: true });
}

const LAZY_FIRST = 30;   // cards built at once for a long list
const LAZY_MORE = 40;    // cards added each time the end comes into view

export function renderArticles(articles) {
    const articleList = document.getElementById('articleList');
    // Cancel any in-flight chunked render FIRST (before any early return, e.g. the Collections tab): a rapid re-render or a tab
    // switch must not keep appending stale cards after we've cleared the list.
    if (articleList.__renderChunkId) {
        cancelIdleCallback(articleList.__renderChunkId);
        articleList.__renderChunkId = null;
    }
    if (articleList.__lazy) { articleList.__lazy.stop(); articleList.__lazy = null; }
    articleList.innerHTML = '';
    // The tabs live in the top bar (like Feeds' scope row), mounted once.
    const tabsBar = document.getElementById('historyTopBar');
    const tabsNav = buildTabs();
    if (tabsBar && tabsNav.parentNode !== tabsBar) tabsBar.appendChild(tabsNav);
    renderResearchFilters(tabsBar);
    if (historyTab === 'collections') {
        // Collections are not article cards: their own view fills the list element.
        import('./collectionsView.js').then(({ renderCollectionsTab }) => renderCollectionsTab(articleList, {
            onCount: (n) => { if (n !== collectionCount) { collectionCount = n; buildTabs(); } },
        })).catch(() => {});
        return;
    }
    mountStorageHint(articleList).catch(() => {});
    // Links shared from the phone wait as cards at the top of the Inbox tab (inboxView.js).
    const phoneCards = historyTab === 'inbox' ? mountPhoneCards(articleList) : 0;
    if (!articles || articles.length === 0) {
        if (phoneCards) return;
        const emptyMessage = document.createElement('div');
        emptyMessage.id = 'emptyMessage';
        const p = document.createElement('p');
        if (historyTab === 'inbox' && hist.cached.length === 0 && hist.archived.length === 0) p.textContent = T('🗂️ Your archive is as empty as a desert! Start saving some articles to fill it up. 🌵');
        else p.textContent = T('Nothing here yet');
        emptyMessage.appendChild(p);
        articleList.appendChild(emptyMessage);
        return;
    }


    const sortedArticles = articles.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Render in small idle-time chunks instead of building every card in
    // one synchronous pass. On a large archive the old code blocked the
    // main thread for the whole render — the list sat empty (the
    // innerHTML='' above) until every card was built, which is the
    // "empty screen for a split second" flash. Chunking lets the browser
    // paint the first cards immediately and fill the rest in spare time.
    const CHUNK = 20;
    let index = 0;

    // Long lists: build the first screens now and the rest while scrolling (a sentinel at the end loads the next batch), so
    // thousands of saved articles never mean thousands of cards in the DOM at once. A search renders everything first
    // (filterArticles → flush) because it filters the cards in the DOM. Without IntersectionObserver the idle chunks below run.
    if (typeof IntersectionObserver === 'function' && sortedArticles.length > LAZY_FIRST) {
        const total = sortedArticles.length;
        const sentinel = document.createElement('div');
        sentinel.className = 'list-sentinel'; sentinel.setAttribute('aria-hidden', 'true');
        let obs = null;
        const stop = () => { if (obs) { obs.disconnect(); obs = null; } sentinel.remove(); };
        const append = (n) => {
            if (!sentinel.parentNode) return;   // finished or replaced by a newer render
            const end = Math.min(index + n, total);
            const frag = document.createDocumentFragment();
            for (; index < end; index++) frag.appendChild(buildArticleCard(sortedArticles[index]));
            articleList.insertBefore(frag, sentinel);
            if (index >= total) { stop(); articleList.__lazy = null; return; }
            // the sentinel moved: observe it again so a still-visible sentinel keeps loading
            if (obs) { if (typeof obs.unobserve === 'function') obs.unobserve(sentinel); obs.observe(sentinel); }
        };
        articleList.appendChild(sentinel);
        obs = new IntersectionObserver((entries) => { if (entries.some(e => e.isIntersecting)) append(LAZY_MORE); }, { rootMargin: '800px 0px' });
        articleList.__lazy = { stop, flush: () => append(total - index) };
        append(LAZY_FIRST);
        return;
    }

    const renderChunk = () => {
        const end = Math.min(index + CHUNK, sortedArticles.length);
        for (; index < end; index++) {
            const article = sortedArticles[index];
            const listItem = buildArticleCard(article);
            articleList.appendChild(listItem);
        }
        if (index < sortedArticles.length) {
            articleList.__renderChunkId = scheduleIdle(renderChunk);
        } else {
            articleList.__renderChunkId = null;
        }
    };

    renderChunk();
}

/**
 * Build a single archive list item (li.article-card) for `article`.
 * Extracted from renderArticles() so the chunked renderer can build cards
 * one at a time without duplicating the markup.
 *
 * @param {object} article
 * @returns {HTMLLIElement}
 */
// Notes on the History cards: one count chip per article (✏️ your highlights, ✨ the AI's, 📝 notes), read once and kept until a note changes.
let noteCountsP = null;
const noteCountsOnce = () => (noteCountsP = noteCountsP || import('./notesView.js').then((m) => m.noteCountsByArticle()).catch(() => new Map()));
function paintNoteChip(card, counts) {
    const c = counts.get(card.dataset.aid);
    const old = card.querySelector('.note-chip'); if (old) old.remove();
    if (!c || !(c.mine || c.ai || c.notes)) return;
    const host = card.querySelector('.article-header > div'); if (!host) return;
    let row = host.querySelector('.card-tags');
    if (!row) { row = document.createElement('div'); row.className = 'card-tags'; const anchor = host.querySelector('.article-date'); if (anchor) anchor.after(row); else host.appendChild(row); }
    const chip = document.createElement('span'); chip.className = 'tag-chip note-chip';
    chip.textContent = [c.mine && '✏️ ' + c.mine, c.ai && '✨ ' + c.ai, c.notes && '📝 ' + c.notes].filter(Boolean).join('  ');
    chip.title = [c.mine && TN(c.mine, '{n} highlight', '{n} highlights'), c.ai && TN(c.ai, '{n} AI highlight', '{n} AI highlights'), c.notes && TN(c.notes, '{n} note', '{n} notes')].filter(Boolean).join(' · ');
    row.appendChild(chip);
}
function paintNoteChips() { noteCountsOnce().then((counts) => document.querySelectorAll('#articleList .article-card[data-aid]').forEach((card) => paintNoteChip(card, counts))); }
try {
    let noteTimer = 0;
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (!(SK.annotations in changes || SK.hlIndex in changes || SK.notesIndex in changes || SK.articlesIndex in changes || Object.keys(changes).some((k) => isNoteRecKey(k) || isHlPageKey(k)))) return;
        noteCountsP = null; clearTimeout(noteTimer); noteTimer = setTimeout(paintNoteChips, 250);
    });
} catch (_) { /* no extension storage (tests) */ }

function buildArticleCard(article) {
    const articleHeader = article.title || (article.content && article.content.split('\n')[0]) || T('No title available');
    const listItem = document.createElement('li');
    listItem.classList.add('article-card');
    listItem.dataset.ts = String(article.timestamp);
    if (article.id) listItem.dataset.aid = String(article.id);
    const formattedDate = new Date(article.timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    let articleDomain = '';
    if (article.url) {
        articleDomain = new URL(article.url).hostname;
    }
    const tags = article.tags || [];
    // known and learned topics are shown in the UI language (the stored tag keeps its original); two tags that read the same collapse to one chip
    const shownTags = [...new Set(tags.map(t => topicLabel(t, uiLocale())))];
    const tagsHtml = shownTags.length ? `<div class="card-tags">${shownTags.map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('')}</div>` : '';
    const modelBadge = article.modelId ? `<span class="card-model">${modelIcon(article)} ${escapeHtml(article.modelId)}</span>` : '';

    // Decision metadata (timeframe + reason)
    const decisionHtml = article.isDecision ? `
      <div class="card-decision">
        ${article.decisionTimeframe ? `<span class="decision-chip">🔖 ${escapeHtml(article.decisionTimeframe)}</span>` : ''}
        ${article.decisionReason ? `<span class="decision-reason">"${escapeHtml(article.decisionReason)}"</span>` : ''}
      </div>
    ` : '';

    // eslint-disable-next-line no-unsanitized/property -- reviewed: every fragment is escaped where it is built (tagsHtml, modelBadge, decisionHtml)
    listItem.innerHTML = `
        <div class="article-header">
          <div>
            <h4>${escapeHtml(articleHeader)}</h4>
            <p class="article-date">💾 ${formattedDate} ${article.url ? `${T('from')} <a href="${escAttr(article.url)}" target="_blank" rel="noopener">${escapeHtml(articleDomain)}</a> ↗` : ''}</p>
            ${tagsHtml}
            ${modelBadge}
            ${decisionHtml}
          </div>
          <button class="star-button" title="${escAttr(T('Favorite'))}" aria-label="${escAttr(T('Favorite'))}" aria-pressed="${article.favorite ? 'true' : 'false'}">${icon('star', 'icon--lg')}</button>
        </div>
    `;
    listItem.classList.toggle('is-favorite', !!article.favorite);
    {   // ⋯ actions menu sits next to the star
        const star = listItem.querySelector('.star-button');
        const side = document.createElement('div'); side.className = 'card-side';
        star.replaceWith(side); side.appendChild(star);
        attachCardMenu(side, article);
    }

    // Favorited from a feed but never summarized: one-click summarize.
    if ((article.feedStub || article.savedOnly) && article.url) {
        const sumBtn = document.createElement('button');
        sumBtn.type = 'button';
        sumBtn.className = 'button-primary btn-sm';
        sumBtn.style.marginTop = '8px';
        setIconLabel(sumBtn, 'sparkles', T('✨ Summarize'));
        sumBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            sumBtn.disabled = true;
            setIconLabel(sumBtn, 'loader', T('⏳ Summarizing…'));
            chrome.runtime.sendMessage({ action: 'openFeedItem', url: article.url, summarize: true }, (res) => {
                if (chrome.runtime.lastError || !res || !res.success) {
                    sumBtn.disabled = false;
                    setIconLabel(sumBtn, 'sparkles', T('✨ Summarize'));
                    return;
                }
                // Re-check shortly; the summary replaces this placeholder when saved.
                let tries = 0;
                const poll = setInterval(async () => {
                    tries++;
                    try {
                        const idx = await StorageManager.getArticlesIndex();
                        const done = idx.some(a => !a.feedStub && !a.savedOnly && a.url === article.url);
                        if (done || tries > 40) {
                            clearInterval(poll);
                            if (done && document.getElementById('articleList')?.style.display !== 'none') loadHistory();
                            else { sumBtn.disabled = false; setIconLabel(sumBtn, 'sparkles', T('✨ Summarize')); }
                        }
                    } catch (_) { clearInterval(poll); }
                }, 3000);
            });
        });
        const hdr = listItem.querySelector('.article-header > div');
        if (hdr) hdr.appendChild(sumBtn);
    }

    listItem.querySelector('.star-button').addEventListener('click', async (event) => {
        event.stopPropagation();
        const next = await StorageManager.toggleFavorite(article.id);
        if (next === null) return;
        article.favorite = next;
        paintFavorite(article.id, next);
    });

    // Click on the card itself opens detail
    {   // reading status: badges (and Restore in the Archive tab)
        const host = listItem.querySelector('.article-header > div');
        const badges = statusBadges(article);
        if (host && badges.length) {
            // Status (New / Read / Sent / Archived) is the first chip in the same row as the tags.
            let row = host.querySelector('.card-tags');
            if (!row) {
                row = document.createElement('div');
                row.className = 'card-tags';
                const anchor = host.querySelector('.article-date');
                if (anchor) anchor.after(row); else host.appendChild(row);
            }
            const frag = document.createDocumentFragment();
            badges.forEach(([tone, text]) => { const b = document.createElement('span'); b.className = 'tag-chip status-badge ' + tone; b.textContent = text; frag.appendChild(b); });
            row.prepend(frag);
        }
        const pChips = paperChips(article);
        if (host && pChips.length) {   // 🎓 paper badges share the status/tag row
            let row = host.querySelector('.card-tags');
            if (!row) { row = document.createElement('div'); row.className = 'card-tags'; const anchor = host.querySelector('.article-date'); if (anchor) anchor.after(row); else host.appendChild(row); }
            // Order in the row: status (New / Read / Sent / Archived), then the type (research paper), then the tags.
            const typeFrag = document.createDocumentFragment();
            pChips.forEach(([tone, text]) => { const b = document.createElement('span'); b.className = 'tag-chip paper paper-' + tone; b.textContent = text; typeFrag.appendChild(b); });
            const statusChips = row.querySelectorAll('.status-badge');
            if (statusChips.length) statusChips[statusChips.length - 1].after(typeFrag); else row.prepend(typeFrag);
        }
        if (host && article.archived) {
            const r = document.createElement('button');
            r.type = 'button'; r.className = 'button-secondary status-restore'; r.textContent = T('↩ Restore to Inbox');
            r.addEventListener('click', (e) => { e.stopPropagation(); applyStatus([article.id], { archived: false }); });
            host.appendChild(r);
        }
    }
    registerCard(article, listItem);
    listItem.tabIndex = 0; listItem.setAttribute('role', 'button');   // reachable with Tab; Enter / Space opens it
    listItem.addEventListener('keydown', (event) => {
        if (event.target !== listItem || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        if (selectionActive()) { toggleCard(article); return; }
        showArticleDetail(article);
    });
    // Long-press a card → enter selection mode with it ticked (same as the Select button / ⋯ menu).
    let pressTimer = null, pressed = false, pressX = 0, pressY = 0;
    const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; };
    listItem.addEventListener('pointerdown', (event) => {
        if (event.button > 0 || event.target.closest('button') || event.target.closest('a')) return;
        pressed = false; pressX = event.clientX; pressY = event.clientY;
        if (selectionActive() || !canSelect(article)) return;
        cancelPress();
        pressTimer = setTimeout(() => { pressTimer = null; pressed = true; startSelectionWith(article); }, 500);
    });
    listItem.addEventListener('pointermove', (event) => {
        if (pressTimer && Math.hypot(event.clientX - pressX, event.clientY - pressY) > 10) cancelPress();
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => listItem.addEventListener(ev, cancelPress));
    listItem.addEventListener('contextmenu', (event) => { if (pressed) event.preventDefault(); });
    listItem.addEventListener('click', (event) => {
        if (pressed) { pressed = false; return; }   // the click that ends a long-press must not toggle it back off
        if (event.target.closest('button') || event.target.closest('a')) return;
        if (selectionActive()) { toggleCard(article); return; }
        showArticleDetail(article);
    });

    if (article.id) noteCountsOnce().then((counts) => paintNoteChip(listItem, counts));
    return listItem;
}

/**
 * Schedule `fn` to run during the browser's idle time, falling back to a
 * macrotask when requestIdleCallback isn't available. Returns a handle that
 * can be passed to cancelIdleCallback() (or clearTimeout() for the fallback).
 *
 * @param {() => void} fn
 * @returns {number}
 */
function scheduleIdle(fn) {
    if (typeof requestIdleCallback === 'function') {
        return requestIdleCallback(fn, { timeout: 1000 });
    }
    return setTimeout(fn, 0);
}

/**
 * Cancel a handle returned by scheduleIdle().
 * @param {number} handle
 */
function cancelIdleCallback(handle) {
    if (typeof handle !== 'number') return;
    if (typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(handle);
    } else {
        clearTimeout(handle);
    }
}

// Split workspace: the analytics pane follows the search box too.
let reportSearchTimer = null;
function scheduleReportSearch(filterText, cheapMatch) {
    const reportContainer = document.getElementById('reportContainer');
    if (!wsActive() || !reportContainer || reportContainer.style.display !== 'block') return;
    clearTimeout(reportSearchTimer);
    reportSearchTimer = setTimeout(async () => {
        const all = await StorageManager.getArticlesIndex({ includeArchived: true });
        let list = all;
        if (filterText) {
            let ids = null;
            if (filterText.length >= 3) ids = new Set(tfidfSearch(ensureSearchIndex(), hist.cached, filterText).map(a => String(a.timestamp)));
            list = all.filter(a => cheapMatch(a) || (ids && ids.has(String(a.timestamp))));
        }
        const mod = await import('./analyticsManager.js');
        mod.initAnalyticsReport(reportContainer, list);
    }, 250);
}

export function filterArticles() {
    const searchInput = document.getElementById('searchInput');
    const filterText = searchInput.value.trim();
    const lazyList = document.getElementById('articleList');
    if (filterText && lazyList && lazyList.__lazy) lazyList.__lazy.flush();   // the filter works on rendered cards: render the rest first
    const lowerFilter = filterText.toLowerCase();
    const graphContainer = document.getElementById('graphContainer');

    // Tier 1: cheap title/tag substring match — this is the whole cost for
    // an empty or very short query, same as the original behaviour.
    const cheapMatch = (a) => {
        const titleMatch = (a.title || '').toLowerCase().includes(lowerFilter);
        const tagMatch = (a.tags || []).some(t => tagMatches(t, lowerFilter));
        return titleMatch || tagMatch || paperSearchText(a).includes(lowerFilter);
    };

    // If graph is visible, react to the search box per graphScopeMode:
    // 'filtered' rebuilds to only the matching articles (nodes for
    // non-matches disappear); 'all' keeps every node and just dims
    // non-matches in place (no rebuild, no simulation restart). The graph
    // is keyed on tags anyway, so filtered mode stays on the cheap tier only.
    if (graphContainer && graphContainer.style.display === 'block') {
        if (graphScopeMode === 'all') {
            scheduleGraphSearchDim(graphContainer, filterText);
            if (!wsActive()) return;
        } else {
        const filtered = hist.cached.filter(cheapMatch);
        import('./archiveGraph.js').then(mod => {
            mod.initArchiveGraph(graphContainer, filtered.length > 0 ? filtered : hist.cached, hist.detail?.timestamp, ensureSearchIndex());
        });
        graphContainer.style.opacity = filterText && filtered.length < hist.cached.length ? '0.9' : '1';
        if (!wsActive()) return;
        }
    }
    scheduleReportSearch(filterText, cheapMatch);

    // Tier 2: once the query is long enough to be meaningful (2-char
    // queries match almost everything and aren't worth indexing), widen
    // the search to summary/content via the prebuilt TF-IDF index. This is
    // an index lookup, not a re-scan of every article's full text.
    let indexedMatchIds = null;
    if (filterText.length >= 3) {
        const index = ensureSearchIndex();
        const ranked = tfidfSearch(index, hist.cached, filterText);
        indexedMatchIds = new Set(ranked.map(a => String(a.timestamp)));
    }

    const cards = document.querySelectorAll('.article-card');
    cards.forEach(card => {
        if (!filterText) { card.style.display = 'block'; return; }
        const heading = card.querySelector('.article-header h4');
        if (!heading) return; // a loading skeleton card has no title yet: nothing to filter, and it must not throw while the list is being built
        const headerText = heading.textContent.toLowerCase();
        const tagText = Array.from(card.querySelectorAll('.tag-chip'))
            .map(chip => chip.textContent.toLowerCase()).join(' ');
        const art = hist.cached.find(x => String(x.timestamp) === card.dataset.ts) || hist.archived.find(x => String(x.timestamp) === card.dataset.ts);
        const cheapHit = headerText.includes(lowerFilter) || tagText.includes(lowerFilter) || (art ? paperSearchText(art).includes(lowerFilter) : false);
        const indexedHit = indexedMatchIds ? indexedMatchIds.has(card.dataset.ts) : false;
        card.style.display = (cheapHit || indexedHit) ? 'block' : 'none';
    });
}

/**
 * Fills in the #localInsights placeholder for the current article detail
 * view with reading-level/sentiment badges and "similar in your archive"
 * links. Everything here runs on-device: readingLevel/sentiment are pure
 * text math (textMetrics.js), and similarTo() reuses the same TF-IDF index
 * search already builds — no extra indexing pass, no network calls.
 */
export async function renderLocalInsights(article, container) {
    if (!container) return;
    try {
        const index = ensureSearchIndex();
        const [metrics, related] = await Promise.all([
            computeMetrics(article),
            Promise.resolve(similarTo(index, hist.cached, article, { limit: 4 }))
        ]);

        const badges = [];
        if (metrics.readingLevel) {
            badges.push(`<span class="tag-chip insight-chip" title="${escAttr(T('Flesch reading ease: {ease}/100', { ease: metrics.readingLevel.ease }))}">📖 ${T('{label} · grade {grade}', { label: metrics.readingLevel.label, grade: metrics.readingLevel.grade })}</span>`);
        }
        if (metrics.sentiment && metrics.sentiment.matches > 0) {
            const moodEmoji = metrics.sentiment.label === 'Positive' ? '🙂' : metrics.sentiment.label === 'Negative' ? '🙁' : '😐';
            badges.push(`<span class="tag-chip insight-chip">${moodEmoji} ${metrics.sentiment.label === 'Positive' ? T('Positive tone') : metrics.sentiment.label === 'Negative' ? T('Negative tone') : metrics.sentiment.label === 'Neutral' ? T('Neutral tone') : T('{label} tone', { label: metrics.sentiment.label })}</span>`);
        }
        if (metrics.estimatedMinutes) {
            badges.push(`<span class="tag-chip insight-chip">⏱️ ${T('~{n} min read', { n: metrics.estimatedMinutes })}</span>`);
        }

        const relatedHtml = related.length ? `
          <div class="related-articles">
            <strong class="related-articles-title">${T('🔗 Similar in your archive')}</strong>
            ${related.map(r => `<div class="related-article-link" data-ts="${escAttr(r.article.timestamp)}">${escapeHtml(r.article.title || T('Untitled'))} <span class="related-article-score">(${T('{n}% similar', { n: Math.round(r.score * 100) })})</span></div>`).join('')}
          </div>` : '';

        // eslint-disable-next-line no-unsanitized/property -- reviewed: badges and related cards are built with escapeHtml/escAttr/T
        container.innerHTML = `${badges.length ? `<div class="insight-chips">${badges.join('')}</div>` : ''}${relatedHtml}`;

        container.querySelectorAll('.related-article-link').forEach(el => {
            el.addEventListener('click', () => {
                const match = hist.cached.find(a => String(a.timestamp) === el.dataset.ts);
                if (match) showArticleDetail(match);
            });
        });
    } catch (err) {
        // Silent by design — local insights are a bonus, never worth
        // interrupting the article detail view over.
        console.warn('[AISH] Local insights failed:', err);
        container.innerHTML = '';
    }
}

/** Back from the article: focus the card it was opened from (or the first one). */
function restoreCardFocus(id) {
    const list = document.getElementById('articleList');
    if (!list) return;
    const card = (id && [...list.querySelectorAll('li[data-id]')].find(li => li.dataset.id === id)) || list.querySelector('li[tabindex="0"]');
    if (card) card.focus({ preventScroll: true });
    if (card && typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'nearest' });
}
