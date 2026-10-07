// Article Manager
// Handles article rendering, expand/collapse, search, etc.


import StorageManager from './storageManager.js';
import { sendToLocalSend } from './localSendClient.js';
import { buildIndex, search as tfidfSearch, similarTo } from './localSearch.js';
import { computeMetrics } from './textMetrics.js';
import { syncSeg, syncSegLater } from './segmented.js';
import { initSelection, registerCard, toggleCard, selectionActive } from './sendSheet.js';
import { T, locale } from './feedI18n.js';
import { buildAnnotationsSection, fetchAnnotationsForArticle, buildAnnotationsPlainText, markHighlights } from './annotationExporter.js';

let uiManagerRef = null;
let currentDetailArticle = null;
let cachedArticles = [];          // not archived: graph, search and the Inbox/Read/Sent tabs read from here
let archivedCache = [];           // archived entries (Archive tab)
let historyTab = 'inbox';         // 'inbox' | 'read' | 'sent' | 'archive'
let pendingRender = false;

const isSent = (a) => Array.isArray(a.sentTo) && a.sentTo.length > 0;
const TAB_DEFS = [['inbox', () => T('Inbox')], ['read', () => T('Read')], ['sent', () => T('Sent')], ['archive', () => T('Archive')]];

function tabList(tab) {
    if (tab === 'read') return cachedArticles.filter(a => a.readAt);
    if (tab === 'sent') return cachedArticles.filter(isSent);
    if (tab === 'archive') return archivedCache;
    return cachedArticles;
}

export const currentHistoryTab = () => historyTab;

/** Re-render the list for the active tab (Inbox = everything not archived). */
export function renderTab() { renderArticles(tabList(historyTab)); }

function buildTabs() {
    const nav = document.createElement('li');
    nav.className = 'history-tabs seg';
    nav.dataset.seg = 'history-tabs';
    nav.setAttribute('role', 'tablist');
    TAB_DEFS.forEach(([id, label]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'history-tab seg-btn' + (historyTab === id ? ' on' : '');
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(historyTab === id));
        b.dataset.tab = id;
        const n = tabList(id).length;
        b.append(Object.assign(document.createElement('span'), { textContent: label() }), Object.assign(document.createElement('span'), { className: 'history-tab-n seg-n', textContent: String(n) }));
        b.addEventListener('click', () => { if (historyTab === id) return; historyTab = id; renderTab(); const f = document.getElementById('searchInput'); if (f && f.value.trim()) filterArticles(); });
        nav.appendChild(b);
    });
    syncSegLater(nav);
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

