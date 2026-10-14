import { mountReadingTools, destroyReadingTools } from './readingTools.js';
import { showSkeleton, clearSkeleton } from './skeleton.js';
import { modelIcon } from './modelBadge.js';
import { icon, iconEl, setIconLabel, stripEmoji } from './icons.js';
import { TOOLBAR_CATALOG, TOOLBAR_PREF, DEFAULT_TOOLBAR, normalizeToolbar } from './detailToolbar.js';
import { SK } from './storageKeys.js';
import { escapeHtml, cleanUntrustedHtml } from './textUtils.js';
// Article Manager
// Handles article rendering, expand/collapse, search, etc.


import StorageManager from './storageManager.js';
import { syncTabbarLater } from './tabbar.js';
import { sendToLocalSend } from './localSendClient.js';
import { buildIndex, search as tfidfSearch, similarTo } from './localSearch.js';
import { computeMetrics } from './textMetrics.js';
import { initSelection, registerCard, toggleCard, selectionActive, canSelect, startSelectionWith } from './sendSheet.js';
import { attachCardMenu } from './cardMenu.js';
import { T, locale, uiLocale } from './feedI18n.js';
import { topicLabel } from './topicConcepts.js';
import { tagMatches } from './topicConcepts.js';
import { loadLexicon } from './topicLexicon.js';
import { withQuestions, qaMarkdown } from './conversation.js';
import { qaSection } from './qaView.js';
import { normalizeDoi } from '../content/paper.js';
import { paperState, paperChips, paperDoi, doiUrl, paperLine, paperType, paperFacts, paperSearchText, extractPaperFacts } from './paperInfo.js';
import { aiComplete } from './feedAi.js';
import { mountPhoneCards, loadPhoneEntries, pollInbox } from './inboxView.js';
import { createInboxManager } from './inboxManager.js';
import { articleForPhone } from './articleBlocks.js';
import { CITE_STYLES, formatCitation, ensureCsl, copyText, getCiteStyle, loadCiteStyle, setCiteStyle } from './citation.js';
import { buildAnnotationsSection, fetchAnnotationsForArticle, buildAnnotationsPlainText, markHighlights } from './annotationExporter.js';

// Escapes translated text for use inside double-quoted HTML attributes.
const escAttr = escapeHtml;
/** Translated label whose translations still carry the old emoji, text only (the control gets an SVG icon). */
const lbl = (key) => escapeHtml(stripEmoji(T(key)));

let uiManagerRef = null;
let currentDetailArticle = null;
let cachedArticles = [];          // not archived: graph, search and the Inbox/Read/Sent tabs read from here
let archivedCache = [];           // archived entries (Archive tab)
let historyTab = 'inbox';         // 'inbox' | 'read' | 'sent' | 'archive'
let pendingRender = false;
let historyLoaded = false;        // the archive has been read once: before that a phone-inbox event must not paint a half list

const isSent = (a) => Array.isArray(a.sentTo) && a.sentTo.length > 0;
const TAB_DEFS = [['inbox', () => T('Inbox')], ['read', () => T('Read')], ['sent', () => T('Sent')], ['research', () => T('Research')], ['collections', () => T('Collections')], ['archive', () => T('Archive')]];
let collectionCount = 0;   // shown on the Collections tab; refreshed when that tab renders or a collection changes
const RESEARCH_FILTERS = [['all', () => T('All')], ['review', () => T('Reviews')], ['trial', () => T('Trials')], ['preprint', () => T('Preprints')]];
let researchFilter = 'all';

function tabList(tab) {
    if (tab === 'read') return cachedArticles.filter(a => a.readAt);
    if (tab === 'sent') return cachedArticles.filter(isSent);
    if (tab === 'archive') return archivedCache;
    if (tab === 'collections') return [];   // not articles: collectionsView.js draws this tab
    if (tab === 'research') return cachedArticles.filter(a => paperState(a) && (researchFilter === 'all' || paperType(a) === researchFilter));
    return cachedArticles;
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
        if (id === 'research') b.hidden = historyTab !== 'research' && !cachedArticles.some(a => paperState(a));   // only for people who save papers
        b.lastChild.textContent = String(id === 'research' ? cachedArticles.filter(a => paperState(a)).length : id === 'collections' ? collectionCount : tabList(id).length);
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

/**
 * Change reading status for several articles (storage + caches + list).
 * patch: { read?, sent?: {kind,label}, archived? } — see StorageManager.patchArticleStatus.
 */
export async function applyStatus(ids, patch) {
    await StorageManager.patchArticleStatus(ids, patch);
    const all = await StorageManager.getArticlesIndex({ includeArchived: true });
    cachedArticles = all.filter(a => !a.archived);
    archivedCache = all.filter(a => a.archived);
    invalidateSearchIndex();
    const list = document.getElementById('articleList');
    if (list && list.style.display !== 'none') renderTab(); else pendingRender = true;
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

function invalidateSearchIndex() {
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
    if (graphScopeMode === 'all') return cachedArticles;
    const searchInput = document.getElementById('searchInput');
    const filterText = (searchInput?.value || '').toLowerCase();
    if (!filterText) return cachedArticles;
    const filtered = cachedArticles.filter(a => {
        const titleMatch = (a.title || '').toLowerCase().includes(filterText);
        const tagMatch = (a.tags || []).some(t => tagMatches(t, filterText));
        return titleMatch || tagMatch;
    });
    return filtered.length > 0 ? filtered : cachedArticles;
}

/**
 * Records that an article was opened (viewed in the detail view). This is
 * the "follow-through" signal the knowledge graph uses to surface neglected
 * saves — an article that sits unopened past the threshold fades/shrinks
 * in the graph. Persisted to storage so it survives reloads.
 */
function recordArticleOpened(article) {
    if (!article || !article.id) return;
    const now = new Date().toISOString();
    article.lastOpened = now;
    // Keep the in-memory cache in sync so the graph (which reads from
    // cachedArticles) reflects the update immediately.
    const idx = cachedArticles.findIndex(a => a.id === article.id);
    if (idx !== -1) cachedArticles[idx].lastOpened = now;
    StorageManager.touchArticleOpened(article.id).catch(() => {});
}

function ensureSearchIndex() {
    if (!searchIndex || searchIndexDirty) {
        searchIndex = buildIndex(cachedArticles);
        searchIndexDirty = false;
    }
    return searchIndex;
}

function buildSafeArticleTitle(title) {
    return (title || 'AI Summary').replace(/[^a-z0-9_-]/gi, '_');
}

async function includeAllQuestions() {
    try { return !!(await StorageManager.getLocal({ [SK.exportAllQuestions]: false }))[SK.exportAllQuestions]; } catch (_) { return false; }
}
async function conversationOf(article) {
    return Array.isArray(article.conversation) ? article.conversation : (article.id ? StorageManager.getConversation(article.id) : []);
}
/** Article copy whose summary also carries the pinned questions (all of them when "Include all questions" is on). */
async function exportView(article) {
    const turns = await conversationOf(article);
    if (!turns.length) return article;
    let base = article.summaryBase;
    if (base === undefined && article.id) {   // lean index entries already carry the pinned block: start from the original text
        try { const full = await StorageManager.getArticleFull(article.id); base = full.summaryBase !== undefined ? full.summaryBase : full.summary; } catch (_) { /* fall back below */ }
    }
    return { ...article, summary: withQuestions(base !== undefined ? base : article.summary, turns, { all: await includeAllQuestions() }) };
}

async function buildArticleDocumentHtml(article) {
    article = await exportView(article);
    // Include the article's highlights & AI suggested highlights (ghosts
    // included even if never marked "keep").
    const annotations = await fetchAnnotationsForArticle(article);
    const annotationsHtml = await buildAnnotationsSection(article, annotations);
    // One pass over the document: a highlight is marked once (full text wins over the summary).
    const placed = new Set();
    const contentHtml = markHighlights(article.content, annotations, placed);
    const summaryHtml = markHighlights(article.summary, annotations, placed);
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(article.title || 'AI Summary')}</title>
<style>body{font-family:sans-serif;line-height:1.6;padding:20px;max-width:800px;margin:auto;}h1{border-bottom:2px solid #333;padding-bottom:5px;}.meta{color:#555;font-style:italic;}.summary{background:#f8f9fa;padding:15px;border-left:4px solid #0284c7;margin:20px 0;}img{max-width:100%;height:auto;}</style>
</head><body><h1>${escapeHtml(article.title || 'AI Summary')}</h1>
<div class="meta">Captured via AI Summary Helper &middot; <a href="${escAttr(article.url || '#')}">Source</a></div>
${summaryHtml ? `<div class="summary"><h2>🧙 AI Summary</h2>${summaryHtml}</div>` : ''}
${annotationsHtml}
${contentHtml ? `<h2>📄 Content</h2><div>${contentHtml}</div>` : ''}</body></html>`;
}

export const __test_buildDoc = (a) => buildArticleDocumentHtml(a);

async function buildArticleHtmlFile(article) {
    const safeTitle = buildSafeArticleTitle(article.title);
    const fileName = `${safeTitle}.html`;
    const docHtml = await buildArticleDocumentHtml(article);
    const blob = new Blob([docHtml], { type: 'text/html' });
    const file = new File([blob], fileName, { type: 'text/html' });
    return { file, fileName, docHtml };
}

/**
 * Triggers the native OS share sheet
 */
export async function shareArticle(article) {
    if (!navigator.share) {
        if (uiManagerRef) uiManagerRef.showToast(T('Sharing is not supported in this browser/environment.'));
        else alert(T('Sharing is not supported in this browser/environment.'));
        return;
    }

    try {
        const { file } = await buildArticleHtmlFile(article);
        const fileShareData = {
            title: article.title || 'AI Summary',
            files: [file]
        };

        // Prefer file sharing so AirDrop imports as an offline document.
        if (navigator.canShare && navigator.canShare(fileShareData)) {
            await navigator.share(fileShareData);
            if (uiManagerRef) uiManagerRef.showToast(T('File shared successfully.'));
            return;
        }

        // Fallback for environments that only support URL/text share.
        await navigator.share({
            title: article.title || 'AI Summary',
            text: `Check out this summary: \n\n${article.summary || ''}\n\nRead more at:`,
            url: article.url || ''
        });
    } catch (err) {
        console.error('Share failed:', err);
        if (uiManagerRef && err?.name !== 'AbortError') {
            uiManagerRef.showToast(T('Share failed: {message}', { message: err?.message || T('Unknown error') }));
        }
    }
}
/** The article as one Markdown note (YAML front matter, summary, Q&A, highlights, original text). */
async function buildMarkdown(article) {
    // The list passes lean index entries (no page text): the original content lives in the full record.
    if (article && article.id && !article.content) {
        try { const full = await StorageManager.getArticleFull(article.id); if (full) article = { ...article, ...full }; } catch (_) { /* export what we have */ }
    }
    // 1. Format date as YYYY-MM-DD for Obsidian frontmatter
    const createdDate = new Date(article.timestamp).toISOString().split('T')[0];
    
    // 2. Sanitize title for YAML (escape double quotes)
    const safeTitle = (article.title || 'Untitled Article').replace(/"/g, '\\"');
    
    // 3. Format tags into YAML list format
    let tagsFrontmatter = 'tags:';
    if (article.tags && article.tags.length > 0) {
        tagsFrontmatter += '\n' + article.tags.map(tag => `  - "${tag.replace(/"/g, '\\"')}"`).join('\n');
    }

    // Paper fields (only for pages detected / marked as papers)
    const pm = (paperState(article) && article.meta && article.meta.paper) || {};
    const yamlStr = (v) => v ? `"${String(v).replace(/"/g, '\\"')}"` : '';
    const doi = paperState(article) ? paperDoi(article) : '';
    const paperFm = (doi ? `\ndoi: "${doi}"` : '') + (pm.journal ? `\njournal: ${yamlStr(pm.journal)}` : '') + (paperState(article) ? '\ntype: paper' : '');

    // 4. Construct the YAML Frontmatter
    const frontmatter = `---
title: "${safeTitle}"
source: "${article.url || ''}"
author: ${yamlStr(pm.authors || (article.meta && article.meta.author) || '')}
published: ${yamlStr(pm.year || '')}
created: ${createdDate}${paperFm}
description: 
${tagsFrontmatter}
bookrecs: 
why: 
---`;

    // 5. Construct the Markdown Body — convert vanilla <img> and <a> to Markdown
    const baseSummary = article.summaryBase !== undefined ? article.summaryBase : article.summary;
    const summaryPlain = baseSummary ? baseSummary.replace(/<[^>]+>/g, '').trim() : 'No summary available.';

    // Parse stored clean HTML and convert tags to Markdown syntax
    const parser = new DOMParser();
    const doc = parser.parseFromString(article.content || '', 'text/html');

    // Convert <img> to ![alt](src)
    const images = doc.querySelectorAll('img');
    images.forEach(img => {
        const alt = img.getAttribute('alt') || 'image';
        const src = img.getAttribute('src') || '';
        if (src) {
            const mdSyntax = `\n\n![${alt}](${src})\n\n`;
            img.parentNode.replaceChild(doc.createTextNode(mdSyntax), img);
        } else {
            img.remove();
        }
    });

    // Convert <a> to [text](url)
    const links = doc.querySelectorAll('a');
    links.forEach(link => {
        const text = link.textContent.trim() || 'Link';
        const href = link.getAttribute('href') || '';
        if (href) {
            const mdSyntax = `[${text}](${href})`;
            link.parentNode.replaceChild(doc.createTextNode(mdSyntax), link);
        }
    });

    const contentPlain = doc.body.textContent || 'No content available.';

    // Include the article's highlights & AI suggested highlights (ghosts
    // included even if never marked "keep").
    const annotationsPlain = await buildAnnotationsPlainText(article);

    const qaMd = qaMarkdown(await conversationOf(article), { all: await includeAllQuestions() });
    const mdContent = `${frontmatter}

# Summary
${summaryPlain}
${qaMd ? '\n' + qaMd : ''}
${annotationsPlain}

---

## 📝 Original Content
${contentPlain.trim().replace(/\n{3,}/g, '\n\n')}
`;
    return { mdContent, createdDate };
}

