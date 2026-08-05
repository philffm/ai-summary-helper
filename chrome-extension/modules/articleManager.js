// Article Manager
// Handles article rendering, expand/collapse, search, etc.


import StorageManager from './storageManager.js';

let uiManagerRef = null;
let currentDetailArticle = null;
let cachedArticles = [];

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
        await navigator.share({
            title: article.title || 'AI Summary',
            text: `Check out this summary: \n\n${article.summary}\n\nRead more at:`,
            url: article.url || ''
        });
    } catch (err) {
        console.error('Share failed:', err);
    }
}
/**
 * Generates and downloads a Markdown file with YAML Frontmatter
 */
function exportToMarkdown(article) {
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

    const mdContent = `${frontmatter}

# Summary
${summaryPlain}

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
    
    // Create a clean HTML version for the clipboard
    const cleanHtml = `
        <div style="font-family: sans-serif;">
            <h1>${title}</h1>
            <p><a href="${article.url}">${article.url}</a></p>
            <hr>
            <h2>🧙 AI Summary</h2>
            <div>${summary}</div>
            <hr>
            <h2>📄 Original Content</h2>
            <div>${content}</div>
        </div>
    `.replace(/style="[^"]*"/gi, (match) => {
        // Keep ONLY the top-level font family for the container, strip all other styles
        return match.includes('font-family: sans-serif') ? match : '';
    });

    // Create a plain text / markdown version
    const plainText = `# ${title}\nSource: ${article.url || 'N/A'}\n\n## 🧙 AI SUMMARY\n${summary.replace(/<[^>]+>/g, '').trim()}\n\n---\n\n## 📄 ORIGINAL CONTENT\n${content.replace(/<[^>]+>/g, '').trim()}`;

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
    if (!config.kindleEmail) {
        if (uiManagerRef) {
            uiManagerRef.showToast('Set your Kindle email in Settings first.');
            uiManagerRef.showScreen('settings');
        } else {
            alert('Please configure your Kindle delivery email address inside settings first.');
        }
        return;
    }

    // Show a brief hint about free tier limit
    const isPro = config.pb_user?.subscription_status === 'active';
    if (!isPro) {
        const confirmation = confirm('📚 Send to Kindle\n\nFree tier: 3 Kindle sends included.\nUpgrade to Pro for unlimited.\n\nSend this article to Kindle?');
        if (!confirmation) return;
    }

    try {
        const apiBase = StorageManager.getApiBase();
        const headers = { 'Content-Type': 'application/json' };
        if (config.pb_token) {
            headers['Authorization'] = `Bearer ${config.pb_token}`;
        } else if (config.licenseKey) {
            headers['Authorization'] = `Bearer ${config.licenseKey}`;
        }

        const response = await fetch(`${apiBase}/v1/projects/ai_summary_helper/kindle`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                kindle_email: config.kindleEmail,
                title: article.title || 'AI Summary Document',
                content: article.content || article.summary || '',
                summary: article.summary || '',
                url: article.url || ''
            })
        });

        const resData = await response.json();
        if (response.ok && resData.success) {
            if (uiManagerRef) uiManagerRef.showToast('Sent to Kindle! 📚');
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

export function initArticleManager(uiManager) {
    uiManagerRef = uiManager;
    const historyButton = document.getElementById('historyButton');
    const backButton = document.getElementById('backButton');
    const searchInput = document.getElementById('searchInput');
    const detailBackBtn = document.getElementById('detailBackButton');
    const historyTopBar = document.getElementById('historyTopBar');
    const detailTopBar = document.getElementById('detailTopBar');

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

    if (historyButton) {
        historyButton.addEventListener('click', () => {
            uiManager.showScreen('history');
            loadHistory();
        });
    }
    if (backButton) {
        backButton.addEventListener('click', () => uiManager.showScreen('main'));
    }
    if (searchInput) {
        searchInput.addEventListener('input', filterArticles);

        // Show/hide clear button as user types
        const clearBtn = document.getElementById('searchClearBtn');
        if (clearBtn) {
            searchInput.addEventListener('input', () => {
                clearBtn.hidden = searchInput.value.length === 0;
            });
            clearBtn.addEventListener('click', () => {
                searchInput.value = '';
                clearBtn.hidden = true;
                filterArticles();
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
            if (detailTopBar?.style.display === 'flex') {
                if (articleDetail) articleDetail.style.display = 'block';
            } else {
                if (articleList) articleList.style.display = 'block';
            }
        } else {
            if (articleList) articleList.style.display = 'none';
            if (articleDetail) articleDetail.style.display = 'none';
            graphContainer.style.display = 'block';
            const searchInput = document.getElementById('searchInput');
            const filterText = (searchInput?.value || '').toLowerCase();
            const articlesToShow = filterText
                ? cachedArticles.filter(a => {
                    const titleMatch = (a.title || '').toLowerCase().includes(filterText);
                    const tagMatch = (a.tags || []).some(t => t.toLowerCase().includes(filterText));
                    return titleMatch || tagMatch;
                  })
                : cachedArticles;
            const source = articlesToShow.length > 0 ? articlesToShow : cachedArticles;
            if (source.length > 0) {
                    import('./archiveGraph.js').then(mod => {
                        mod.initArchiveGraph(graphContainer, source, currentDetailArticle?.timestamp);
                    });
                } else {
                    // Fall back to storage if cache is empty (e.g. first load)
                    StorageManager.getLocal({ articles: [] }).then(data => {
                        const articles = data.articles || [];
                        if (articles.length > 0) {
                            import('./archiveGraph.js').then(mod => {
                                mod.initArchiveGraph(graphContainer, articles, currentDetailArticle?.timestamp);
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
            StorageManager.getLocal({ articles: [] }).then(data => {
                const articles = data.articles || [];
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
        graphContainer.addEventListener('open-article', (e) => {
            if (e.detail) {
                uiManager.showScreen('history');
                setTimeout(() => showArticleDetail(e.detail), 400);
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
                filterArticles();
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
    if (historyTopBar) historyTopBar.style.display = 'flex';
    if (articleList) articleList.style.display = 'block';
    StorageManager.getLocal({ articles: [] }).then(data => {
        if (data && data.articles) {
            cachedArticles = data.articles;
            renderArticles(cachedArticles);
        }
    }).catch(() => {});
}

export function renderArticles(articles) {
    const articleList = document.getElementById('articleList');
    articleList.innerHTML = '';
    if (!articles || articles.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.id = 'emptyMessage';
        emptyMessage.innerHTML = `<p>🗂️ Your archive is as empty as a desert! Start saving some articles to fill it up. 🌵</p>`;
        articleList.appendChild(emptyMessage);
        return;
    }
    const sortedArticles = articles.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    sortedArticles.forEach((article) => {
        const articleHeader = article.title || (article.content && article.content.split('\n')[0]) || "No title available";
        const listItem = document.createElement('li');
        listItem.classList.add('article-card');
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
            </div>
        `;
        articleList.appendChild(listItem);

        // Click on the card itself opens detail
        listItem.addEventListener('click', (event) => {
            if (event.target.closest('button') || event.target.closest('a')) return;
            showArticleDetail(article);
        });
    });
}

export function filterArticles() {
    const searchInput = document.getElementById('searchInput');
    const filterText = searchInput.value.toLowerCase();
    const graphContainer = document.getElementById('graphContainer');

    // If graph is visible, re-render it with matching articles
    if (graphContainer && graphContainer.style.display === 'block') {
        const filtered = cachedArticles.filter(a => {
            const titleMatch = (a.title || '').toLowerCase().includes(filterText);
            const tagMatch = (a.tags || []).some(t => t.toLowerCase().includes(filterText));
            return titleMatch || tagMatch;
        });
        import('./archiveGraph.js').then(mod => {
            mod.initArchiveGraph(graphContainer, filtered.length > 0 ? filtered : cachedArticles, currentDetailArticle?.timestamp);
        });
        // Dim the graph label when a filter is active
        graphContainer.style.opacity = filterText && filtered.length < cachedArticles.length ? '0.9' : '1';
        return;
    }

    // Otherwise filter the article list cards
    const articles = document.querySelectorAll('.article-card');
    articles.forEach(article => {
        const headerText = article.querySelector('.article-header h4').textContent.toLowerCase();
        const tagText = Array.from(article.querySelectorAll('.tag-chip'))
            .map(chip => chip.textContent.toLowerCase()).join(' ');
        const matches = headerText.includes(filterText) || tagText.includes(filterText);
        article.style.display = matches ? 'block' : 'none';
    });
}

export function displayArticleDetails(data) {
    // No longer used — detail view is now handled by showArticleDetail()
}

/**
 * Shows the full article detail view with back button
 */
export function showArticleDetail(article) {
    currentDetailArticle = article;
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

    // Convert vanilla <img> tags to stylized text placeholders inside the memory document tree
    const detailImages = detailDoc.querySelectorAll('img');
    detailImages.forEach(el => {
        const alt = el.getAttribute('alt') || 'image';
        const placeholderSpan = detailDoc.createElement('span');
        placeholderSpan.style.cssText = 'display:inline-block;background:rgba(0,0,0,0.06);padding:2px 8px;border-radius:4px;font-size:12px;font-family:monospace;margin:0 4px;';
        placeholderSpan.textContent = `🖼️ ${alt}`;
        el.parentNode.replaceChild(placeholderSpan, el);
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
          <button class="button-secondary md-button">.MD 💾</button>
          <button class="button-secondary open-button">Reader 👓</button>
          <button class="delete-button" style="margin-left:auto;">🗑️ Delete</button>
        </div>
        <div class="summary-box" style="background:rgba(0,0,0,0.05);padding:12px;border-left:4px solid var(--accent-glow);margin-bottom:16px;">
          <strong style="display:block;margin-bottom:8px;">🧙 AI Summary</strong>
          <div>${safeSummary}</div>
        </div>
        <details style="margin-top:8px;">
          <summary style="cursor:pointer;font-weight:600;color:var(--text-secondary);">📄 Original Content</summary>
          <div style="font-size:13px;opacity:0.85;margin-top:8px;">${safeContent}</div>
        </details>
      </div>
    `;

    // Wire up buttons
    const shareBtn = articleDetailContent.querySelector('.share-button');
    const copyBtn = articleDetailContent.querySelector('.copy-button');
    const kindleBtn = articleDetailContent.querySelector('.kindle-button');
    const mdBtn = articleDetailContent.querySelector('.md-button');
    const openBtn = articleDetailContent.querySelector('.open-button');
    const deleteBtn = articleDetailContent.querySelector('.delete-button');

    if (shareBtn) shareBtn.addEventListener('click', (e) => { e.stopPropagation(); shareArticle(article); });
    if (copyBtn) copyBtn.addEventListener('click', (e) => { e.stopPropagation(); copyArticleToClipboard(article); });
    if (kindleBtn) kindleBtn.addEventListener('click', (e) => { e.stopPropagation(); sendToKindle(article); });
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
    if (deleteBtn) {
        deleteBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (confirm('Are you sure you want to delete this article?')) {
                StorageManager.getLocal('articles').then(data => {
                    const articles = data.articles || [];
                    const updated = articles.filter(item => item.timestamp !== article.timestamp);
                    StorageManager.setLocal({ articles: updated }, () => {
                        renderArticles(updated);
                        articleDetail.style.display = 'none';
                        if (articleList) articleList.style.display = 'block';
                        if (historyTopBar) historyTopBar.style.display = 'flex';
                        if (detailTopBar) detailTopBar.style.display = 'none';
                    });
                });
            }
        });
    }

    // Show detail, hide list and graph
    if (articleList) articleList.style.display = 'none';
    if (graphContainer) graphContainer.style.display = 'none';
    if (historyTopBar) historyTopBar.style.display = 'none';
    if (detailTopBar) detailTopBar.style.display = 'flex';
    articleDetail.style.display = 'block';
}
