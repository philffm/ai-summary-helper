// Article Manager
// Handles article rendering, expand/collapse, search, etc.


import StorageManager from './storageManager.js';

let uiManagerRef = null;

export function initArticleManager(uiManager) {
    uiManagerRef = uiManager;
    const historyButton = document.getElementById('historyButton');
    const backButton = document.getElementById('backButton');
    const historyScreen = document.getElementById('historyScreen');
    const searchInput = document.getElementById('searchInput');

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
            if (historyScreen.style.display === 'block') {
                searchInput.focus();
            }
        }
    });
}

export function loadHistory() {
    StorageManager.getLocal({ articles: [] }).then(data => {
        renderArticles(data.articles);
    });
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
        const articleHeader = article.title || article.content.split('\n')[0] || "No title available";
        const listItem = document.createElement('li');
        listItem.classList.add('article-card');
        const formattedDate = new Date(article.timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        const formattedTime = new Date(article.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        let articleDomain = '';
        if (article.url) {
            articleDomain = new URL(article.url).hostname;
        }
        listItem.innerHTML = `
            <div class="article-header">
              <div>
                <h4>${articleHeader}</h4>
                <p class="article-date">💾 ${formattedDate} ${article.url ? `from <a href="${article.url}" target="_blank">${articleDomain}</a> ↗` : ''}
              </div>
              <button class="button-secondary expand-button">Expand</button>
            </div>
            <div class="article-content" style="display: none;">
              <button class="button-secondary share-button">Share 🔗</button>
              <button class="button-secondary open-button">Read 👓</button>
              <button class="delete-button" aria-label="Delete article">🗑️</button>
              <p><strong>Description:</strong> ${article.description || 'No description available'}</p>
              <p><strong>Summary:</strong> ${article.summary || 'No summary available'}</p>
              <p><strong>Content:</strong> ${article.content || 'No content available'}</p>
            </div>
        `;
        articleList.appendChild(listItem);

        const expandButton = listItem.querySelector('.expand-button');
        const articleContent = listItem.querySelector('.article-content');
        const openButton = listItem.querySelector('.open-button');
        const shareButton = listItem.querySelector('.share-button');
        const deleteButton = listItem.querySelector('.delete-button');

        if (expandButton && articleContent) {
            expandButton.addEventListener('click', () => {
                const isVisible = articleContent.style.display === 'block';
                articleContent.style.display = isVisible ? 'none' : 'block';
                expandButton.textContent = isVisible ? 'Expand' : 'Collapse';
            });
        }
        if (openButton) {
            openButton.addEventListener('click', () => {
                const newTab = window.open();
                newTab.document.write(`
                    <html>
                      <head>
                        <title>Article Details</title>
                        <style>
                          body { font-family: 'Georgia', serif; padding: 20px; max-width: 800px; margin: auto; background-color: #f4f4f4; color: #333; line-height: 1.6; }
                          h2 { color: #444; }
                          p, pre { line-height: 1.6; }
                          pre { white-space: pre-wrap; word-wrap: break-word; }
                        </style>
                      </head>
                      <body>
                        <h2>Summary</h2>
                        <p>${article.summary}</p>
                        <h2>Content</h2>
                        <pre>${article.content}</pre>
                      </body>
                    </html>
                `);
                newTab.document.close();
            });
        }
        if (shareButton) {
            shareButton.addEventListener('click', () => {
                // TODO: Implement podcast sharing if needed
                alert('Share functionality coming soon!');
            });
        }
        if (deleteButton) {
            deleteButton.addEventListener('click', function () {
                if (confirm('Are you sure you want to delete this article?')) {
                    StorageManager.getLocal('articles').then(data => {
                        const articles = data.articles || [];
                        const updatedArticles = articles.filter((item) => item.timestamp !== article.timestamp);
                        StorageManager.setLocal({ articles: updatedArticles }, () => {
                            renderArticles(updatedArticles);
                        });
                    });
                }
            });
        }
        listItem.addEventListener('click', (event) => {
            if (!event.target.classList.contains('expand-button')) {
                const isVisible = articleContent.style.display === 'block';
                articleContent.style.display = isVisible ? 'none' : 'block';
                expandButton.textContent = isVisible ? 'Expand' : 'Collapse';
            }
        });
    });
}

export function filterArticles() {
    const searchInput = document.getElementById('searchInput');
    const filterText = searchInput.value.toLowerCase();
    const articles = document.querySelectorAll('.article-card');
    articles.forEach(article => {
        const headerText = article.querySelector('.article-header h4').textContent.toLowerCase();
        const contentText = article.querySelector('.article-content').textContent.toLowerCase();
        if (headerText.includes(filterText) || contentText.includes(filterText)) {
            article.style.display = 'block';
        } else {
            article.style.display = 'none';
        }
    });
}

export function displayArticleDetails(data) {
    const articleDetailsContainer = document.getElementById('articleDetails');
    articleDetailsContainer.innerHTML = `
      <h3>Article Details</h3>
      <p><strong>Title:</strong> ${data.title || 'No title available'}</p>
      <p><strong>Description:</strong> ${data.description || 'No description available'}</p>
      <p><strong>URL:</strong> <a href="${data.url}" target="_blank">${data.url}</a></p>
    `;
}