async function buildArticleDocumentHtml(article) {
    // Include the article's highlights & AI suggested highlights (ghosts
    // included even if never marked "keep").
    const annotations = await fetchAnnotationsForArticle(article);
    const annotationsHtml = await buildAnnotationsSection(article, annotations);
    const summaryHtml = markHighlights(article.summary, annotations);
    const contentHtml = markHighlights(article.content, annotations);
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${article.title || 'AI Summary'}</title>
<style>body{font-family:sans-serif;line-height:1.6;padding:20px;max-width:800px;margin:auto;}h1{border-bottom:2px solid #333;padding-bottom:5px;}.meta{color:#555;font-style:italic;}.summary{background:#f8f9fa;padding:15px;border-left:4px solid #0284c7;margin:20px 0;}img{max-width:100%;height:auto;}</style>
</head><body><h1>${article.title || 'AI Summary'}</h1>
<div class="meta">Captured via AI Summary Helper &middot; <a href="${article.url || '#'}">Source</a></div>
${summaryHtml ? `<div class="summary"><h2>🧙 AI Summary</h2>${summaryHtml}</div>` : ''}
${annotationsHtml}
${contentHtml ? `<h2>📄 Content</h2><div>${contentHtml}</div>` : ''}</body></html>`;
}

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
        if (uiManagerRef) uiManagerRef.showToast('Sharing is not supported in this browser/environment.');
        else alert('Sharing is not supported in this browser/environment.');
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
            if (uiManagerRef) uiManagerRef.showToast('File shared successfully.');
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
            uiManagerRef.showToast(`Share failed: ${err?.message || 'Unknown error'}`);
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

    // 4. Construct the YAML Frontmatter
    const frontmatter = `---
title: "${safeTitle}"
source: "${article.url || ''}"
author: 
published: 
created: ${createdDate}
description: 
${tagsFrontmatter}
bookrecs: 
why: 
---`;

    // 5. Construct the Markdown Body — convert vanilla <img> and <a> to Markdown
    const summaryPlain = article.summary ? article.summary.replace(/<[^>]+>/g, '').trim() : 'No summary available.';

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

    const mdContent = `${frontmatter}

# Summary
${summaryPlain}

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
    const title = article.title || 'AI Summary';
    const summary = article.summary || '';
    const content = article.content || '';

    // Fetch annotations (user + ghost) once and reuse for both mime types.
    const annotations = await fetchAnnotationsForArticle(article);
    const annotationsHtml = await buildAnnotationsSection(article, annotations);
    const annotationsPlain = await buildAnnotationsPlainText(article, annotations);

    // Create a clean HTML version for the clipboard
    const cleanHtml = `
        <div style="font-family: sans-serif;">
            <h1>${title}</h1>
            <p><a href="${article.url}">${article.url}</a></p>
            <hr>
            <h2>🧙 AI Summary</h2>
            <div>${markHighlights(summary, annotations)}</div>
            ${annotationsHtml ? `<hr><div>${annotationsHtml}</div>` : ''}
            <hr>
            <h2>📄 Original Content</h2>
            <div>${markHighlights(content, annotations)}</div>
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
        if (uiManagerRef) uiManagerRef.showToast('Copied to clipboard! 📋');
    } catch (err) {
        console.error('Clipboard copy failed:', err);
        // Fallback for cases where ClipboardItem might fail
        try {
            await navigator.clipboard.writeText(plainText);
            if (uiManagerRef) uiManagerRef.showToast('Copied as plain text.');
        } catch (e) {
            console.error('Final copy fallback failed:', e);
        }
    }
}


/**
 * Sends article summary and content to a Kindle email via the proxy API
 */
async function sendToKindle(article) {
    const config = await StorageManager.getAll();
    // Multiple Kindle devices can be configured; always send to the active
    // one (last used, or the first configured if none has been used yet).
    const device = StorageManager.getActiveDevice(config, 'kindle');
    const kindleEmail = (device?.addresses?.[0] || '').replace(/^mailto:/i, '');
    if (!kindleEmail) {
        if (uiManagerRef) {
            uiManagerRef.showToast('Set your Kindle email in Settings first.');
            uiManagerRef.showScreen('settings');
            import('./settingsNav.js').then(m => m.openSettingsPanel('send', 'newKindleEmail')).catch(() => {});
        } else {
            alert('Please configure your Kindle delivery email address inside settings first.');
        }
        return;
    }

    const isPro = config.pb_user?.subscription_status === 'active';
    if (!isPro) {
        const confirmation = confirm('📚 Send to Kindle\n\nFree tier: 3 Kindle sends included.\nUpgrade to Pro for unlimited.\n\nMake sure kindle@byphil.eu is in your Kindle approved senders list (see Amazon help).\n\nSend this article to Kindle?');
        if (!confirmation) return;
    }

    // Content now arrives pre-optimized from content capture.
    if (uiManagerRef) {
        uiManagerRef.showToast('Preparing Kindle delivery... ⏳', 3000);
    }

    try {
        const apiBase = StorageManager.getApiBase();
        const headers = { 'Content-Type': 'application/json' };
        if (config.pb_token) {
            headers['Authorization'] = `Bearer ${config.pb_token}`;
        } else if (config.licenseKey) {
            headers['Authorization'] = `Bearer ${config.licenseKey}`;
        }

        const annotations = await fetchAnnotationsForArticle(article);
        const annotationsHtml = await buildAnnotationsSection(article, annotations);

        const response = await fetch(`${apiBase}/v1/projects/ai_summary_helper/kindle`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                kindle_email: kindleEmail,
                title: article.title || 'AI Summary Document',
                content: [markHighlights(article.content || article.summary || '', annotations), annotationsHtml].filter(Boolean).join('\n'),
                summary: markHighlights(article.summary || '', annotations),
                url: article.url || ''
            })
        });

        const resData = await response.json();
        if (response.ok && resData.success) {
            if (uiManagerRef) uiManagerRef.showToast('Sent to Kindle! 📚');
            if (device) StorageManager.setActiveDevice('kindle', device.id);
            if (article.id) applyStatus([article.id], { sent: { kind: 'kindle', label: device?.label || '' } }).catch(() => {});
        } else {
            const msg = resData.error || 'Kindle delivery failed.';
            if (resData.error?.includes('Free tier limit') || resData.error?.includes('402')) {
                alert(`📚 Free tier limit reached (3 sends).\n\nUpgrade to Pro for unlimited Kindle delivery.\n\nhttps://philwornath.com/links`);
            } else if (uiManagerRef) {
                uiManagerRef.showToast(msg);
            } else {
                alert(msg);
            }
        }
    } catch (err) {
        console.error('Kindle dispatch error:', err);
        if (uiManagerRef) uiManagerRef.showToast('Network error sending to Kindle.');
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
            uiManagerRef.showToast('Please set your LocalSend IP in Settings first.');
            uiManagerRef.showScreen('settings');
            import('./settingsNav.js').then(m => m.openSettingsPanel('send', 'newLocalSendIp')).catch(() => {});
        } else {
            alert('Configure your LocalSend IP address inside settings first.');
        }
        return;
    }

    if (uiManagerRef) uiManagerRef.showToast('Sending to LocalSend over Wi-Fi... 🚀');

    try {
        const { fileName, docHtml } = await buildArticleHtmlFile(article);

        await sendToLocalSend(readerIp, fileName, docHtml, 'text/html');

        if (uiManagerRef) uiManagerRef.showToast('Sent successfully! 📖');
        if (device) StorageManager.setActiveDevice('localsend', device.id);
        if (article.id) applyStatus([article.id], { sent: { kind: 'localsend', label: device?.label || '' } }).catch(() => {});
    } catch (err) {
        console.error('[LocalSend Error]', err);
        if (uiManagerRef) uiManagerRef.showToast(`Transfer failed: ${err?.message || 'Check if receiver is online.'}`);
    }
}

