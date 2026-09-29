// archiveManager.js
// Shows the podcast manager overlaid on the history screen, and restores
// the history list (owned by articleManager.js) when the user backs out.
import { renderPodcastUI } from './podcastManager.js';

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
        backBtn.onclick = async () => {
            // Show article list and search input again
            if (articleList) articleList.style.display = 'block';
            if (searchInput) searchInput.style.display = 'block';
            // Clear podcast screen content to avoid DOM conflicts
            podcastScreen.innerHTML = '';
            // podcastScreen lives inside historyScreen, so the "screen" never
            // changed - just refresh the list content via articleManager.js,
            // whose search listener is already attached once at popup startup.
            const { loadHistory } = await import('./articleManager.js');
            loadHistory();
        };
        podcastScreen.appendChild(backBtn);
        // Render podcast UI
        renderPodcastUI(podcastScreen);
        podcastScreen.style.display = 'block';
    }
}
