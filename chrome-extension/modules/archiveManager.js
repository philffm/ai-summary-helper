// archiveManager.js
// Handles archive/history UI and logic for saved articles
import StorageManager from './storageManager.js';

let uiManagerRef = null;

export function initArchive(uiManager) {
    uiManagerRef = uiManager;
    const historyScreen = document.getElementById('historyScreen');
    if (!historyScreen) return;
    loadHistory();
    setupSearch();
}

function loadHistory() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;
    historyList.innerHTML = '<div>Loading…</div>';
    StorageManager.getLocal({ articles: [] }).then(data => {
        const articles = (data.articles || []).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        if (!articles.length) {
            historyList.innerHTML = '<div class="explanatory-card">No articles saved yet.</div>';
            return;
        }
        historyList.innerHTML = '';
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
            historyList.appendChild(card);
            card.querySelector('.delete-article-button').addEventListener('click', () => {
                if (!confirm('Delete this article?')) return;
                const updated = articles.filter((_, i) => i !== idx);
                StorageManager.setLocal({ articles: updated }, loadHistory);
            });
        });
    });
}

function setupSearch() {
    const searchInput = document.getElementById('historySearchInput');
    if (!searchInput) return;
    searchInput.addEventListener('input', () => {
        filterHistory(searchInput.value.trim());
    });
}

function filterHistory(query) {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;
    StorageManager.getLocal({ articles: [] }).then(data => {
        let articles = (data.articles || []).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        if (query) {
            const q = query.toLowerCase();
            articles = articles.filter(a =>
                (a.title && a.title.toLowerCase().includes(q)) ||
                (a.summary && stripHtml(a.summary).toLowerCase().includes(q))
            );
        }
        historyList.innerHTML = '';
        if (!articles.length) {
            historyList.innerHTML = '<div class="explanatory-card">No matching articles found.</div>';
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
            historyList.appendChild(card);
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