/**
 * Non-interactive deliveries used by the History multi-select sheet (sendSheet.js).
 * They return {ok, error?} instead of toasting, so the sheet can show progress per item.
 */
export async function deliverKindle(article, device) {
    const config = await StorageManager.getAll();
    const kindleEmail = (device?.addresses?.[0] || '').replace(/^mailto:/i, '');
    if (!kindleEmail) return { ok: false, error: 'No Kindle email set.' };
    try {
        const apiBase = StorageManager.getApiBase();
        const headers = { 'Content-Type': 'application/json' };
        if (config.pb_token) headers['Authorization'] = `Bearer ${config.pb_token}`;
        else if (config.licenseKey) headers['Authorization'] = `Bearer ${config.licenseKey}`;
        const annotations = article.id ? await fetchAnnotationsForArticle(article) : [];
        const annotationsHtml = article.id ? await buildAnnotationsSection(article, annotations) : '';
        const response = await fetch(`${apiBase}/v1/projects/ai_summary_helper/kindle`, {
            method: 'POST', headers,
            body: JSON.stringify({
                kindle_email: kindleEmail,
                title: article.title || 'AI Summary Document',
                content: [markHighlights(article.content || article.summary || '', annotations), annotationsHtml].filter(Boolean).join('\n'),
                summary: markHighlights(article.summary || '', annotations),
                url: article.url || ''
            })
        });
        const resData = await response.json().catch(() => ({}));
        if (response.ok && resData.success) return { ok: true };
        return { ok: false, error: resData.error || 'Kindle delivery failed.' };
    } catch (err) {
        return { ok: false, error: err?.message || 'Network error' };
    }
}

