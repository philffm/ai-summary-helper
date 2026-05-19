// Article Manager
// Handles article rendering, expand/collapse, search, etc.


import StorageManager from './storageManager.js';

let uiManagerRef = null;

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
            if (articleDetail) articleDetail.style.display = 'none';
            if (graphContainer) graphContainer.style.display = 'none';
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
            StorageManager.getLocal({ articles: [] }).then(data => {
                const articles = data.articles || [];
                if (articles.length > 0) {
                    import('./archiveGraph.js').then(mod => {
                        mod.initArchiveGraph(graphContainer, articles);
                    });
                } else {
                    graphContainer.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">No articles to graph yet.</div>';
                }
            });
        }
    };

    const graphToggleBtn = document.getElementById('graphToggleBtn');
    const detailGraphToggleBtn = document.getElementById('detailGraphToggleBtn');
    if (graphToggleBtn) graphToggleBtn.addEventListener('click', toggleGraph);
    if (detailGraphToggleBtn) detailGraphToggleBtn.addEventListener('click', toggleGraph);

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
}

export function loadHistory() {
    const graphContainer = document.getElementById('graphContainer');
    const articleList = document.getElementById('articleList');
    const articleDetail = document.getElementById('articleDetail');
    const historyTopBar = document.getElementById('historyTopBar');
    const detailTopBar = document.getElementById('detailTopBar');
    if (graphContainer) graphContainer.style.display = 'none';
    if (articleDetail) articleDetail.style.display = 'none';
    if (detailTopBar) detailTopBar.style.display = 'none';
    if (historyTopBar) historyTopBar.style.display = 'flex';
    if (articleList) articleList.style.display = 'block';
    StorageManager.getLocal({ articles: [] }).then(data => {
        if (data && data.articles) renderArticles(data.articles);
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
        const modelBadge = article.modelId ? `<span style="font-size:10px;opacity:0.5;display:inline-block;margin-top:4px;">🤖 ${article.modelId}</span>` : '';
        listItem.innerHTML = `
            <div class="article-header">
              <div>
                <h4>${articleHeader}</h4>
                <p class="article-date">💾 ${formattedDate} ${article.url ? `from <a href="${article.url}" target="_blank">${articleDomain}</a> ↗` : ''}</p>
                ${tagsHtml}
                ${modelBadge}
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
    const articles = document.querySelectorAll('.article-card');
    articles.forEach(article => {
        const headerText = article.querySelector('.article-header h4').textContent.toLowerCase();
        const matches = headerText.includes(filterText);
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
    const modelInfo = article.modelId ? `<span style="font-size:11px;color:var(--text-muted);display:inline-block;margin-right:12px;">🤖 ${article.modelId}</span>` : '';
    const lengthInfo = article.summaryLength ? `<span style="font-size:11px;color:var(--text-muted);display:inline-block;">📏 ${article.summaryLength}w</span>` : '';

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
        <div class="action-bar" style="margin-bottom:16px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="button-secondary share-button">Share 🔗</button>
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
    const mdBtn = articleDetailContent.querySelector('.md-button');
    const openBtn = articleDetailContent.querySelector('.open-button');
    const deleteBtn = articleDetailContent.querySelector('.delete-button');

    if (shareBtn) shareBtn.addEventListener('click', (e) => { e.stopPropagation(); shareArticle(article); });
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