const markdownFileBase = (article, createdDate) => `${createdDate}_${(article.title || 'article').replace(/[^a-z0-9]/gi, '_').toLowerCase()}_summary`;

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportToMarkdown(article) {
    const { mdContent, createdDate } = await buildMarkdown(article);
    downloadBlob(new Blob([mdContent], { type: 'text/markdown' }), `${markdownFileBase(article, createdDate)}.md`);
}

/** Word (.docx) export of the same note — no library: markdownToDocx writes the few XML parts Word needs. */
export async function exportToWord(article) {
    const { mdContent, createdDate } = await buildMarkdown(article);
    const { markdownToDocx } = await import('./docxExport.js');
    downloadBlob(await markdownToDocx(mdContent.replace(/^---\n[\s\S]*?\n---\n/, '')), `${markdownFileBase(article, createdDate)}.docx`);
}

/** Text document (.odt, OpenDocument): opens in LibreOffice, OnlyOffice, Pages, Nextcloud and Word. */
export async function exportToDocument(article) {
    const { mdContent, createdDate } = await buildMarkdown(article);
    const { markdownToOdt } = await import('./odtExport.js');
    downloadBlob(await markdownToOdt(mdContent.replace(/^---\n[\s\S]*?\n---\n/, '')), `${markdownFileBase(article, createdDate)}.odt`);
}

/** PDF: the reader page in print mode — the browser's "Save as PDF" gives a clean, typeset document. */
export async function exportToPdf(article) {
    if (!article.id) return;
    const url = chrome.runtime.getURL('readerPage.html') + '#id=' + encodeURIComponent(article.id) + '&print=1';
    try { if (chrome.tabs && chrome.tabs.create) { await chrome.tabs.create({ url }); return; } } catch (_) { /* fall through */ }
    window.open(url, '_blank', 'noopener');
}

/** Obsidian: the note goes through the clipboard (a URI is too short for long articles), then obsidian://new opens it in the default vault. */
export async function sendToObsidian(article) {
    const { mdContent, createdDate } = await buildMarkdown(article);
    const name = (article.title || 'Untitled').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
    try { await navigator.clipboard.writeText(mdContent); }
    catch (_) { downloadBlob(new Blob([mdContent], { type: 'text/markdown' }), `${markdownFileBase(article, createdDate)}.md`); return; }
    const a = document.createElement('a');
    a.href = `obsidian://new?name=${encodeURIComponent(name)}&clipboard`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

/**
 * Copies summary and content to clipboard as formatted text (HTML) and plain text (Markdown-ish)
 */
export async function copyArticleToClipboard(article) {
    article = await exportView(article);
    const title = article.title || 'AI Summary';
    const summary = article.summary || '';
    const content = article.content || '';

    // Fetch annotations (user + ghost) once and reuse for both mime types.
    const annotations = await fetchAnnotationsForArticle(article);
    const annotationsHtml = await buildAnnotationsSection(article, annotations);
    const annotationsPlain = await buildAnnotationsPlainText(article, annotations);

    const placedSet = new Set();
    const contentMarked = markHighlights(content, annotations, placedSet);   // full text first, summary only for the rest
    const summaryMarked = markHighlights(summary, annotations, placedSet);

    // Create a clean HTML version for the clipboard
    const cleanHtml = `
        <div style="font-family: sans-serif;">
            <h1>${escapeHtml(title)}</h1>
            <p><a href="${escAttr(article.url)}">${escapeHtml(article.url)}</a></p>
            <hr>
            <h2>🧙 AI Summary</h2>
            <div>${summaryMarked}</div>
            ${annotationsHtml ? `<hr><div>${annotationsHtml}</div>` : ''}
            <hr>
            <h2>📄 Original Content</h2>
            <div>${contentMarked}</div>
        </div>
    `.replace(/style="[^"]*"/gi, (match) => {
        // Keep ONLY the top-level font family for the container, strip all other styles
        return match.includes('font-family: sans-serif') ? match : '';
    });

    // Create a plain text / markdown version
    const plainText = `# ${title}\nSource: ${article.url || 'N/A'}\n\n## 🧙 AI SUMMARY\n${summary.replace(/<[^>]+>/g, '').trim()}\n\n${annotationsPlain}\n\n---\n\n## 📄 ORIGINAL CONTENT\n${content.replace(/<[^>]+>/g, '').trim()}`;

    try {
        const typeHtml = 'text/html';
        const typePlain = 'text/plain';
        const blobHtml = new Blob([cleanHtml], { type: typeHtml });
        const blobPlain = new Blob([plainText], { type: typePlain });
        
        const data = [new ClipboardItem({
            [typeHtml]: blobHtml,
            [typePlain]: blobPlain
        })];

        await navigator.clipboard.write(data);
        if (uiManagerRef) uiManagerRef.showToast(T('Copied to clipboard! 📋'));
    } catch (err) {
        console.error('Clipboard copy failed:', err);
        // Fallback for cases where ClipboardItem might fail
        try {
            await navigator.clipboard.writeText(plainText);
            if (uiManagerRef) uiManagerRef.showToast(T('Copied as plain text.'));
        } catch (e) {
            console.error('Final copy fallback failed:', e);
        }
    }
}


/**
 * Sends article summary and content to a Kindle email via the proxy API
 */
export async function sendToKindle(article) {
    article = await exportView(article);
    const config = await StorageManager.getAll();
    // Multiple Kindle devices can be configured; always send to the active
    // one (last used, or the first configured if none has been used yet).
    const device = StorageManager.getActiveDevice(config, 'kindle');
    const kindleEmail = (device?.addresses?.[0] || '').replace(/^mailto:/i, '');
    if (!kindleEmail) {
        if (uiManagerRef) {
            uiManagerRef.showToast(T('Set your Kindle email in Settings first.'));
            uiManagerRef.showScreen('settings');
            import('./settingsNav.js').then(m => m.openSettingsPanel('send', 'newKindleEmail')).catch(() => {});
        } else {
            alert(T('Please configure your Kindle delivery email address inside settings first.'));
        }
        return;
    }

    const isPro = config[SK.user]?.subscription_status === 'active';
    if (!isPro) {
        const confirmation = confirm(T('📚 Send to Kindle\n\nFree tier: 3 Kindle sends included.\nUpgrade to Pro for unlimited.\n\nMake sure kindle@byphil.eu is in your Kindle approved senders list (see Amazon help).\n\nSend this article to Kindle?'));
        if (!confirmation) return;
    }

    // Content now arrives pre-optimized from content capture.
    if (uiManagerRef) {
        uiManagerRef.showToast(T('Preparing Kindle delivery... ⏳'), 3000);
    }

    try {
        const apiBase = StorageManager.getApiBase();
        const headers = { 'Content-Type': 'application/json' };
        if (config[SK.token]) {
            headers['Authorization'] = `Bearer ${config[SK.token]}`;
        } else if (config[SK.licenseKey]) {
            headers['Authorization'] = `Bearer ${config[SK.licenseKey]}`;
        }

        const annotations = await fetchAnnotationsForArticle(article);
        const annotationsHtml = await buildAnnotationsSection(article, annotations);

        const response = await fetch(`${apiBase}/v1/projects/ai_summary_helper/kindle`, {
            method: 'POST',
            headers,
            body: (() => { const kPlaced = new Set(); return JSON.stringify({
                kindle_email: kindleEmail,
                title: article.title || 'AI Summary Document',
                content: [markHighlights(article.content || article.summary || '', annotations, kPlaced), annotationsHtml].filter(Boolean).join('\n'),
                summary: markHighlights(article.summary || '', annotations, kPlaced),
                url: article.url || ''
            }); })()
        });

        const resData = await response.json();
        if (response.ok && resData.success) {
            if (uiManagerRef) uiManagerRef.showToast(T('Sent to Kindle! 📚'));
            if (device) StorageManager.setActiveDevice('kindle', device.id);
            if (article.id) applyStatus([article.id], { sent: { kind: 'kindle', label: device?.label || '' } }).catch(() => {});
        } else {
            const msg = resData.error || T('Kindle delivery failed.');
            if (resData.error?.includes('Free tier limit') || resData.error?.includes('402')) {
                alert(T('📚 Free tier limit reached (3 sends).\n\nUpgrade to Pro for unlimited Kindle delivery.\n\nhttps://philwornath.com/links'));
            } else if (uiManagerRef) {
                uiManagerRef.showToast(msg);
            } else {
                alert(msg);
            }
        }
    } catch (err) {
        console.error('Kindle dispatch error:', err);
        if (uiManagerRef) uiManagerRef.showToast(T('Network error sending to Kindle.'));
    }
}