export async function deliverLocalSend(article, device) {
    const ip = (device?.addresses?.[0] || '').trim();
    if (!ip) return { ok: false, error: 'No receiver address set.' };
    try {
        const { fileName, docHtml } = await buildArticleHtmlFile(article);
        await sendToLocalSend(ip, fileName, docHtml, 'text/html');
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err?.message || 'Check if the receiver is online.' };
    }
}

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
            graphScopeToggleBtn.textContent = 'View: Highlighted';
            graphScopeToggleBtn.title = 'Highlighting matches in the whole archive — click to filter to matches only';
            graphScopeToggleBtn.setAttribute('aria-label', 'Switch graph search to filter mode');
        } else {
            graphScopeToggleBtn.textContent = 'View: Filtered';
            graphScopeToggleBtn.title = 'Filtering graph to matches only — click to highlight matches in the whole archive instead';
            graphScopeToggleBtn.setAttribute('aria-label', 'Switch graph search to highlight mode');
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
        if (!confirm('Are you sure you want to delete this article?')) return;

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
            if (graphContainer) graphContainer.style.display = 'none';
            if (reportContainer) reportContainer.style.display = 'none';
            if (articleList) articleList.style.display = 'block';
            if (historyTopBar) historyTopBar.style.display = 'flex';
            if (detailTopBar) detailTopBar.style.display = 'none';
        });
    };

    // ── Handle Detail Back Button ───────────────────────────────────────
    if (detailBackBtn) {
        detailBackBtn.addEventListener('click', () => {
            const articleDetail = document.getElementById('articleDetail');
            const articleList = document.getElementById('articleList');
            const graphContainer = document.getElementById('graphContainer');
            const reportContainer = document.getElementById('reportContainer');
            if (articleDetail) articleDetail.style.display = 'none';
            if (graphContainer) graphContainer.style.display = 'none';
            if (reportContainer) reportContainer.style.display = 'none';
            if (articleList) articleList.style.display = 'block';
            if (historyTopBar) historyTopBar.style.display = 'flex';
            if (detailTopBar) detailTopBar.style.display = 'none';
        });
    }

    if (detailDeleteBtn) {
        detailDeleteBtn.addEventListener('click', deleteCurrentDetailArticle);
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

    document.addEventListener('keydown', (event) => {
        if (event.metaKey && event.key === 'f') {
            event.preventDefault();
            const historyNav = document.querySelector('.nav-item[data-screen="history"]');
            if (historyNav && historyNav.classList.contains('active') && historyTopBar?.style.display !== 'none') {
                searchInput.focus();
            }
        }
    });

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
            graphContainer.style.display = 'block';
            graphContainer.style.opacity = '1';
            // Fresh open: default back to 'filtered' rather than remembering
            // the scope from a previous graph session, and bring back the
            // stats banner if it was dismissed in a previous session (it
            // persists through same-session re-renders — e.g. toggling
            // well-connected/all-tags — but not across a full close/reopen).
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
                    // Fall back to storage if cache is empty (e.g. first load)
                    StorageManager.getArticlesIndex().then(articles => {
                        if (articles.length > 0) {
                            import('./archiveGraph.js').then(mod => {
                                mod.initArchiveGraph(graphContainer, articles, currentDetailArticle?.timestamp, buildIndex(articles));
                            });
                        } else {
                    graphContainer.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">No articles to graph yet.</div>';
                        }
                    });
                }
        }
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
            StorageManager.getArticlesIndex({ includeArchived: true }).then(articles => {
                import('./analyticsManager.js').then(mod => {
                    mod.initAnalyticsReport(reportContainer, articles);
                });
            });
        }
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
            reportContainerEl.style.display = 'none';
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
    if (graphContainer) graphContainer.style.display = 'none';
    if (reportContainer) reportContainer.style.display = 'none';
    if (articleDetail) articleDetail.style.display = 'none';
    if (detailTopBar) detailTopBar.style.display = 'none';
    if (historyTopBar) historyTopBar.classList.remove('scroll-hidden');
    if (detailTopBar) detailTopBar.classList.remove('scroll-hidden');
    if (historyTopBar) historyTopBar.style.display = 'flex';
    if (articleList) articleList.style.display = 'block';
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

