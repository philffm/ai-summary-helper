// archiveManager.js
// Handles archive/history UI and logic for saved articles
import StorageManager from './storageManager.js';
import { renderPodcastUI } from './podcastManager.js';

let uiManagerRef = null;

// Show podcast manager in history view
export function showPodcastManagerInHistory() {
    const podcastScreen = document.getElementById('podcastScreen');
    const articleList = document.getElementById('articleList');
    const searchInput = document.getElementById('searchInput');
    if (podcastScreen) {
        // Hide history content
        if (articleList) articleList.style.display = 'none';
        if (searchInput) searchInput.style.display = 'none';
        podcastScreen.innerHTML = '';
        // Add back button
        const backBtn = document.createElement('button');
        backBtn.textContent = '← Back to History';
        backBtn.className = 'button-secondary';
        backBtn.style.marginBottom = '1em';
        backBtn.onclick = () => {
            podcastScreen.style.display = 'none';
            if (articleList) articleList.style.display = 'block';
            if (searchInput) searchInput.style.display = 'block';
        };
        podcastScreen.appendChild(backBtn);
        // Render podcast UI
        renderPodcastUI(podcastScreen);
        podcastScreen.style.display = 'block';
    }
}

export function initArchive(uiManager) {
    uiManagerRef = uiManager;
    const historyScreen = document.getElementById('historyScreen');
    if (!historyScreen) return;
    loadHistory();
    setupSearch();
}

function loadHistory() {
    const articleList = document.getElementById('articleList');
    if (!articleList) return;
    articleList.innerHTML = '<div>Loading…</div>';
    StorageManager.getLocal({ articles: [] }).then(data => {
        const articles = (data.articles || []).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        if (!articles.length) {
            articleList.innerHTML = '<div class="explanatory-card">No articles saved yet.</div>';
            return;
        }
        articleList.innerHTML = '';
        articles.forEach((article, idx) => {
            const card = document.createElement('div');
            card.className = 'history-card';
            card.innerHTML = `
                <div class="history-card-content">
                    <h3>${article.title || 'Untitled'}</h3>
                    <div class="history-card-meta">${new Date(article.timestamp).toLocaleString()}${article.url ? ` · ${new URL(article.url).hostname}` : ''}</div>
                    <div class="history-card-summary">${stripHtml(article.summary || '')}</div>
                    <button class="delete-article-button">Delete</button>
                </div>
            `;
            articleList.appendChild(card);
            card.querySelector('.delete-article-button').addEventListener('click', () => {
                if (!confirm('Delete this article?')) return;
                const updated = articles.filter((_, i) => i !== idx);
                StorageManager.setLocal({ articles: updated }, loadHistory);
            });
        });
    });
}

function setupSearch() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;
    searchInput.addEventListener('input', () => {
        filterHistory(searchInput.value.trim());
    });
}

function filterHistory(query) {
    const articleList = document.getElementById('articleList');
    if (!articleList) return;
    StorageManager.getLocal({ articles: [] }).then(data => {
        let articles = (data.articles || []).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        if (query) {
            const q = query.toLowerCase();
            articles = articles.filter(a =>
                (a.title && a.title.toLowerCase().includes(q)) ||
                (a.summary && stripHtml(a.summary).toLowerCase().includes(q))
            );
        }
        articleList.innerHTML = '';
        if (!articles.length) {
            articleList.innerHTML = '<div class="explanatory-card">No matching articles found.</div>';
            return;
        }
        articles.forEach((article, idx) => {
            const card = document.createElement('div');
            card.className = 'history-card';
            card.innerHTML = `
                <div class="history-card-content">
                    <h3>${article.title || 'Untitled'}</h3>
                    <div class="history-card-meta">${new Date(article.timestamp).toLocaleString()}${article.url ? ` · ${new URL(article.url).hostname}` : ''}</div>
                    <div class="history-card-summary">${stripHtml(article.summary || '')}</div>
                    <button class="delete-article-button">Delete</button>
                </div>
            `;
            articleList.appendChild(card);
            card.querySelector('.delete-article-button').addEventListener('click', () => {
                if (!confirm('Delete this article?')) return;
                const updated = articles.filter((_, i) => i !== idx);
                StorageManager.setLocal({ articles: updated }, () => filterHistory(query));
            });
        });
    });
}

function stripHtml(html = '') {
    const tmp = document.createElement('DIV');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
}