export async function dispatchToLocalSend(article) {
    const config = await StorageManager.getAll();
    // Multiple LocalSend receivers can be configured; always send to the
    // active one (last used, or the first configured if none has been used yet).
    const device = StorageManager.getActiveDevice(config, 'localsend');
    const readerIp = (device?.addresses?.[0] || '').trim();

    if (!readerIp) {
        if (uiManagerRef) {
            uiManagerRef.showToast(T('Please set your LocalSend IP in Settings first.'));
            uiManagerRef.showScreen('settings');
            import('./settingsNav.js').then(m => m.openSettingsPanel('send', 'newLocalSendIp')).catch(() => {});
        } else {
            alert(T('Configure your LocalSend IP address inside settings first.'));
        }
        return;
    }

    if (uiManagerRef) uiManagerRef.showToast(T('Sending to LocalSend over Wi-Fi... 🚀'));

    try {
        const { fileName, docHtml } = await buildArticleHtmlFile(article);

        await sendToLocalSend(readerIp, fileName, docHtml, 'text/html');

        if (uiManagerRef) uiManagerRef.showToast(T('Sent successfully! 📖'));
        if (device) StorageManager.setActiveDevice('localsend', device.id);
        if (article.id) applyStatus([article.id], { sent: { kind: 'localsend', label: device?.label || '' } }).catch(() => {});
    } catch (err) {
        console.error('[LocalSend Error]', err);
        if (uiManagerRef) uiManagerRef.showToast(T('Transfer failed: {message}', { message: err?.message || T('Check if receiver is online.') }));
    }
}

/** Sends the article's full text to the paired phone (end-to-end encrypted through the byPhil inbox) to read on the go. */
export async function sendToPhone(article) {
    const toast = (m) => { if (uiManagerRef) uiManagerRef.showToast(m); };
    const openPanel = () => import('./settingsNav.js').then((m) => m.openSettingsPanel('phoneinbox')).catch(() => {});
    const mgr = createInboxManager();
    try {
        if (!(await mgr.status()).paired) {
            toast(T('Pair your phone first: Settings → Phone inbox.'));
            if (uiManagerRef) uiManagerRef.showScreen('settings');
            openPanel();
            return;
        }
        let full = article;
        if (article.id && article.content === undefined) {
            try { full = { ...article, ...(await StorageManager.getArticleFull(article.id)) }; } catch (_) { /* send what we have */ }
        }
        let enabledNow = false;
        if (!(await mgr.status()).toPhone) {
            const on = await mgr.enableToPhone();
            if (!on.ok) { toast(T('Could not switch on Send to phone: {message}', { message: phoneErrorText(on.error) })); return; }
            enabledNow = true;
        }
        toast(T('Sending to your phone…'));
        const parse = (html) => new DOMParser().parseFromString(html, 'text/html').body;
        let marks = [];
        try { marks = await fetchAnnotationsForArticle(full); } catch (_) { /* send without highlights */ }
        const r = await mgr.sendArticle(articleForPhone(full, parse, marks));
        if (!r.ok) { toast(T('Could not send to your phone: {message}', { message: phoneErrorText(r.error) })); return; }
        if (enabledNow) {
            toast(T('Sent. To receive it, scan the new code in the phone app once (Settings → Phone inbox).'));
            if (uiManagerRef) uiManagerRef.showScreen('settings');
            openPanel();
        } else {
            toast(r.truncated ? T('Sent to your phone (long article shortened). It arrives within about 15 minutes.') : T('Sent to your phone. It arrives within about 15 minutes.'));
        }
        if (article.id) applyStatus([article.id], { sent: { kind: 'phone', label: '' } }).catch(() => {});
    } catch (err) {
        console.error('[Send to phone]', err);
        toast(T('Could not send to your phone: {message}', { message: err?.message || '' }));
    }
}

function phoneErrorText(code) {
    switch (code) {
        case 'too-large': return T('this article is too large');
        case 'rate-limited': return T('too many sends, try again later');
        case 'inbox-full': return T('the phone has not collected the earlier articles yet');
        case 'pairing-invalid': return T('the pairing is no longer valid, pair again');
        case 'unreachable': return T('the server is not reachable');
        case 'unreadable': return T('the article could not be prepared');
        default: return T('unknown error');
    }
}

/**
 * Non-interactive deliveries used by the History multi-select sheet (sendSheet.js).
 * They return {ok, error?} instead of toasting, so the sheet can show progress per item.
 */
export async function deliverKindle(article, device) {
    article = await exportView(article);
    const config = await StorageManager.getAll();
    const kindleEmail = (device?.addresses?.[0] || '').replace(/^mailto:/i, '');
    if (!kindleEmail) return { ok: false, error: T('No Kindle email set.') };
    try {
        const apiBase = StorageManager.getApiBase();
        const headers = { 'Content-Type': 'application/json' };
        if (config[SK.token]) headers['Authorization'] = `Bearer ${config[SK.token]}`;
        else if (config[SK.licenseKey]) headers['Authorization'] = `Bearer ${config[SK.licenseKey]}`;
        const annotations = article.id ? await fetchAnnotationsForArticle(article) : [];
        const annotationsHtml = article.id ? await buildAnnotationsSection(article, annotations) : '';
        const response = await fetch(`${apiBase}/v1/projects/ai_summary_helper/kindle`, {
            method: 'POST', headers,
            body: (() => { const kPlaced = new Set(); return JSON.stringify({
                kindle_email: kindleEmail,
                title: article.title || 'AI Summary Document',
                content: [markHighlights(article.content || article.summary || '', annotations, kPlaced), annotationsHtml].filter(Boolean).join('\n'),
                summary: markHighlights(article.summary || '', annotations, kPlaced),
                url: article.url || ''
            }); })()
        });
        const resData = await response.json().catch(() => ({}));
        if (response.ok && resData.success) return { ok: true };
        return { ok: false, error: resData.error || T('Kindle delivery failed.') };
    } catch (err) {
        return { ok: false, error: err?.message || T('Network error') };
    }
}

export async function deliverLocalSend(article, device) {
    const ip = (device?.addresses?.[0] || '').trim();
    if (!ip) return { ok: false, error: T('No receiver address set.') };
    try {
        const { fileName, docHtml } = await buildArticleHtmlFile(article);
        await sendToLocalSend(ip, fileName, docHtml, 'text/html');
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err?.message || T('Check if the receiver is online.') };
    }
}

const wsActive = () => !!document.getElementById('historyScreen')?.classList.contains('ws-active');

/** Keeps every star in sync (list card, detail bar, caches) after a favorite change. */
function paintFavorite(id, on) {
    const c = cachedArticles.find(a => a.id === id); if (c) c.favorite = on;
    const ar = archivedCache.find(a => a.id === id); if (ar) ar.favorite = on;
    if (currentDetailArticle && currentDetailArticle.id === id) currentDetailArticle.favorite = on;
    const li = document.querySelector(`#articleList li[data-id="${CSS.escape(String(id))}"]`);
    if (li) { li.classList.toggle('is-favorite', on); const b = li.querySelector('.star-button'); if (b) { b.setAttribute('aria-pressed', String(on)); } }
    const d = document.getElementById('detailStarBtn');
    if (d && currentDetailArticle && currentDetailArticle.id === id) paintDetailStar(on);
}
function paintDetailStar(on) {
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
            cachedArticles = cachedArticles.filter(a => !gone.has(a.id)); archivedCache = archivedCache.filter(a => !gone.has(a.id));
            invalidateSearchIndex();
        },
        pruneIds: async (ids) => {
            const sh = await import('./storageHealth.js');
            const all = await StorageManager.getArticlesIndex({ includeArchived: true });
            await sh.dropPageText(all, ids, SK.articlesIndex);
            const done = new Set(ids);
            [cachedArticles, archivedCache].forEach(l => l.forEach(a => { if (done.has(a.id)) a.contentPruned = true; }));
        },
        onDone: (n, how) => { storageHint = null; renderTab(); if (uiManagerRef) uiManagerRef.showToast(how === 'pruned' ? T('Page text of {n} articles removed', { n }) : T('{n} articles deleted', { n })); },
    }));
    later.addEventListener('click', async () => { storageHint = 'none'; box.remove(); await StorageManager.setLocal({ [SK.storageHint]: new Date().toISOString() }); });
    box.append(tx, go, later);
    articleList.prepend(box);
}

/** Pencil next to the title in the article detail: rename the saved article (Enter or leaving the field saves, Esc cancels). */
function mountTitleEdit(article, h3) {
    if (!h3 || !article || !article.id) return;
    const pen = document.createElement('button');
    pen.type = 'button'; pen.className = 'detail-title-edit';
    pen.append(iconEl('pencil', 'icon--sm'));
    pen.title = T('Rename'); pen.setAttribute('aria-label', T('Rename'));
    h3.appendChild(pen);
    pen.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'text'; input.className = 'detail-title-input'; input.maxLength = 200; input.value = article.title || '';
        input.setAttribute('aria-label', T('Title'));
        // The title is plain text inside the h3 (escaped HTML); rebuild it as one text node to be safe.
        const setText = (title) => { [...h3.childNodes].forEach(n => { if (n !== pen && !(n.nodeType === 1 && n.classList.contains('detail-fav'))) n.remove(); }); h3.insertBefore(document.createTextNode(title), pen); };
        const original = article.title || '';
        [...h3.childNodes].forEach(n => { if (n !== pen && !(n.nodeType === 1 && n.classList.contains('detail-fav'))) n.remove(); });
        pen.hidden = true; h3.insertBefore(input, pen); input.focus(); input.select();
        let done = false;
        const finish = async (save) => {
            if (done) return; done = true;
            const next = input.value.replace(/\s+/g, ' ').trim();
            input.remove(); pen.hidden = false;
            if (save && next && next !== original) {
                const stored = await StorageManager.setTitle(article.id, next);
                if (stored) {
                    article.title = stored;
                    [cachedArticles, archivedCache].forEach(list => { const hit = list.find(a => a.id === article.id); if (hit) hit.title = stored; });
                    invalidateSearchIndex();
                    setText(stored);
                    if (uiManagerRef) uiManagerRef.showToast(T('Renamed'));
                    return;
                }
            }
            setText(original);
        };
        input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
        input.addEventListener('blur', () => finish(true));
    });
}

/** Inline in the article: which collections hold it. (The source check lives in the source card under the tags.) */
async function mountSourceCheck(article, host) {
    if (!host || !article || !article.id) return;
    try {
        const [{ collectionsStrip }, full] = await Promise.all([import('./collectionsView.js'), StorageManager.getArticleFull(article.id)]);
        if (!host.isConnected) return;
        host.textContent = '';
        host.append(await collectionsStrip(full));
    } catch (_) { /* the article still reads fine without it */ }
}

/** Bulk: one Markdown file with every selected summary (separated by a rule). */
export async function exportManyMarkdown(list) {
    const parts = [];
    for (const a of list) { try { parts.push((await buildMarkdown(a)).mdContent); } catch (_) { /* skip unreadable */ } }
    if (!parts.length) return false;
    downloadBlob(new Blob([parts.join('\n\n---\n\n')], { type: 'text/markdown' }), `AISH-${new Date().toISOString().slice(0, 10)}-${parts.length}.md`);
    return true;
}

