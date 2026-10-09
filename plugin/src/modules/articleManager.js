import { mountReadingTools, destroyReadingTools } from './readingTools.js';
import { modelEmoji } from './modelBadge.js';
import { SK } from './storageKeys.js';
import { escapeHtml, cleanUntrustedHtml } from './textUtils.js';
// Article Manager
// Handles article rendering, expand/collapse, search, etc.


import StorageManager from './storageManager.js';
import { syncTabbarLater } from './tabbar.js';
import { sendToLocalSend } from './localSendClient.js';
import { buildIndex, search as tfidfSearch, similarTo } from './localSearch.js';
import { computeMetrics } from './textMetrics.js';
import { initSelection, registerCard, toggleCard, selectionActive } from './sendSheet.js';
import { T, locale } from './feedI18n.js';
import { withQuestions, qaMarkdown } from './conversation.js';
import { qaSection } from './qaView.js';
import { normalizeDoi } from '../content/paper.js';
import { paperState, paperChips, paperToggle, paperDoi, doiUrl, paperLine, paperType, paperFacts, paperSearchText, extractPaperFacts } from './paperInfo.js';
import { aiComplete } from './feedAi.js';
import { CITE_STYLES, formatCitation, ensureCsl, copyText, getCiteStyle, loadCiteStyle, setCiteStyle } from './citation.js';
import { buildAnnotationsSection, fetchAnnotationsForArticle, buildAnnotationsPlainText, markHighlights } from './annotationExporter.js';

// Escapes translated text for use inside double-quoted HTML attributes.
const escAttr = escapeHtml;

let uiManagerRef = null;
let currentDetailArticle = null;
let cachedArticles = [];          // not archived: graph, search and the Inbox/Read/Sent tabs read from here
let archivedCache = [];           // archived entries (Archive tab)
let historyTab = 'inbox';         // 'inbox' | 'read' | 'sent' | 'archive'
let pendingRender = false;

const isSent = (a) => Array.isArray(a.sentTo) && a.sentTo.length > 0;
const TAB_DEFS = [['inbox', () => T('Inbox')], ['read', () => T('Read')], ['sent', () => T('Sent')], ['research', () => T('Research')], ['archive', () => T('Archive')]];
const RESEARCH_FILTERS = [['all', () => T('All')], ['review', () => T('Reviews')], ['trial', () => T('Trials')], ['preprint', () => T('Preprints')]];
let researchFilter = 'all';

function tabList(tab) {
    if (tab === 'read') return cachedArticles.filter(a => a.readAt);
    if (tab === 'sent') return cachedArticles.filter(isSent);
    if (tab === 'archive') return archivedCache;
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
        b.lastChild.textContent = String(id === 'research' ? cachedArticles.filter(a => paperState(a)).length : tabList(id).length);
    });
    syncTabbarLater(nav);
    return nav;
}

function fmtDay(iso) { try { return new Date(iso).toLocaleDateString(locale(), { month: 'short', day: 'numeric' }); } catch (_) { return ''; } }