export function renderArticles(articles) {
    const articleList = document.getElementById('articleList');
    articleList.innerHTML = '';
    articleList.appendChild(buildTabs());
    if (!articles || articles.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.id = 'emptyMessage';
        const p = document.createElement('p');
        if (historyTab === 'inbox' && cachedArticles.length === 0 && archivedCache.length === 0) p.textContent = '🗂️ Your archive is as empty as a desert! Start saving some articles to fill it up. 🌵';
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
    const articleHeader = article.title || (article.content && article.content.split('\n')[0]) || "No title available";
    const listItem = document.createElement('li');
    listItem.classList.add('article-card');
    listItem.dataset.ts = String(article.timestamp);
    const formattedDate = new Date(article.timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    let articleDomain = '';
    if (article.url) {
        articleDomain = new URL(article.url).hostname;
    }
    const tags = article.tags || [];
    const tagsHtml = tags.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">${tags.map(t => `<span class="tag-chip">${t}</span>`).join('')}</div>` : '';
    const modelEmoji = article.connectionMode === 'cloud' ? '☁️' : '💻';
    const modelBadge = article.modelId ? `<span style="font-size:10px;opacity:0.5;display:inline-block;margin-top:4px;">${modelEmoji} ${article.modelId}</span>` : '';

    // Decision metadata (timeframe + reason)
    const decisionHtml = article.isDecision ? `
      <div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(148,163,184,0.1);">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          ${article.decisionTimeframe ? `<span style="font-size:11px;background:rgba(59,130,246,0.15);color:#3b82f6;padding:3px 8px;border-radius:12px;font-weight:600;">🔖 ${article.decisionTimeframe}</span>` : ''}
          ${article.decisionReason ? `<span style="font-size:11px;color:#94a3b8;font-style:italic;">"${article.decisionReason}"</span>` : ''}
        </div>
      </div>
    ` : '';

    listItem.innerHTML = `
        <div class="article-header">
          <div>
            <h4>${articleHeader}</h4>
            <p class="article-date">💾 ${formattedDate} ${article.url ? `from <a href="${article.url}" target="_blank">${articleDomain}</a> ↗` : ''}</p>
            ${tagsHtml}
            ${modelBadge}
            ${decisionHtml}
          </div>
          <button class="star-button" title="Favorite" aria-label="Favorite" aria-pressed="${article.favorite ? 'true' : 'false'}">${article.favorite ? '★' : '☆'}</button>
        </div>
    `;
    listItem.classList.toggle('is-favorite', !!article.favorite);

    // Favorited from a feed but never summarized: one-click summarize.
    if (article.feedStub && article.url) {
        const sumBtn = document.createElement('button');
        sumBtn.type = 'button';
        sumBtn.className = 'button-primary feed-btn';
        sumBtn.style.marginTop = '8px';
        sumBtn.textContent = '✨ Summarize';
        sumBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            sumBtn.disabled = true;
            sumBtn.textContent = '⏳ Summarizing…';
            chrome.runtime.sendMessage({ action: 'openFeedItem', url: article.url, summarize: true }, (res) => {
                if (chrome.runtime.lastError || !res || !res.success) {
                    sumBtn.disabled = false;
                    sumBtn.textContent = '✨ Summarize';
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
                            else { sumBtn.disabled = false; sumBtn.textContent = '✨ Summarize'; }
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
            const row = document.createElement('div');
            row.className = 'status-badges';
            badges.forEach(([tone, text]) => { const b = document.createElement('span'); b.className = 'status-badge ' + tone; b.textContent = text; row.appendChild(b); });
            host.appendChild(row);
        }
        if (host && article.archived) {
            const r = document.createElement('button');
            r.type = 'button'; r.className = 'button-secondary status-restore'; r.textContent = T('↩ Restore to Inbox');
            r.addEventListener('click', (e) => { e.stopPropagation(); applyStatus([article.id], { archived: false }); });
            host.appendChild(r);
        }
    }
    registerCard(article, listItem);
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
        return titleMatch || tagMatch;
    };

    // If graph is visible, react to the search box per graphScopeMode:
    // 'filtered' rebuilds to only the matching articles (nodes for
    // non-matches disappear); 'all' keeps every node and just dims
    // non-matches in place (no rebuild, no simulation restart). The graph
    // is keyed on tags anyway, so filtered mode stays on the cheap tier only.
    if (graphContainer && graphContainer.style.display === 'block') {
        if (graphScopeMode === 'all') {
            scheduleGraphSearchDim(graphContainer, filterText);
            return;
        }
        const filtered = cachedArticles.filter(cheapMatch);
        import('./archiveGraph.js').then(mod => {
            mod.initArchiveGraph(graphContainer, filtered.length > 0 ? filtered : cachedArticles, currentDetailArticle?.timestamp, ensureSearchIndex());
        });
        graphContainer.style.opacity = filterText && filtered.length < cachedArticles.length ? '0.9' : '1';
        return;
    }

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
        const cheapHit = headerText.includes(lowerFilter) || tagText.includes(lowerFilter);
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
            badges.push(`<span class="tag-chip" style="font-size:11px;" title="Flesch reading ease: ${metrics.readingLevel.ease}/100">📖 ${metrics.readingLevel.label} · grade ${metrics.readingLevel.grade}</span>`);
        }
        if (metrics.sentiment && metrics.sentiment.matches > 0) {
            const moodEmoji = metrics.sentiment.label === 'Positive' ? '🙂' : metrics.sentiment.label === 'Negative' ? '🙁' : '😐';
            badges.push(`<span class="tag-chip" style="font-size:11px;">${moodEmoji} ${metrics.sentiment.label} tone</span>`);
        }
        if (metrics.estimatedMinutes) {
            badges.push(`<span class="tag-chip" style="font-size:11px;">⏱️ ~${metrics.estimatedMinutes} min read</span>`);
        }

        const relatedHtml = related.length ? `
          <div style="margin-top:10px;">
            <strong style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:6px;">🔗 Similar in your archive</strong>
            ${related.map(r => `<div class="related-article-link" data-ts="${r.article.timestamp}" style="font-size:12px;padding:6px 0;border-top:1px solid rgba(148,163,184,0.15);cursor:pointer;">${(r.article.title || 'Untitled')} <span style="color:var(--text-muted);">(${Math.round(r.score * 100)}% similar)</span></div>`).join('')}
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
export async function showArticleDetail(article) {
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

    const safeTitle = article.title || (rawContentSource && rawContentSource.split('\n')[0]) || 'Article';
    const safeSummary = (article.summary || 'No summary available').replace(/<img[^>]*>/gi, '');

    // Safely extract pristine plain text via an isolated DOM Parser
    const detailParser = new DOMParser();
    const detailDoc = detailParser.parseFromString(rawContentSource, 'text/html');

    // 🔥 NEW: Keep the images, but enforce max-width so they don't break the popup layout
    const detailImages = detailDoc.querySelectorAll('img');
    detailImages.forEach(el => {
        el.style.cssText = 'max-width: 100%; height: auto; border-radius: 6px; margin: 12px 0; display: block; box-shadow: 0 2px 8px rgba(0,0,0,0.1);';
    });

    // Strip remaining tags cleanly, preserving line breaks
    const safeContent = detailDoc.body.innerHTML || 'No content available.';
    const domain = article.url ? (() => { try { return new URL(article.url).hostname; } catch { return ''; } })() : '';
    const tags = article.tags || [];
    const tagsHtml = tags.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">${tags.map(t => `<span class="tag-chip" style="font-size:12px;">${t}</span>`).join('')}</div>` : '';
    const modelEmoji = article.connectionMode === 'cloud' ? '☁️' : '💻';
    const modelInfo = article.modelId ? `<span style="font-size:11px;color:var(--text-muted);display:inline-block;margin-right:12px;">${modelEmoji} ${article.modelId}</span>` : '';
    const lengthInfo = article.summaryLength ? `<span style="font-size:11px;color:var(--text-muted);display:inline-block;">📏 ${article.summaryLength}w</span>` : '';
    
    // Decision metadata
    const decisionBadge = article.isDecision ? `
      <div style="background:rgba(59,130,246,0.1);border-left:3px solid #3b82f6;padding:12px;margin-bottom:12px;border-radius:6px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="font-size:14px;">🔖</span>
          <span style="font-size:13px;font-weight:600;color:#3b82f6;">Saved for Later</span>
          ${article.decisionTimeframe ? `<span style="font-size:11px;background:#3b82f6;color:#fff;padding:2px 8px;border-radius:4px;">${article.decisionTimeframe}</span>` : ''}
        </div>
        ${article.decisionReason ? `<p style="margin:0;font-size:12px;color:var(--text-secondary);">${article.decisionReason}</p>` : ''}
      </div>
    ` : '';

    articleDetailContent.innerHTML = `
      <div class="article-detail-card">
        <h3 style="margin-bottom:8px;">${safeTitle}</h3>
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">
          ${article.url ? `<a href="${article.url}" target="_blank">${domain} ↗</a> · ` : ''}
          ${new Date(article.timestamp).toLocaleDateString()}
        </p>
        <p style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">
          ${modelInfo}${lengthInfo}
        </p>
        ${tagsHtml}
        ${decisionBadge}
        <div class="action-bar" style="margin-bottom:16px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="button-secondary share-button">Share 🔗</button>
          <button class="button-secondary copy-button">Copy 📋</button>
          <button class="button-secondary kindle-button">Kindle 📚</button>
                    <button class="button-secondary localsend-button" style="background:#0284c7;color:#fff;border:none;">LocalSend 📱</button>
          <button class="button-secondary md-button">.MD 💾</button>
          <button class="button-secondary open-button">Reader 👓</button>
        </div>
        <div class="summary-box" style="background:rgba(0,0,0,0.05);padding:12px;border-left:4px solid var(--accent-glow);margin-bottom:12px;">
          <strong style="display:block;margin-bottom:8px;">🧙 AI Summary</strong>
          <div>${safeSummary}</div>
        </div>
        <div id="localInsights" style="margin-bottom:16px;"></div>
        <details style="margin-top:8px;">
          <summary style="cursor:pointer;font-weight:600;color:var(--text-secondary);">📄 Original Content</summary>
          <div style="font-size:13px;opacity:0.85;margin-top:8px;">${safeContent}</div>
        </details>
      </div>
    `;

    // On-device insights (reading level, sentiment, similar articles) load
    // asynchronously and progressively fill in — they never block the rest
    // of the detail view from rendering.
    renderLocalInsights(article, articleDetailContent.querySelector('#localInsights'));

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
        openBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const newTab = window.open();
            newTab.document.write(`
                <html><head><title>${safeTitle}</title>
                <style>body{font-family:Georgia,serif;padding:20px;max-width:800px;margin:auto;background:#f4f4f4;color:#333;line-height:1.6;}
                h2{color:#444;}img{max-width:100%;height:auto;}</style></head>
                <body><h2>Summary</h2><div>${article.summary}</div><h2>Content</h2><div>${article.content}</div></body></html>
            `);
            newTab.document.close();
        });
    }
    // Show detail, hide list and graph
    if (articleList) articleList.style.display = 'none';
    if (graphContainer) graphContainer.style.display = 'none';
    if (historyTopBar) historyTopBar.style.display = 'none';
    if (detailTopBar) detailTopBar.style.display = 'flex';
    articleDetail.style.display = 'block';
}