/** Bulk delete after one confirmation; keeps the History caches in sync. */
export async function removeMany(ids) {
    if (!ids || !ids.length) return false;
    if (!confirm(T('Delete {n} selected articles? This cannot be undone.', { n: ids.length }))) return false;
    for (const id of ids) await StorageManager.deleteArticle(id);
    const gone = new Set(ids);
    cachedArticles = cachedArticles.filter(i => !gone.has(i.id));
    archivedCache = archivedCache.filter(i => !gone.has(i.id));
    invalidateSearchIndex();
    if (document.getElementById('articleList')) renderTab();
    if (uiManagerRef) uiManagerRef.showToast(T('{n} articles deleted', { n: ids.length }));
    return true;
}

/** Delete an article after confirming (used by the card ⋯ menu); keeps the History caches in sync. */
export async function removeArticle(article) {
    if (!article || !article.id) return false;
    if (!confirm(T('Are you sure you want to delete this article?'))) return false;
    await StorageManager.deleteArticle(article.id);
    cachedArticles = cachedArticles.filter(i => i.id !== article.id);
    archivedCache = archivedCache.filter(i => i.id !== article.id);
    invalidateSearchIndex();
    if (document.getElementById('articleList')) renderTab();
    if (uiManagerRef) uiManagerRef.showToast(T('Article deleted'));
    return true;
}

/**
 * Lets a page that is not the popup (the reader) use shareArticle / sendToKindle / dispatchToLocalSend: they report
 * through `ui.showToast` and send people to Settings through `ui.showScreen`. initArticleManager() does this itself.
 */
export function bindUiManager(ui) { uiManagerRef = ui; }