/** [tone, text] badges for a card: Sent (per target) else Read else New; Archived is added first. */
export function statusBadges(a) {
    if (!a || a.feedStub) return [];
    const out = [];
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
        const tagMatch = (a.tags || []).some(t => t.toLowerCase().includes(filterText));
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
async function shareArticle(article) {
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
/**
 * Generates and downloads a Markdown file with YAML Frontmatter
 */
async function exportToMarkdown(article) {
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

    // 6. Generate and trigger download
    const blob = new Blob([mdContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    
    // Create a safe, clean filename
    const safeFilename = (article.title || 'article').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    
    a.href = url;
    a.download = `${createdDate}_${safeFilename}_summary.md`;
    document.body.appendChild(a);
    a.click();
    
    // Cleanup
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Copies summary and content to clipboard as formatted text (HTML) and plain text (Markdown-ish)
 */
async function copyArticleToClipboard(article) {
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
async function sendToKindle(article) {
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

async function dispatchToLocalSend(article) {
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

export function initArticleManager(uiManager) {
    uiManagerRef = uiManager;
    initSelection({
        deliverKindle, deliverLocalSend,
        applyStatus, currentTab: () => historyTab,
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

        // Show/hide clear button as user types
        const clearBtn = document.getElementById('searchClearBtn');
        if (clearBtn) {
            searchInput.addEventListener('input', () => {
                const hasText = searchInput.value.length > 0;
                clearBtn.hidden = !hasText;
                searchInput.classList.toggle('has-clear', hasText);
            });
            clearBtn.addEventListener('click', () => {
                searchInput.value = '';
                clearBtn.hidden = true;
                searchInput.classList.remove('has-clear');
                filterArticles();
                updateGraphScopeToggleVisibility();
                searchInput.focus();
            });
        }
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
                    graphContainer.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);">${T('No articles to graph yet.')}</div>`;
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
    if (historyTopBar) historyTopBar.classList.remove('scroll-hidden');
    if (detailTopBar) detailTopBar.classList.remove('scroll-hidden');
    if (historyTopBar) historyTopBar.style.display = 'flex';
    if (articleList) articleList.style.display = 'block';
    document.dispatchEvent(new Event('aish:ws-refresh'));
    import('./feedManager.js')
        .then(m => m.reconcileStubs())
        .catch(() => {})
        .then(() => StorageManager.getArticlesIndex({ includeArchived: true }))
        .then(articles => {
            cachedArticles = articles.filter(a => !a.archived);
            archivedCache = articles.filter(a => a.archived);
            invalidateSearchIndex();
            renderTab();
        }).catch(() => {});
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

export function renderArticles(articles) {
    const articleList = document.getElementById('articleList');
    articleList.innerHTML = '';
    // The tabs live in the top bar (like Feeds' scope row), mounted once.
    const tabsBar = document.getElementById('historyTopBar');
    const tabsNav = buildTabs();
    if (tabsBar && tabsNav.parentNode !== tabsBar) tabsBar.appendChild(tabsNav);
    renderResearchFilters(tabsBar);
    if (!articles || articles.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.id = 'emptyMessage';
        const p = document.createElement('p');
        if (historyTab === 'inbox' && cachedArticles.length === 0 && archivedCache.length === 0) p.textContent = T('🗂️ Your archive is as empty as a desert! Start saving some articles to fill it up. 🌵');
        else p.textContent = T('Nothing here yet');
        emptyMessage.appendChild(p);
        articleList.appendChild(emptyMessage);
        return;
    }

    // Cancel any in-flight chunked render so a rapid re-render (e.g. a
    // search keystroke) doesn't keep appending stale cards after we've
    // cleared the list.
    if (articleList.__renderChunkId) {
        cancelIdleCallback(articleList.__renderChunkId);
        articleList.__renderChunkId = null;
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
    const tagsHtml = tags.length ? `<div class="card-tags">${tags.map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('')}</div>` : '';
    const modelBadge = article.modelId ? `<span class="card-model">${modelEmoji(article)} ${escapeHtml(article.modelId)}</span>` : '';

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
          <button class="star-button" title="${escAttr(T('Favorite'))}" aria-label="${escAttr(T('Favorite'))}" aria-pressed="${article.favorite ? 'true' : 'false'}">${article.favorite ? '★' : '☆'}</button>
        </div>
    `;
    listItem.classList.toggle('is-favorite', !!article.favorite);

    // Favorited from a feed but never summarized: one-click summarize.
    if (article.feedStub && article.url) {
        const sumBtn = document.createElement('button');
        sumBtn.type = 'button';
        sumBtn.className = 'button-primary btn-sm';
        sumBtn.style.marginTop = '8px';
        sumBtn.textContent = T('✨ Summarize');
        sumBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            sumBtn.disabled = true;
            sumBtn.textContent = T('⏳ Summarizing…');
            chrome.runtime.sendMessage({ action: 'openFeedItem', url: article.url, summarize: true }, (res) => {
                if (chrome.runtime.lastError || !res || !res.success) {
                    sumBtn.disabled = false;
                    sumBtn.textContent = T('✨ Summarize');
                    return;
                }
                // Re-check shortly; the summary replaces this placeholder when saved.
                let tries = 0;
                const poll = setInterval(async () => {
                    tries++;
                    try {
                        const idx = await StorageManager.getArticlesIndex();
                        const done = idx.some(a => !a.feedStub && a.url === article.url);
                        if (done || tries > 40) {
                            clearInterval(poll);
                            if (done && document.getElementById('articleList')?.style.display !== 'none') loadHistory();
                            else { sumBtn.disabled = false; sumBtn.textContent = T('✨ Summarize'); }
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
        const btn = event.currentTarget;
        const next = await StorageManager.toggleFavorite(article.id);
        if (next === null) return;
        article.favorite = next;
        const cached = cachedArticles.find(a => a.id === article.id);
        if (cached) cached.favorite = next;
        listItem.classList.toggle('is-favorite', next);
        btn.textContent = next ? '★' : '☆';
        btn.setAttribute('aria-pressed', String(next));
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
            pChips.slice().reverse().forEach(([tone, text]) => { const b = document.createElement('span'); b.className = 'tag-chip paper paper-' + tone; b.textContent = text; row.prepend(b); });
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
    listItem.addEventListener('click', (event) => {
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
    const lowerFilter = filterText.toLowerCase();
    const graphContainer = document.getElementById('graphContainer');

    // Tier 1: cheap title/tag substring match — this is the whole cost for
    // an empty or very short query, same as the original behaviour.
    const cheapMatch = (a) => {
        const titleMatch = (a.title || '').toLowerCase().includes(lowerFilter);
        const tagMatch = (a.tags || []).some(t => t.toLowerCase().includes(lowerFilter));
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
            badges.push(`<span class="tag-chip" style="font-size:11px;" title="${escAttr(T('Flesch reading ease: {ease}/100', { ease: metrics.readingLevel.ease }))}">📖 ${T('{label} · grade {grade}', { label: metrics.readingLevel.label, grade: metrics.readingLevel.grade })}</span>`);
        }
        if (metrics.sentiment && metrics.sentiment.matches > 0) {
            const moodEmoji = metrics.sentiment.label === 'Positive' ? '🙂' : metrics.sentiment.label === 'Negative' ? '🙁' : '😐';
            badges.push(`<span class="tag-chip" style="font-size:11px;">${moodEmoji} ${metrics.sentiment.label === 'Positive' ? T('Positive tone') : metrics.sentiment.label === 'Negative' ? T('Negative tone') : metrics.sentiment.label === 'Neutral' ? T('Neutral tone') : T('{label} tone', { label: metrics.sentiment.label })}</span>`);
        }
        if (metrics.estimatedMinutes) {
            badges.push(`<span class="tag-chip" style="font-size:11px;">⏱️ ${T('~{n} min read', { n: metrics.estimatedMinutes })}</span>`);
        }

        const relatedHtml = related.length ? `
          <div style="margin-top:10px;">
            <strong style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:6px;">${T('🔗 Similar in your archive')}</strong>
            ${related.map(r => `<div class="related-article-link" data-ts="${r.article.timestamp}" style="font-size:12px;padding:6px 0;border-top:1px solid rgba(148,163,184,0.15);cursor:pointer;">${escapeHtml(r.article.title || T('Untitled'))} <span style="color:var(--text-muted);">(${T('{n}% similar', { n: Math.round(r.score * 100) })})</span></div>`).join('')}
          </div>` : '';

        container.innerHTML = `${badges.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;">${badges.join('')}</div>` : ''}${relatedHtml}`;

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
/** Tag row of the detail view: 🎓 paper chips first (✕ = not a paper), then the tags (✕ removes), then "+ Tag" (also: mark as research paper). */
function renderDetailTags(article, host) {
    if (!host) return;
    host.replaceChildren();
    const mk = (cls, text) => { const c = document.createElement('span'); c.className = cls; c.textContent = text; return c; };
    const xBtn = (label, onClick) => {
        const x = document.createElement('button'); x.type = 'button'; x.className = 'tag-x'; x.textContent = '✕'; x.title = label; x.setAttribute('aria-label', label);
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
        const c = mk('tag-chip', t);
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
        const assignDoi = async (doi) => {
            await StorageManager.savePaperInfo(article.id, { state: 'yes', doi });
            await applyStatus([article.id], { paperOverride: 'yes' });
            article.paperOverride = 'yes'; article.doi = doi; article.paper = 'yes';
            article.meta = Object.assign({}, article.meta, { paper: Object.assign({}, article.meta && article.meta.paper, { state: 'yes', doi }) });
            const hit = cachedArticles.find(a => a.id === article.id) || archivedCache.find(a => a.id === article.id);
            if (hit) { hit.doi = doi; hit.paper = 'yes'; }
            refresh();
        };
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

let paperDetailsOpen = false;
function renderPaperRow(article, row) {
    if (!row) return;
    row.replaceChildren();
    if (!paperState(article)) { row.hidden = true; return; }   // the 🎓 chip itself lives in the tag row (renderDetailTags)
    row.hidden = false;
    row.className = 'paper-row';
    const wrapper = document.createElement('details'); wrapper.className = 'paper-details'; wrapper.open = paperDetailsOpen;
    wrapper.addEventListener('toggle', () => { paperDetailsOpen = wrapper.open; });
    const sum = document.createElement('summary'); sum.textContent = T('🎓 Paper details · Facts · Cite · DOI');
    wrapper.appendChild(sum); row.appendChild(wrapper);
    const line = paperLine(article);
    if (line) { const l = document.createElement('div'); l.className = 'paper-line'; l.textContent = line; wrapper.appendChild(l); }
    const facts = paperFacts(article);
    const card = document.createElement('div'); card.className = 'paper-card';
    if (facts.length) {
        const box = document.createElement('dl'); box.className = 'paper-facts';
        facts.forEach(([k, v]) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; box.append(dt, dd); });
        card.appendChild(box);
    }
    if (article.id && paperState(article)) {
        const cite = document.createElement('div'); cite.className = 'cite-block';
        card.appendChild(cite); renderCiteBlock(article, cite);
    }
    wrapper.appendChild(card);
    if (!facts.length && article.id && paperState(article)) {
        const f = document.createElement('button');
        f.type = 'button'; f.className = 'button-secondary paper-facts-btn'; f.textContent = T('🔎 Key facts');
        f.addEventListener('click', async (e) => {
            e.stopPropagation();
            f.disabled = true; f.textContent = T('Thinking…');
            try {
                const merged = await extractPaperFacts(article, aiComplete, new Intl.DisplayNames(['en'], { type: 'language' }).of(locale()) || 'English');
                article.meta = { ...(article.meta || {}), paper: { ...((article.meta || {}).paper || {}), ...merged } };
                article.paperType = merged.type;
                renderPaperRow(article, row);
            } catch (err) { f.disabled = false; f.textContent = '❌ ' + ((err && err.message) || T('AI request failed')); }
        });
        card.insertBefore(f, card.firstChild);
    }
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
    const summaryDoc = new DOMParser().parseFromString(article.summaryBase !== undefined ? article.summaryBase : (article.summary || escapeHtml(T('No summary available'))), 'text/html');
    summaryDoc.querySelectorAll('img').forEach(el => el.remove());
    const safeSummary = cleanUntrustedHtml(summaryDoc.body).innerHTML;

    const detailDoc = new DOMParser().parseFromString(rawContentSource, 'text/html');
    cleanUntrustedHtml(detailDoc.body);
    // Keep the images; .detail-original img caps their width so they don't break the popup layout
    const safeContent = detailDoc.body.innerHTML || escapeHtml(T('No content available.'));
    const domain = article.url ? (() => { try { return new URL(article.url).hostname; } catch { return ''; } })() : '';
    const tags = article.tags || [];
    const modelInfo = article.modelId ? `<span class="detail-model">${modelEmoji(article)} ${escapeHtml(article.modelId)}</span>` : '';
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
          <button class="button-secondary open-button">${T('Read 👓')}</button>
          <button class="button-secondary copy-button">${T('Copy 📋')}</button>
          <button class="button-secondary md-button">${T('.MD 💾')}</button>
          <button class="button-secondary share-button">${T('Share 🔗')}</button>
          <button class="button-secondary kindle-button">${T('Kindle 📚')}</button>
          <button class="button-secondary localsend-button">${T('LocalSend 📱')}</button>
        </div>
        <div class="summary-box">
          <strong class="summary-box-title">${T('🧙 AI Summary')}</strong>
          <div>${safeSummary}</div>
          <div id="qaMount" class="detail-qa"></div>
        </div>
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
    renderPaperRow(article, articleDetailContent.querySelector('.paper-row'));
    renderDetailQa(article, articleDetailContent.querySelector('#qaMount'));
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
    const mdBtn = articleDetailContent.querySelector('.md-button');
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
    if (mdBtn) mdBtn.addEventListener('click', (e) => { e.stopPropagation(); exportToMarkdown(article); });
    if (openBtn) {
        openBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const readerArticle = await exportView(article);
            const newTab = window.open();
            newTab.document.write(`
                <html><head><title>${safeTitle}</title>
                <style>body{font-family:Georgia,serif;padding:20px;max-width:800px;margin:auto;background:#f4f4f4;color:#333;line-height:1.6;}
                h2{color:#444;}img{max-width:100%;height:auto;}</style></head>
                <body><h2>Summary</h2><div>${readerArticle.summary}</div><h2>Content</h2><div>${article.content}</div></body></html>
            `);
            newTab.document.close();
        });
    }
    // Show detail, hide list and graph
    if (articleList) articleList.style.display = 'none';
    if (graphContainer && !wsActive()) graphContainer.style.display = 'none';
    if (historyTopBar) historyTopBar.style.display = 'none';
    if (detailTopBar) detailTopBar.style.display = 'flex';
    articleDetail.style.display = 'block';
    mountReadingTools({ scroller: document.getElementById('historyScreen'), content: articleDetailContent, article });   // Scroll to top + contents on long texts
    // Keyboard: focus moves to "Back" (so Esc / Enter returns); the card that opened this stays remembered.
    const back = document.getElementById('detailBackButton');
    if (back) back.focus({ preventScroll: true });
}

/** After "Back": focus the card that was open (or its neighbour when it is gone) and keep it in view. */
function restoreCardFocus(id) {
    const list = document.getElementById('articleList');
    if (!list) return;
    const card = (id && [...list.querySelectorAll('li[data-id]')].find(li => li.dataset.id === id)) || list.querySelector('li[tabindex="0"]');
    if (card) card.focus({ preventScroll: true });
    if (card && typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'nearest' });
}