export function initArticleManager(uiManager) {
    loadLexicon();   // learned tag names (History search, graph and charts group tags across languages with them)
    uiManagerRef = uiManager;
    import('./collectionsView.js').then(m => m.initCollectionsView({ toast: (msg) => uiManager.showToast(msg), openArticle: (a) => showArticleDetail(a) })).catch(() => {});
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
                    cachedArticles = all.filter(a => !a.archived);
                    archivedCache = all.filter(a => a.archived);
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
            const rendered = mod.initArchiveGraph(graphContainer, source, currentDetailArticle?.timestamp, ensureSearchIndex());
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

    const deleteCurrentDetailArticle = () => {
        if (!currentDetailArticle) return;
        if (!confirm(T('Are you sure you want to delete this article?'))) return;

        StorageManager.deleteArticle(currentDetailArticle.id).then(() => {
            const deletedId = currentDetailArticle.id;
            const updated = cachedArticles.filter(item => item.id !== deletedId);
            currentDetailArticle = null;
            cachedArticles = updated;
            archivedCache = archivedCache.filter(item => item.id !== deletedId);
            invalidateSearchIndex();
            renderTab();

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
        });
    };

    // ── Handle Detail Back Button ───────────────────────────────────────
    if (detailBackBtn) {
        detailBackBtn.addEventListener('click', () => {
            destroyReadingTools();
            const openedId = currentDetailArticle && currentDetailArticle.id;
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
            restoreCardFocus(openedId);
        });
    }

    if (detailDeleteBtn) {
        detailDeleteBtn.addEventListener('click', deleteCurrentDetailArticle);
    }
    if (detailTopBar && typeof ResizeObserver !== 'undefined') {   // wider / narrower pane: move the action buttons up or down
        let raf = 0;
        new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (currentDetailArticle && detailTopBar.style.display !== 'none') layoutDetailActions(); }); }).observe(detailTopBar);
    }
    {   // ★ favorite from the article view
        const ds = document.getElementById('detailStarBtn');
        if (ds) { ds.title = T('Favorite'); ds.setAttribute('aria-label', T('Favorite')); }
        if (ds) ds.addEventListener('click', async () => {
            const a = currentDetailArticle; if (!a || !a.id) return;
            const next = await StorageManager.toggleFavorite(a.id);
            if (next === null) return;
            a.favorite = next; paintFavorite(a.id, next);
            if (uiManagerRef) uiManagerRef.showToast(next ? T('Added to favorites') : T('Removed from favorites'));
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
                mod.initArchiveGraph(graphContainer, source, currentDetailArticle?.timestamp, ensureSearchIndex());
            });
        } else {
            StorageManager.getArticlesIndex().then(articles => {
                if (articles.length > 0) {
                    import('./archiveGraph.js').then(mod => {
                        mod.initArchiveGraph(graphContainer, articles, currentDetailArticle?.timestamp, buildIndex(articles));
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
                uiManager.showScreen('history');
                setTimeout(() => showArticleDetail(e.detail), 400);
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

export function loadHistory() {
    const graphContainer = document.getElementById('graphContainer');
    const reportContainer = document.getElementById('reportContainer');
    const articleList = document.getElementById('articleList');
    const articleDetail = document.getElementById('articleDetail');
    const historyTopBar = document.getElementById('historyTopBar');
    const detailTopBar = document.getElementById('detailTopBar');
    if (graphContainer && !wsActive()) graphContainer.style.display = 'none';
    if (reportContainer && !wsActive()) reportContainer.style.display = 'none';
    if (articleDetail) articleDetail.style.display = 'none';
    if (detailTopBar) detailTopBar.style.display = 'none';
    toolbarEditing = false; document.getElementById('toolbarTray')?.remove();
    if (historyTopBar) historyTopBar.classList.remove('scroll-hidden');
    if (detailTopBar) detailTopBar.classList.remove('scroll-hidden');
    if (historyTopBar) historyTopBar.style.display = 'flex';
    if (articleList) articleList.style.display = 'block';
    document.dispatchEvent(new Event('aish:ws-refresh'));
    showSkeleton(articleList);
    import('./feedManager.js')
        .then(m => m.reconcileStubs())
        .catch(() => {})
        .then(() => StorageManager.getArticlesIndex({ includeArchived: true }))
        .then(articles => {
            cachedArticles = articles.filter(a => !a.archived);
            archivedCache = articles.filter(a => a.archived);
            invalidateSearchIndex();
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
        if (historyTab === 'inbox' && cachedArticles.length === 0 && archivedCache.length === 0) p.textContent = T('🗂️ Your archive is as empty as a desert! Start saving some articles to fill it up. 🌵');
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
function buildArticleCard(article) {
    const articleHeader = article.title || (article.content && article.content.split('\n')[0]) || T('No title available');
    const listItem = document.createElement('li');
    listItem.classList.add('article-card');
    listItem.dataset.ts = String(article.timestamp);
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
            if (filterText.length >= 3) ids = new Set(tfidfSearch(ensureSearchIndex(), cachedArticles, filterText).map(a => String(a.timestamp)));
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
        const filtered = cachedArticles.filter(cheapMatch);
        import('./archiveGraph.js').then(mod => {
            mod.initArchiveGraph(graphContainer, filtered.length > 0 ? filtered : cachedArticles, currentDetailArticle?.timestamp, ensureSearchIndex());
        });
        graphContainer.style.opacity = filterText && filtered.length < cachedArticles.length ? '0.9' : '1';
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
        const ranked = tfidfSearch(index, cachedArticles, filterText);
        indexedMatchIds = new Set(ranked.map(a => String(a.timestamp)));
    }

    const cards = document.querySelectorAll('.article-card');
    cards.forEach(card => {
        if (!filterText) { card.style.display = 'block'; return; }
        const headerText = card.querySelector('.article-header h4').textContent.toLowerCase();
        const tagText = Array.from(card.querySelectorAll('.tag-chip'))
            .map(chip => chip.textContent.toLowerCase()).join(' ');
        const art = cachedArticles.find(x => String(x.timestamp) === card.dataset.ts) || archivedCache.find(x => String(x.timestamp) === card.dataset.ts);
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
async function renderLocalInsights(article, container) {
    if (!container) return;
    try {
        const index = ensureSearchIndex();
        const [metrics, related] = await Promise.all([
            computeMetrics(article),
            Promise.resolve(similarTo(index, cachedArticles, article, { limit: 4 }))
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

        container.innerHTML = `${badges.length ? `<div class="insight-chips">${badges.join('')}</div>` : ''}${relatedHtml}`;

        container.querySelectorAll('.related-article-link').forEach(el => {
            el.addEventListener('click', () => {
                const match = cachedArticles.find(a => String(a.timestamp) === el.dataset.ts);
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

/**
 * Shows the full article detail view with back button
 */
/** Pinned follow-ups inline, the rest collapsed; pin changes and the export switch are saved right away. */
async function renderDetailQa(article, mount) {
    if (!mount) return;
    const turns = Array.isArray(article.conversation) ? article.conversation : [];
    const draw = async () => {
        mount.replaceChildren(qaSection(turns, {
            includeAll: await includeAllQuestions(),
            onPin: async () => {
                await StorageManager.saveConversation(article.id, turns);
                draw();
            },
            onIncludeAll: (v) => StorageManager.setLocal({ [SK.exportAllQuestions]: !!v }),
            onSource: (quote, chip) => { chip.classList.toggle('chat-src--open'); chip.textContent = chip.classList.contains('chat-src--open') ? '¶ ' + quote : '¶ ' + (quote.length > 38 ? quote.slice(0, 37) + '…' : quote); }
        }));
    };
    draw();
}

/** 🎓 row in the detail view: badges, authors · journal · year, DOI link and the "Mark as paper / Not a paper" override. */
/** Stores a DOI on the article (and marks it as a paper); also fills the source profile from doi.org once. Callers refresh the view. */
async function assignDoiTo(article, doi) {
    await StorageManager.savePaperInfo(article.id, { state: 'yes', doi });
    await applyStatus([article.id], { paperOverride: 'yes' });
    article.paperOverride = 'yes'; article.doi = doi; article.paper = 'yes';
    article.meta = Object.assign({}, article.meta, { paper: Object.assign({}, article.meta && article.meta.paper, { state: 'yes', doi }) });
    const hit = cachedArticles.find(a => a.id === article.id) || archivedCache.find(a => a.id === article.id);
    if (hit) { hit.doi = doi; hit.paper = 'yes'; }
    try {   // the profile (title, authors, year, publisher) from the DOI, so the card shows it right away
        const CV = await import('./collectionsView.js');
        const full = await StorageManager.getArticleFull(article.id);
        await CV.autoFillFromDoi({ ...article, ...full });
    } catch (_) { /* the DOI is saved either way */ }
}

/** Tag row of the detail view (status badges only exist on list cards, where they come before the type): 🎓 paper chips first (✕ = not a paper), then the tags (✕ removes), then "+ Tag" (also: mark as research paper). */
function renderDetailTags(article, host) {
    if (!host) return;
    host.replaceChildren();
    const mk = (cls, text) => { const c = document.createElement('span'); c.className = cls; c.textContent = text; return c; };
    const xBtn = (label, onClick) => {
        const x = document.createElement('button'); x.type = 'button'; x.className = 'tag-x'; x.append(iconEl('x', 'icon--sm')); x.title = label; x.setAttribute('aria-label', label);
        x.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
        return x;
    };
    const refresh = () => { renderDetailTags(article, host); renderPaperRow(article, host.parentNode && host.parentNode.querySelector('.paper-row')); };
    paperChips(article).forEach(([tone, text], i) => {
        const c = mk('tag-chip paper paper-' + tone, text);
        if (i === 0) c.appendChild(xBtn(T('Not a paper'), async () => { await applyStatus([article.id], { paperOverride: 'no' }); article.paperOverride = 'no'; refresh(); }));
        host.appendChild(c);
    });
    const saveTags = async (next) => {
        const stored = await StorageManager.setTags(article.id, next);
        if (!stored) return;
        article.tags = stored;
        const hit = cachedArticles.find(a => a.id === article.id) || archivedCache.find(a => a.id === article.id);
        if (hit) hit.tags = stored;
        refresh();
    };
    (article.tags || []).forEach((t) => {
        const shown = topicLabel(t, uiLocale());
        const c = mk('tag-chip', shown);
        if (shown !== t) c.title = t;   // the stored (original) spelling
        if (article.id) c.appendChild(xBtn(T('Remove tag'), () => saveTags((article.tags || []).filter(x => x !== t))));
        host.appendChild(c);
    });
    if (!article.id) return;
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'tag-chip tag-add'; add.textContent = T('+ Tag / DOI');
    add.addEventListener('click', (e) => {
        e.stopPropagation();
        const input = document.createElement('input');
        input.type = 'text'; input.className = 'tag-input'; input.maxLength = 200; input.placeholder = T('Add tag or DOI…'); input.setAttribute('aria-label', T('Add tag or DOI…'));
        const assignDoi = async (doi) => { await assignDoiTo(article, doi); refresh(); };
        const commit = () => {
            const v = input.value.trim();
            const doi = v ? normalizeDoi(v) : '';
            if (doi && /^(?:https?:\/\/\S*doi\.org\/|doi:\s*)?10\./i.test(v)) assignDoi(doi);   // a pasted DOI / doi.org link is assigned to the paper, not saved as a tag
            else if (v) saveTags([...(article.tags || []), v]); else refresh();
        };
        input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); commit(); } else if (ev.key === 'Escape') { ev.stopPropagation(); refresh(); } });
        input.addEventListener('blur', () => setTimeout(() => { if (input.isConnected) commit(); }, 120));
        add.replaceWith(input);
        // Suggestions: 🎓 Research paper (unless already one), built-in categories, then the user's most used tags.
        const have = new Set((article.tags || []).map(t => t.toLowerCase()));
        const freq = new Map();
        (cachedArticles || []).forEach(a => (a.tags || []).forEach(t => freq.set(t, (freq.get(t) || 0) + 1)));
        const used = [...freq.entries()].sort((x, y) => y[1] - x[1]).map(e => e[0]);
        const cats = [T('News'), T('Tutorial'), T('Opinion'), T('Reference'), T('Interview')];
        const names = [...new Set([...cats, ...used].filter(t => !have.has(t.toLowerCase())))].slice(0, 10);
        const sugg = [];
        const mkSugg = (label, onPick, isPaper) => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'tag-chip tag-add tag-suggest' + (isPaper ? ' tag-suggest-paper' : ''); b.textContent = label;
            b.addEventListener('mousedown', (ev) => ev.preventDefault());   // keep the input's blur from swallowing the click
            b.addEventListener('click', onPick);
            sugg.push(b); return b;
        };
        if (!paperState(article)) mkSugg(T('🎓 Research paper'), async () => { await applyStatus([article.id], { paperOverride: 'yes' }); article.paperOverride = 'yes'; refresh(); }, true);
        names.forEach(n => mkSugg(n, () => saveTags([...(article.tags || []), n])));
        input.after(...sugg);
        const doiSugg = mkSugg('', () => { const d = normalizeDoi(input.value); if (d) assignDoi(d); }, true);
        doiSugg.hidden = true;
        input.after(doiSugg);
        input.addEventListener('input', () => {
            const dv = /^(?:https?:\/\/\S*doi\.org\/|doi:\s*)?10\./i.test(input.value.trim()) ? normalizeDoi(input.value) : '';
            doiSugg.hidden = !dv; if (dv) doiSugg.textContent = T('🎓 Assign DOI {doi}', { doi: dv });
            const q = input.value.trim().toLowerCase();
            sugg.forEach(b => { if (b === doiSugg) return; b.hidden = !!q && !b.textContent.toLowerCase().includes(q) && !b.classList.contains('tag-suggest-paper'); });
        });
        input.focus();
    });
    host.appendChild(add);
}

function renderCiteBlock(article, host) {
    host.replaceChildren();
    const doi = paperDoi(article);
    const csl = article.meta && article.meta.paper && article.meta.paper.csl;
    const head = () => host.appendChild(Object.assign(document.createElement('div'), { className: 'cite-head', textContent: T('❝ Cite') }));
    if (!doi || !doiUrl(doi)) { head(); host.appendChild(Object.assign(document.createElement('div'), { className: 'cite-note', textContent: T('Citation unavailable — no DOI found') })); return; }
    if (!csl) {
        head();
        host.appendChild(Object.assign(document.createElement('div'), { className: 'cite-note', textContent: T('Looks the citation up at doi.org. Only the DOI is sent.') }));
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'button-secondary'; b.textContent = T('Get citation');
        b.addEventListener('click', async (e) => {
            e.stopPropagation(); b.disabled = true; b.textContent = T('Looking up…');
            try {
                const got = await ensureCsl(article, doi);
                article.meta = { ...(article.meta || {}), paper: { ...((article.meta || {}).paper || {}), csl: got } };
                renderCiteBlock(article, host);
            } catch (_) { b.disabled = false; b.textContent = T('Citation lookup failed — try again'); }
        });
        host.appendChild(b);
        return;
    }
    const text = formatCitation(csl, getCiteStyle());
    // Header row (like the Figma "Cite" panel): style dropdown left, Copy + DOI right; the citation text sits below.
    const bar = document.createElement('div'); bar.className = 'cite-actions';
    const sel = document.createElement('select'); sel.className = 'cite-style'; sel.setAttribute('aria-label', T('❝ Cite'));
    CITE_STYLES.forEach(([id, label]) => { const o = document.createElement('option'); o.value = id; o.textContent = label; if (id === getCiteStyle()) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('click', (e) => e.stopPropagation());
    sel.addEventListener('change', (e) => { e.stopPropagation(); setCiteStyle(sel.value); renderCiteBlock(article, host); });
    const sp = document.createElement('span'); sp.className = 'cite-spacer';
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'cite-btn cite-copy'; copy.textContent = '⧉ ' + T('Copy');
    copy.addEventListener('click', async (e) => { e.stopPropagation(); if (await copyText(text) && uiManagerRef) uiManagerRef.showToast(T('Copied to clipboard! 📋')); });
    const open = document.createElement('a'); open.className = 'cite-btn cite-open'; open.href = doiUrl(doi); open.target = '_blank'; open.rel = 'noopener noreferrer'; open.textContent = T('DOI ↗'); open.title = T('Open DOI ↗');
    bar.append(sel, sp, copy, open);
    const box = document.createElement('pre'); box.className = 'cite-text'; box.textContent = text;
    host.append(bar, box, Object.assign(document.createElement('div'), { className: 'cite-src', textContent: T('Source: doi.org') }));
}

// ── Source card (Paper details + Source check in one) ─────────────────────
// One card under the tags: a summary that is always visible (type, hints, authors · year · publisher, DOI — or a field to add one)
// and up to three sections, collapsed by default (Key facts opens when a DOI is set): Key facts and Cite (papers), Source check (every saved article).
// Wide pane: facts + cite on the left, the check on the right (CSS container query).
let sourceOpen = {};
const yearOf = (d) => String(d || '').slice(0, 4);

async function paintSourceSummary(article, box, row) {
    try {
        const [C, CV, full] = await Promise.all([import('./collections.js'), import('./collectionsView.js'), StorageManager.getArticleFull(article.id)]);
        if (!box.isConnected) return;
        const rec = { ...article, ...full };
        const profile = C.effectiveProfile(rec);
        const hints = C.profileHints(profile);
        box.replaceChildren();
        const l1 = document.createElement('div'); l1.className = 'source-line1';
        const ty = document.createElement('strong'); ty.className = 'source-type';
        ty.textContent = (paperState(article) ? '🎓 ' : '🔎 ') + (CV.typeLabel(profile.type) || T('Source'));
        l1.append(ty);
        if (hints.includes('preprint')) { const h = document.createElement('span'); h.className = 'source-hint'; h.textContent = CV.hintLabel('preprint'); l1.append(h); }
        const sp = document.createElement('span'); sp.className = 'source-sp'; l1.append(sp);
        const doi = paperDoi(rec);
        if (doi && doiUrl(doi)) {
            const a = document.createElement('a'); a.className = 'cite-btn source-doi'; a.href = doiUrl(doi); a.target = '_blank'; a.rel = 'noopener noreferrer';
            a.textContent = (rec.sourceProfile && rec.sourceProfile.fromDoi ? T('DOI ✓ ↗') : T('DOI ↗')); a.title = doi;
            l1.append(a);
        } else {
            const add = document.createElement('button'); add.type = 'button'; add.className = 'cite-btn source-doi-add'; add.textContent = T('+ DOI');
            add.addEventListener('click', (e) => {
                e.stopPropagation();
                const input = document.createElement('input'); input.type = 'text'; input.className = 'tag-input source-doi-input'; input.maxLength = 200;
                input.placeholder = T('10.xxxx/… or doi.org link'); input.setAttribute('aria-label', T('Add DOI'));
                let done = false;
                const commit = async () => {
                    if (done) return; done = true;
                    const v = input.value.trim(); const d = v ? normalizeDoi(v) : '';
                    if (d && doiUrl(d)) {
                        input.disabled = true;
                        await assignDoiTo(article, d);
                        const tags = row.parentNode && row.parentNode.querySelector('.detail-tags');
                        if (tags) renderDetailTags(article, tags); else renderPaperRow(article, row);
                    } else { if (v && uiManagerRef) uiManagerRef.showToast(T('Enter a valid DOI first.')); paintSourceSummary(article, box, row); }
                };
                input.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); commit(); } else if (ev.key === 'Escape') { done = true; paintSourceSummary(article, box, row); } });
                input.addEventListener('blur', () => setTimeout(() => { if (input.isConnected) commit(); }, 120));
                add.replaceWith(input); input.focus();
            });
            l1.append(add);
        }
        const line = [profile.author, yearOf(profile.date), profile.publisher].filter(Boolean).join(' · ');
        const l2 = document.createElement('div'); l2.className = 'source-line2' + (line ? '' : ' is-empty'); l2.textContent = line || T('No source details yet');
        box.append(l1, l2);
        // check progress in the (closed) section header
        const pr = C.checkProgress(rec.sourceCheck);
        paintCheckProgress(row, pr);
        // a DOI is known but the profile was never filled from it: do it once, then show the result
        if (doi) CV.autoFillFromDoi(rec).then((p) => { if (p && box.isConnected) paintSourceSummary(article, box, row); });
    } catch (_) { /* the card still works without its summary */ }
}

function paintCheckProgress(row, pr) {
    const t = row && row.querySelector('.source-progress'); if (!t) return;
    t.textContent = T('{a} of {n} answered', { a: pr.answered, n: pr.total });
    t.classList.toggle('is-done', !!pr.done);
    const dots = row.querySelector('.source-dots');
    if (dots) { dots.replaceChildren(); for (let i = 0; i < pr.total; i++) { const d = document.createElement('i'); if (i < pr.answered) d.className = 'on'; dots.append(d); } }
}

function renderPaperRow(article, row) {
    if (!row) return;
    row.replaceChildren();
    if (!article || !article.id || article.feedStub) { row.hidden = true; return; }
    row.hidden = false;
    row.className = 'paper-row source-card-row';
    const isPaper = !!paperState(article);
    const card = document.createElement('div'); card.className = 'source-card' + (isPaper ? '' : ' no-paper');
    const summary = document.createElement('div'); summary.className = 'source-summary';
    card.append(summary);
    const section = (key, title, extra) => {
        const d = document.createElement('details'); d.className = 'source-sec source-sec-' + key;
        d.open = key in sourceOpen ? !!sourceOpen[key] : (key === 'facts' && !!paperDoi(article));   // with a DOI the key facts are open by default; a manual choice wins
        d.addEventListener('toggle', () => { sourceOpen[key] = d.open; });
        const sm = document.createElement('summary'); const t = document.createElement('span'); t.className = 'source-sec-t'; t.textContent = title; sm.append(t);
        if (extra) sm.append(extra);
        d.append(sm); card.append(d); return d;
    };
    if (isPaper) {
        // key facts
        const facts = paperFacts(article);
        const fs = section('facts', T('Key facts'));
        const body = document.createElement('div'); body.className = 'source-sec-body'; fs.append(body);
        if (facts.length) {
            const box = document.createElement('dl'); box.className = 'paper-facts';
            facts.forEach(([k, v]) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; box.append(dt, dd); });
            body.append(box);
        } else {
            const f = document.createElement('button');
            f.type = 'button'; f.className = 'button-secondary paper-facts-btn'; f.textContent = T('🔎 Key facts');
            f.addEventListener('click', async (e) => {
                e.stopPropagation();
                f.disabled = true; f.textContent = T('Thinking…');
                try {
                    const merged = await extractPaperFacts(article, aiComplete, new Intl.DisplayNames(['en'], { type: 'language' }).of(locale()) || 'English');
                    article.meta = { ...(article.meta || {}), paper: { ...((article.meta || {}).paper || {}), ...merged } };
                    article.paperType = merged.type;
                    sourceOpen.facts = true;
                    renderPaperRow(article, row);
                } catch (err) { f.disabled = false; f.textContent = '❌ ' + ((err && err.message) || T('AI request failed')); }
            });
            body.append(f);
        }
        // cite
        const cs = section('cite', T('Cite'));
        const cite = document.createElement('div'); cite.className = 'cite-block source-sec-body'; cs.append(cite); renderCiteBlock(article, cite);
    }
    // source check: built when first opened (it reads the saved profile and answers)
    const progress = document.createElement('span'); progress.className = 'source-progress';
    const dots = document.createElement('span'); dots.className = 'source-dots'; dots.setAttribute('aria-hidden', 'true');
    const extra = document.createElement('span'); extra.className = 'source-sec-x'; extra.append(progress, dots);
    const ck = section('check', T('Source check'), extra);
    const checkBody = document.createElement('div'); checkBody.className = 'source-sec-body'; ck.append(checkBody);
    const buildCheck = async () => {
        if (checkBody.firstChild) return;
        try {
            const [CV, full] = await Promise.all([import('./collectionsView.js'), StorageManager.getArticleFull(article.id)]);
            const panel = CV.sourceCheckPanel({ ...article, ...full }, {
                origin: 'inline', bare: true,
                onChange: () => { paintCheckProgress(row, panel.getProgress()); paintSourceSummary(article, summary, row); },
            });
            checkBody.append(panel);
        } catch (_) { /* the rest of the card still works */ }
    };
    ck.addEventListener('toggle', () => { if (ck.open) buildCheck(); });
    if (ck.open) buildCheck();
    row.appendChild(card);
    paintSourceSummary(article, summary, row);
}

export async function showArticleDetail(article) {
    await loadCiteStyle();
    // List/graph/search cards only carry the lean articlesIndex shape (no
    // content) — load the full article:<id> record before rendering detail.
    // Callers that already pass a full in-memory article (e.g. mainScreen.js
    // right after a save) have `content` set and skip this fetch.
    if (article && article.id && article.content === undefined) {
        try {
            const full = await StorageManager.getArticleFull(article.id);
            article = { ...article, ...full };
        } catch (err) {
            console.error('[AISH] Failed to load article content:', err);
        }
    }

    if (article && article.id && article.conversation === undefined) {
        try {
            const conversation = await StorageManager.getConversation(article.id);
            article = { ...article, conversation };
            // follow-ups saved before they were appended to the summary: do it now (once)
            if (conversation.length && article.summaryBase === undefined && await StorageManager.saveConversation(article.id, conversation)) {
                article.summaryBase = article.summary;
            }
        } catch (_) { article = { ...article, conversation: [] }; }
    }
    currentDetailArticle = article;
    sourceOpen = {};   // the source card starts collapsed on every article
    {   const ds = document.getElementById('detailStarBtn'); if (ds) { ds.hidden = !article.id || !!article.feedStub; paintDetailStar(!!article.favorite); } }
    recordArticleOpened(article);
    if (article && article.id && !article.readAt && !article.feedStub) { article.readAt = new Date().toISOString(); applyStatus([article.id], { read: true }).catch(() => {}); }
    const articleList = document.getElementById('articleList');
    const articleDetail = document.getElementById('articleDetail');
    const articleDetailContent = document.getElementById('articleDetailContent');
    const graphContainer = document.getElementById('graphContainer');
    const historyTopBar = document.getElementById('historyTopBar');
    const detailTopBar = document.getElementById('detailTopBar');

    if (!articleDetail || !articleDetailContent) return;

    // Choose the highest fidelity data field available instantly
    const rawContentSource = article.content || article.html || article.text || '';

    const safeTitle = escapeHtml(article.title || (rawContentSource && rawContentSource.split('\n')[0]) || T('Article'));
    // Saved summary and page HTML come from arbitrary pages (and restored backups): parse inert, then clean.
    const fallbackSummary = article.savedOnly
        ? '<p><em>' + escapeHtml(T('Saved without an AI summary. Open the page and tap ✨ Summarize to add one.')) + '</em></p>'
        : escapeHtml(T('No summary available'));
    const summaryDoc = new DOMParser().parseFromString(article.summaryBase !== undefined ? article.summaryBase : (article.summary || fallbackSummary), 'text/html');
    summaryDoc.querySelectorAll('img').forEach(el => el.remove());
    const safeSummary = cleanUntrustedHtml(summaryDoc.body).innerHTML;

    const detailDoc = new DOMParser().parseFromString(rawContentSource, 'text/html');
    cleanUntrustedHtml(detailDoc.body);
    // Keep the images; .detail-original img caps their width so they don't break the popup layout
    const safeContent = detailDoc.body.innerHTML || escapeHtml(T('No content available.'));
    const domain = article.url ? (() => { try { return new URL(article.url).hostname; } catch { return ''; } })() : '';
    const modelInfo = article.modelId ? `<span class="detail-model">${modelIcon(article)} ${escapeHtml(article.modelId)}</span>` : '';
    const lengthInfo = article.summaryLength ? `<span class="detail-length">📏 ${escapeHtml(article.summaryLength)}w</span>` : '';
    
    // Decision metadata
    const decisionBadge = article.isDecision ? `
      <div class="detail-decision">
        <div class="detail-decision-head">
          <span aria-hidden="true">🔖</span>
          <span class="detail-decision-title">${T('Saved for Later')}</span>
          ${article.decisionTimeframe ? `<span class="decision-chip">${escapeHtml(article.decisionTimeframe)}</span>` : ''}
        </div>
        ${article.decisionReason ? `<p class="detail-decision-reason">${escapeHtml(article.decisionReason)}</p>` : ''}
      </div>
    ` : '';

    articleDetailContent.innerHTML = `
      <div class="article-detail-card">
        <h3 class="detail-title"><img class="detail-fav" alt="" hidden>${safeTitle}</h3>
        <p class="detail-desc" hidden></p>
        <p class="detail-meta">
          ${article.url ? `<a href="${escAttr(article.url)}" target="_blank" rel="noopener">${escapeHtml(domain)} ↗</a> · ` : ''}
          ${new Date(article.timestamp).toLocaleDateString()}${(modelInfo || lengthInfo) ? ' · ' : ''}${modelInfo}${lengthInfo}
        </p>
        <div class="detail-tags"></div>
        ${decisionBadge}
        <div class="paper-row" hidden></div>
        <div class="action-bar detail-actions">
          <button class="button-secondary open-button">${icon('book-open')} <span class="act-label">${lbl('Read 👓')}</span></button>
          <button class="button-secondary copy-button">${icon('copy')} <span class="act-label">${lbl('Copy 📋')}</span></button>
          <button class="button-secondary share-button">${icon('link')} <span class="act-label">${lbl('Share 🔗')}</span></button>
          <button class="button-secondary kindle-button">${icon('book-open')} <span class="act-label">${lbl('Kindle 📚')}</span></button>
          <button class="button-secondary localsend-button">${icon('smartphone')} <span class="act-label">${lbl('LocalSend 📱')}</span></button>
        </div>
        <div class="summary-box">
          <strong class="summary-box-title">${T('🧙 AI Summary')}</strong>
          <div>${safeSummary}</div>
          <div id="qaMount" class="detail-qa"></div>
        </div>
        <div id="sourceCheckMount" class="detail-source"></div>
        <div id="localInsights" class="detail-insights"></div>
        <details class="detail-original">
          <summary>${T('📄 Original Content')}</summary>
          <div class="detail-original-body">${safeContent}</div>
        </details>
      </div>
    `;

    // On-device insights (reading level, sentiment, similar articles) load
    // asynchronously and progressively fill in — they never block the rest
    // of the detail view from rendering.
    renderLocalInsights(article, articleDetailContent.querySelector('#localInsights'));
    renderDetailTags(article, articleDetailContent.querySelector('.detail-tags'));
    mountTitleEdit(article, articleDetailContent.querySelector('.detail-title'));
    renderPaperRow(article, articleDetailContent.querySelector('.paper-row'));
    renderDetailQa(article, articleDetailContent.querySelector('#qaMount'));
    mountSourceCheck(article, articleDetailContent.querySelector('#sourceCheckMount'));
    {   // saved page metadata: favicon + description (set as text, never as HTML)
        const m = article.meta || {};
        const fav = m.favicon || article.favicon;
        const img = articleDetailContent.querySelector('.detail-fav');
        if (img && fav && /^https?:|^data:/.test(fav)) { img.src = fav; img.hidden = false; img.addEventListener('error', () => { img.hidden = true; }); }
        const desc = articleDetailContent.querySelector('.detail-desc');
        const text = m.description || article.description || '';
        if (desc && text) { desc.textContent = text; desc.hidden = false; }
    }

    // Wire up buttons
    const shareBtn = articleDetailContent.querySelector('.share-button');
    const copyBtn = articleDetailContent.querySelector('.copy-button');
    const kindleBtn = articleDetailContent.querySelector('.kindle-button');
    const localSendBtn = articleDetailContent.querySelector('.localsend-button');
    const openBtn = articleDetailContent.querySelector('.open-button');

    StorageManager.getAll().then((cfg) => {
        const pref = cfg.deliveryPreference === 'localsend' ? 'localsend' : 'kindle';
        if (kindleBtn) kindleBtn.style.display = pref === 'kindle' ? 'inline-flex' : 'none';
        if (localSendBtn) localSendBtn.style.display = pref === 'localsend' ? 'inline-flex' : 'none';
    }).catch(() => {
        // Fallback: show Kindle if settings retrieval fails.
        if (kindleBtn) kindleBtn.style.display = 'inline-flex';
        if (localSendBtn) localSendBtn.style.display = 'none';
    });

    if (shareBtn) shareBtn.addEventListener('click', (e) => { e.stopPropagation(); shareArticle(article); });
    if (copyBtn) copyBtn.addEventListener('click', (e) => { e.stopPropagation(); copyArticleToClipboard(article); });
    if (kindleBtn) kindleBtn.addEventListener('click', (e) => { e.stopPropagation(); sendToKindle(article); });
    if (localSendBtn) localSendBtn.addEventListener('click', (e) => { e.stopPropagation(); dispatchToLocalSend(article); });
    if (openBtn) {
        openBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openReadMode(article);
        });
    }
    {   // ⋯ — everything the list's menu offers (Markdown, ODT/Word/PDF, Obsidian, archive, delete, …)
        const bar = articleDetailContent.querySelector('.detail-actions');
        if (bar) attachCardMenu(bar, article, { detail: true, extra: detailExtraItems, onRemoved: () => { const b = document.getElementById('detailBackButton'); if (b) b.click(); } });
    }
    // Show detail, hide list and graph
    await loadToolbarPrefs();
    // fresh content: drop the previous article's buttons from the top bar (they were moved out of the old content),
    // otherwise every opened article would add another set of Read/Copy/Share/Kindle buttons
    toolbarEditing = false; document.getElementById('toolbarTray')?.remove();
    parkExistingTools();
    document.getElementById('detailTopActions')?.remove();
    detailTopBar?.querySelectorAll('.card-menu-btn').forEach(b => b.remove());
    topActions = false;   // buttons are in the row again until the layout runs below
    if (articleList) articleList.style.display = 'none';
    if (graphContainer && !wsActive()) graphContainer.style.display = 'none';
    if (historyTopBar) historyTopBar.style.display = 'none';
    if (detailTopBar) detailTopBar.style.display = 'flex';
    articleDetail.style.display = 'block';
    layoutDetailActions();
    mountReadingTools({ scroller: document.getElementById('historyScreen'), content: articleDetailContent, article });   // Scroll to top + contents on long texts
    // Keyboard: focus moves to "Back" (so Esc / Enter returns); the card that opened this stays remembered.
    const back = document.getElementById('detailBackButton');
    if (back) back.focus({ preventScroll: true });
}


// ── Detail actions: one joined toolbar in the top bar when there is room ──
// Wide enough: a single segmented bar next to Back — Read / Copy / Share first, more of the user's configured actions as the
// pane gets wider, ⋯ as its last segment (it always carries everything). Narrow (the popup): the buttons stay in the row below
// the title, as before.
const TOP_LABELS_MIN = 780;
let topActions = false;
let toolbarPrefs = { items: DEFAULT_TOOLBAR.slice(), delivery: 'kindle', sendTarget: 'kindle' };
const loadToolbarPrefs = () => StorageManager.getAll().then((cfg) => {
    const delivery = cfg.deliveryPreference === 'localsend' ? 'localsend' : 'kindle';
    toolbarPrefs = { items: normalizeToolbar(cfg[TOOLBAR_PREF]), delivery, sendTarget: SEND_TARGETS[cfg.lastSendTarget] ? cfg.lastSendTarget : delivery };
}).catch(() => {});
const toolbarShown = new Set();   // ids currently in the bar (the rest is reachable through ⋯)
const detailExtraItems = () => !topActions ? [] : [
    ...(toolbarShown.has('favorite') || !document.getElementById('detailStarBtn') || document.getElementById('detailStarBtn').hidden ? [] : [{ icon: 'star', label: currentDetailArticle && currentDetailArticle.favorite ? T('Remove from favorites') : T('Favorite'), run: () => document.getElementById('detailStarBtn').click() }]),
    { icon: 'settings', label: T('Customize toolbar…'), run: () => enterToolbarEdit(), sep: true },
    { icon: 'network', label: T('View graph'), run: () => document.getElementById('detailGraphToggleBtn')?.click() },
    { icon: 'chart-column', label: T('View analytics report'), run: () => document.getElementById('detailReportToggleBtn')?.click() },
];
const toolbarRun = (id, a) => ({
    read: () => openReadMode(a), copy: () => copyArticleToClipboard(a),
    markdown: () => exportToMarkdown(a), obsidian: () => sendToObsidian(a),
    pdf: () => exportToPdf(a), collection: () => addToCollection(a),
}[id]);
// Send split button: where "Send" goes. The label shows the last used target; the ▾ lists them all.
const SEND_TARGETS = {
    kindle: { icon: 'book-open', short: () => T('Kindle'), label: () => T('Send to Kindle'), run: (a) => sendToKindle(a) },
    localsend: { icon: 'send', short: () => T('LocalSend'), label: () => T('Send via LocalSend'), run: (a) => dispatchToLocalSend(a) },
    phone: { icon: 'smartphone', short: () => T('Phone'), label: () => T('Send to phone'), run: (a) => sendToPhone(a) },
    share: { icon: 'link', short: () => T('Share'), label: () => T('Share…'), run: (a) => shareArticle(a) },
};
const sendTargetOk = (id, a) => id !== 'phone' || !!(a && a.id && a.url && !a.feedStub);
async function runSendTarget(id, a) {
    const def = SEND_TARGETS[id]; if (!def) return;
    toolbarPrefs.sendTarget = id;
    try { chrome.storage.sync.set({ lastSendTarget: id }); } catch (_) { /* remembered for this session only */ }
    layoutDetailActions();
    await def.run(a);
}
const SEND_DEVICE_MAX = 3;   // devices shown per send type; the rest sits behind "+N more"
async function openSendMenu(btn, expanded = '') {
    const a = currentDetailArticle; if (!a) return;
    const { openItems } = await import('./cardMenu.js');
    let phone = null, cfg = {};
    try { phone = (await createInboxManager().status()).paired; } catch (_) { /* unknown → plain row */ }
    try { cfg = await StorageManager.getAll(); } catch (_) { /* no devices known → plain rows */ }
    const items = [];
    for (const id of ['kindle', 'localsend', 'phone'].filter(t => sendTargetOk(t, a))) {
        const def = SEND_TARGETS[id];
        const devices = id === 'phone' ? [] : (Array.isArray(cfg[SK.devices]) ? cfg[SK.devices].filter(d => d.type === id) : []);
        const last = id === toolbarPrefs.sendTarget;
        if (!devices.length) {
            items.push({
                icon: def.icon, label: def.label(), active: last,
                sub: last ? T('Last used') : (id === 'phone' && phone === false ? T('Not paired · pair now') : ''),
                tag: id === toolbarPrefs.delivery ? T('Default') : (id === 'phone' && phone ? T('Paired') : ''),
                run: () => runSendTarget(id, a),
            });
            continue;
        }
        const activeId = (StorageManager.getActiveDevice(cfg, id) || {}).id;
        const shown = expanded === id ? devices : devices.slice(0, SEND_DEVICE_MAX);
        for (const d of shown) {
            const isActive = d.id === activeId;
            items.push({
                icon: def.icon, label: `${def.short()} · ${d.label || d.id}`, active: last && isActive,
                sub: last && isActive ? T('Last used') : '',
                tag: id === toolbarPrefs.delivery && isActive ? T('Default') : '',
                run: async () => { try { await StorageManager.setActiveDevice(id, d.id); } catch (_) { /* send to the current device */ } return runSendTarget(id, a); },
            });
        }
        if (devices.length > shown.length) {
            items.push({ icon: 'ellipsis', label: T('{n} more…', { n: devices.length - shown.length }), sub: def.short(), run: () => setTimeout(() => openSendMenu(btn, id), 0) });
        }
    }
    items.push({ icon: 'link', label: T('Share…'), sub: T('System share: apps, AirDrop, mail'), sep: true, run: () => runSendTarget('share', a) });
    items.push({ icon: 'copy', label: T('Copy link'), run: async () => { try { await navigator.clipboard.writeText(a.url || ''); if (uiManagerRef) uiManagerRef.showToast(T('Link copied')); } catch (_) { /* ignore */ } } });
    items.push({ icon: 'settings', label: T('Manage targets…'), sep: true, run: () => { if (uiManagerRef) uiManagerRef.showScreen('settings'); import('./settingsNav.js').then(m => m.openSettingsPanel('send')).catch(() => {}); } });
    openItems(btn, items);
}
const toolbarAvailable = () => true;
/** How many configured actions fit: at least three, then one more per free slot. */
function toolbarSlots(width, labels, total) {
    const per = labels ? 132 : 50;
    const room = width - 120 /* back */ - 56 /* ⋯ */ - 48 /* gaps */;
    return Math.min(total, Math.max(Math.min(3, total), Math.floor(room / per)));
}
/** Favorite / Read aloud are top-bar buttons with their own state; they move into the toolbar and back. */
function parkExistingTools() {
    const topBar = document.getElementById('detailTopBar'); const more = document.getElementById('detailMoreBtn');
    Object.values(TOOLBAR_CATALOG).forEach((def) => {
        const el = def.existing && document.querySelector(def.existing);
        if (el && topBar) { if (el.parentElement !== topBar) topBar.insertBefore(el, more || null); el.classList.remove('detail-tool'); el.classList.add('tool-parked'); }
    });
}
function paintDetailToolbar(holder, cb, width, labels) {
    const a = currentDetailArticle;
    parkExistingTools();
    holder.replaceChildren(); toolbarShown.clear();
    holder.classList.toggle('with-labels', labels);
    const ids = toolbarPrefs.items.filter(id => TOOLBAR_CATALOG[id] && toolbarAvailable(id, a));
    holder.classList.toggle('is-editing', toolbarEditing);
    ids.slice(0, toolbarEditing ? ids.length : toolbarSlots(width, labels, ids.length)).forEach((id) => {
        const def = TOOLBAR_CATALOG[id];
        const name = def.label();
        if (def.existing) {
            const el = document.querySelector(def.existing); if (!el) return;
            el.classList.add('detail-tool'); el.classList.remove('tool-parked'); toolbarShown.add(id);
            if (!el.querySelector('.act-label')) { const t = document.createElement('span'); t.className = 'act-label'; t.textContent = def.short(); el.append(t); }
            if (toolbarEditing) markEditable(el, id);
            holder.append(el); return;
        }
        if (def.split) {
            const tgt = SEND_TARGETS[sendTargetOk(toolbarPrefs.sendTarget, a) ? toolbarPrefs.sendTarget : 'kindle'];
            const wrap = document.createElement('div'); wrap.className = 'detail-split detail-tool tool-send';
            const main = document.createElement('button'); main.type = 'button'; main.className = 'detail-split-main';
            main.title = tgt.label(); main.setAttribute('aria-label', tgt.label());
            main.append(iconEl(tgt.icon)); const mt = document.createElement('span'); mt.className = 'act-label'; mt.textContent = tgt.short(); main.append(mt);
            main.addEventListener('click', (e) => { e.stopPropagation(); if (!toolbarEditing) runSendTarget(sendTargetOk(toolbarPrefs.sendTarget, a) ? toolbarPrefs.sendTarget : 'kindle', a); });
            const more = document.createElement('button'); more.type = 'button'; more.className = 'detail-split-more'; more.append(iconEl('chevron-down'));
            more.title = T('Send to…'); more.setAttribute('aria-label', T('Send to…')); more.setAttribute('aria-haspopup', 'menu');
            more.setAttribute('aria-expanded', 'false');
            more.addEventListener('click', async (e) => { e.stopPropagation(); if (toolbarEditing) return; if (more.getAttribute('aria-expanded') === 'true') { (await import('./cardMenu.js')).closeMenu(); return; } openSendMenu(more); });
            wrap.append(main, more);
            if (toolbarEditing) markEditable(wrap, id);
            holder.append(wrap); return;
        }
        const b = document.createElement('button'); b.type = 'button'; b.className = 'detail-tool tool-' + id;
        b.title = name; b.setAttribute('aria-label', name);
        b.append(iconEl(def.icon));
        const t = document.createElement('span'); t.className = 'act-label'; t.textContent = def.short(); b.append(t);
        b.addEventListener('click', (e) => { e.stopPropagation(); Promise.resolve().then(() => toolbarRun(id, a)()).catch(() => {}); });
        if (toolbarEditing) markEditable(b, id);
        holder.append(b);
    });
    if (cb) holder.append(cb);
}
// ── Customize: the bar itself is the editor (drag handles) with a tray of the actions that only live in ⋯ ──
let toolbarEditing = false;
const saveToolbar = (items) => {
    toolbarPrefs.items = normalizeToolbar(items);
    try { chrome.storage.sync.set({ [TOOLBAR_PREF]: toolbarPrefs.items }); } catch (_) { /* the bar still follows this session */ }
    layoutDetailActions(); paintToolbarTray();
};
function moveToolbarItem(id, index) {   // index = position among the bar's configured actions; -1 → back to the tray (⋯ menu)
    const items = toolbarPrefs.items.filter(x => x !== id);
    if (index < 0) { if (!items.length) return; } else items.splice(Math.min(index, items.length), 0, id);
    saveToolbar(items);
}
function markEditable(el, id) {
    el.draggable = true; el.dataset.toolId = id; el.classList.add('is-editable');
    if (!el.querySelector('.tool-grip')) { const g = document.createElement('span'); g.className = 'tool-grip'; g.setAttribute('aria-hidden', 'true'); g.textContent = '⋮⋮'; el.prepend(g); }
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('is-dragging'); });
    el.addEventListener('dragend', () => el.classList.remove('is-dragging'));
    el.addEventListener('keydown', (e) => {   // keyboard: Alt+←/→ move, Delete sends it back to ⋯
        const i = toolbarPrefs.items.indexOf(id);
        if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); e.stopPropagation(); moveToolbarItem(id, Math.max(0, i + (e.key === 'ArrowRight' ? 1 : -1))); document.querySelector('#detailTopActions [data-tool-id="' + id + '"]')?.focus(); }
        else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); moveToolbarItem(id, -1); }
    });
}
function dropIndex(holder, x) {   // where in the bar a dragged item would land
    const tools = [...holder.querySelectorAll('.is-editable')];
    let i = 0; for (const t of tools) { const r = t.getBoundingClientRect(); if (x > r.left + r.width / 2) i++; else break; }
    return i;
}
function wireBarDrop(holder) {
    if (holder.dataset.dnd) return; holder.dataset.dnd = '1';
    holder.addEventListener('click', (e) => { if (toolbarEditing && e.target.closest('.is-editable')) { e.preventDefault(); e.stopPropagation(); } }, true);
    holder.addEventListener('dragover', (e) => { if (!toolbarEditing) return; e.preventDefault(); holder.classList.add('is-drop'); holder.style.setProperty('--drop-x', '1'); });
    holder.addEventListener('dragleave', (e) => { if (!holder.contains(e.relatedTarget)) holder.classList.remove('is-drop'); });
    holder.addEventListener('drop', (e) => { if (!toolbarEditing) return; e.preventDefault(); holder.classList.remove('is-drop'); const id = e.dataTransfer.getData('text/plain'); if (TOOLBAR_CATALOG[id]) moveToolbarItem(id, dropIndex(holder, e.clientX)); });
}
function paintToolbarTray() {
    const topBar = document.getElementById('detailTopBar');
    let tray = document.getElementById('toolbarTray');
    if (!toolbarEditing || !topBar) { if (tray) tray.remove(); return; }
    if (!tray) { tray = document.createElement('div'); tray.id = 'toolbarTray'; tray.className = 'toolbar-tray'; tray.setAttribute('role', 'group'); topBar.after(tray);
        tray.addEventListener('dragover', (e) => { e.preventDefault(); tray.classList.add('is-drop'); });
        tray.addEventListener('dragleave', (e) => { if (!tray.contains(e.relatedTarget)) tray.classList.remove('is-drop'); });
        tray.addEventListener('drop', (e) => { e.preventDefault(); tray.classList.remove('is-drop'); const id = e.dataTransfer.getData('text/plain'); if (TOOLBAR_CATALOG[id]) moveToolbarItem(id, -1); }); }
    tray.setAttribute('aria-label', T('Customize toolbar…'));
    tray.replaceChildren();
    const h = document.createElement('div'); h.className = 'toolbar-tray-t'; h.textContent = T('Other actions: drag into the bar'); tray.append(h);
    const chips = document.createElement('div'); chips.className = 'toolbar-tray-chips'; tray.append(chips);
    Object.keys(TOOLBAR_CATALOG).filter(id => !toolbarPrefs.items.includes(id) && toolbarAvailable(id, currentDetailArticle)).forEach((id) => {
        const def = TOOLBAR_CATALOG[id];
        const c = document.createElement('button'); c.type = 'button'; c.className = 'toolbar-chip'; c.draggable = true; c.dataset.toolId = id; c.title = def.label();
        const g = document.createElement('span'); g.className = 'tool-grip'; g.textContent = '⋮⋮'; g.setAttribute('aria-hidden', 'true');
        const t = document.createElement('span'); t.textContent = def.short();
        c.append(g, iconEl(def.icon), t);
        c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; c.classList.add('is-dragging'); });
        c.addEventListener('dragend', () => c.classList.remove('is-dragging'));
        c.addEventListener('click', () => moveToolbarItem(id, toolbarPrefs.items.length));   // click / Enter adds at the end (touch, keyboard)
        chips.append(c);
    });
    if (!chips.children.length) { const e = document.createElement('span'); e.className = 'toolbar-tray-empty'; e.textContent = T('Everything is in the bar.'); chips.append(e); }
    const row = document.createElement('div'); row.className = 'toolbar-tray-row'; tray.append(row);
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'button-secondary btn-sm'; reset.textContent = T('Reset toolbar');
    reset.addEventListener('click', () => saveToolbar(DEFAULT_TOOLBAR.slice()));
    const sp = document.createElement('span'); sp.className = 'source-sp';
    const done = document.createElement('button'); done.type = 'button'; done.className = 'button-primary btn-sm'; done.textContent = T('Done');
    done.addEventListener('click', exitToolbarEdit);
    row.append(reset, sp, done);
}
function enterToolbarEdit() { toolbarEditing = true; layoutDetailActions(); paintToolbarTray(); document.querySelector('#detailTopActions .is-editable')?.focus(); }
function exitToolbarEdit() { toolbarEditing = false; layoutDetailActions(); paintToolbarTray(); }

/** "Back to History" becomes "Back" (the full text stays as tooltip), and just the arrow in a very narrow pane. */
function shortenBackLabel(back, mode) {   // mode: 'full' | 'short' | 'icon'
    if (!back) return;
    const tn = [...back.childNodes].reverse().find(n => n.nodeType === 3 && n.textContent.trim() !== '' || n.nodeType === 3 && back.dataset.fullLabel !== undefined);
    if (!tn) return;
    if (mode === 'full') {
        if (back.dataset.fullLabel !== undefined) { tn.textContent = back.dataset.fullLabel; delete back.dataset.fullLabel; back.removeAttribute('title'); back.removeAttribute('aria-label'); }
        return;
    }
    if (back.dataset.fullLabel === undefined) back.dataset.fullLabel = tn.textContent;
    tn.textContent = mode === 'icon' ? '' : ' ' + T('Back');
    back.title = back.dataset.fullLabel.trim(); back.setAttribute('aria-label', back.title);
}
function layoutDetailActions() {
    const topBar = document.getElementById('detailTopBar');
    const content = document.getElementById('articleDetailContent');
    const bar = content && content.querySelector('.detail-actions');
    if (!topBar || !bar) return;
    const width = topBar.getBoundingClientRect().width;
    const want = true;   // the joined toolbar is used at every width; narrow panes just show fewer actions, icons only
    const labels = width >= TOP_LABELS_MIN;
    const more = document.getElementById('detailMoreBtn');
    const back = document.getElementById('detailBackButton');
    let holder = document.getElementById('detailTopActions');
    shortenBackLabel(back, width < 440 ? 'icon' : 'short');
    if (want) {
        if (!holder) {
            holder = document.createElement('div'); holder.id = 'detailTopActions'; holder.className = 'detail-toolbar';
            holder.setAttribute('role', 'toolbar'); holder.setAttribute('aria-label', T('Article actions'));
            holder.addEventListener('keydown', (e) => {   // arrow keys move along the bar
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                const l = [...holder.querySelectorAll('button')]; const i = l.indexOf(document.activeElement); if (i < 0) return;
                e.preventDefault(); l[(i + (e.key === 'ArrowRight' ? 1 : l.length - 1)) % l.length].focus();
            });
            back.after(holder);
        }
        wireBarDrop(holder);
        let cb = topBar.querySelector('.card-menu-btn') || bar.querySelector('.card-menu-btn');
        if (cb) cb.classList.add('detail-top-more');
        paintDetailToolbar(holder, cb, width, labels);
        if (!topActions) { if (more) more.hidden = true; bar.hidden = true; topActions = true; }
    } else if (topActions) {
        const cb = holder && holder.querySelector('.card-menu-btn');
        if (cb) { cb.classList.remove('detail-top-more'); bar.append(cb); }
        parkExistingTools();
        if (holder) holder.remove();
        if (more) more.hidden = false;
        bar.hidden = false; topActions = false;
    }
}

/** Read mode: the article in its own tab (reader page: typography, themes, highlights). Falls back to a plain tab. */
async function openReadMode(article) {
    if (article.id) {
        try {
            const url = chrome.runtime.getURL('readerPage.html') + '#id=' + encodeURIComponent(article.id);
            if (chrome.tabs && chrome.tabs.create) { await chrome.tabs.create({ url }); return; }
            if (window.open(url, '_blank', 'noopener')) return;
        } catch (_) { /* fall through to the plain tab */ }
    }
    const readerArticle = await exportView(article);
    const clean = (html) => cleanUntrustedHtml(new DOMParser().parseFromString(String(html || ''), 'text/html').body).innerHTML;
    const title = escapeHtml(article.title || T('Article'));
    const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:Georgia,serif;padding:20px;max-width:800px;margin:auto;background:#f4f4f4;color:#333;line-height:1.6;}h2{color:#444;}img{max-width:100%;height:auto;}</style></head>
<body><h1>${title}</h1><h2>${escapeHtml(T('🧙 AI Summary'))}</h2><div>${clean(readerArticle.summary)}</div><h2>${escapeHtml(T('📄 Original Content'))}</h2><div>${clean(article.content || article.html || article.text)}</div></body></html>`;
    const url = URL.createObjectURL(new Blob([doc], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener');
}

/** After "Back": focus the card that was open (or its neighbour when it is gone) and keep it in view. */
function restoreCardFocus(id) {
    const list = document.getElementById('articleList');
    if (!list) return;
    const card = (id && [...list.querySelectorAll('li[data-id]')].find(li => li.dataset.id === id)) || list.querySelector('li[tabindex="0"]');
    if (card) card.focus({ preventScroll: true });
    if (card && typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'nearest' });
}
