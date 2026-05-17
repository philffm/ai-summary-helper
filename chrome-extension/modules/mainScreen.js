// mainScreen.js
// Handles main screen UI — chat-style summary feed

export function initMainScreen(ui) {
    const fetchSummaryButton = document.getElementById('fetchSummary');
    const additionalQuestionsInput = document.getElementById('additionalQuestions');
    const languageSelect = document.getElementById('languageSelect');
    const recentEntry = document.getElementById('recentEntry');
    const recentTitle = document.getElementById('recentTitle');
    const recentMeta = document.getElementById('recentMeta');
    const feed = document.getElementById('summaryFeed');

    if (!fetchSummaryButton) return;

    // ── Helpers ─────────────────────────────────────────────────────────
    const getDomain = (url) => {
        try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; }
    };

    const addBubble = (article) => {
        const title = article.title || article.content?.split('\n')[0] || 'Summary';
        const domain = article.url ? getDomain(article.url) : '';
        // Strip <img> tags from AI-generated HTML to prevent 404s on relative paths
        const summaryHtml = (article.summary || '').replace(/<img[^>]*>/gi, '');
        // Plain text preview: strip all HTML tags and truncate to 100 chars
        const textOnly = summaryHtml.replace(/<[^>]+>/g, '').trim();
        const preview = textOnly.length > 100 ? textOnly.slice(0, 100) + '…' : textOnly;
        const date = article.timestamp ? new Date(article.timestamp).toLocaleDateString() : '';

        const bubble = document.createElement('div');
        bubble.className = 'summary-bubble';
        bubble.innerHTML = `
            <div class="summary-bubble-header">
                <span class="summary-bubble-title">${title.length > 50 ? title.slice(0, 50) + '…' : title}</span>
                <span class="summary-bubble-domain">${domain} · ${date}</span>
            </div>
            <div class="summary-bubble-body">${preview}</div>
        `;
        // Click to open in history
        bubble.style.cursor = 'pointer';
        bubble.addEventListener('click', async () => {
            if (ui && typeof ui.showScreen === 'function') {
                ui.showScreen('history');
                // Small delay to let the screen slide in before rendering detail
                setTimeout(() => {
                    import('./articleManager.js').then(mod => mod.showArticleDetail(article));
                }, 400);
            }
        });
        feed.appendChild(bubble);
    };

    const addStreamBubble = (modelName = '') => {
        // Remove any existing stream bubble
        const old = feed.querySelector('.stream-bubble');
        if (old) old.remove();

        const bubble = document.createElement('div');
        bubble.className = 'stream-bubble';
        bubble.id = 'streamBubble';
        bubble.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span class="pulse-dot"></span>
            <span id="streamText" style="font-weight:600;">Starting…</span>
            <span id="streamTimer" style="font-size:11px;opacity:0.6;margin-left:auto;"></span>
          </div>
          <div id="streamModel" style="font-size:11px;opacity:0.5;margin-bottom:4px;">${modelName}</div>
          <div id="streamPreview" style="font-size:12px;opacity:0.7;line-height:1.5;max-height:80px;overflow:hidden;"></div>
        `;
        feed.appendChild(bubble);
        // Scroll to show the stream bubble
        requestAnimationFrame(() => {
            const scrollEl = document.getElementById('feedScroll');
            if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
        });
        // Start elapsed timer
        if (window._streamTimer) clearInterval(window._streamTimer);
        const start = Date.now();
        window._streamTimer = setInterval(() => {
            const el = document.getElementById('streamTimer');
            if (el) {
                const sec = Math.floor((Date.now() - start) / 1000);
                el.textContent = `${sec}s`;
            }
        }, 1000);
        return bubble;
    };

    const updateStream = (text) => {
        const el = document.getElementById('streamText');
        if (el) el.textContent = text;
    };

    const updateStreamPreview = (text) => {
        const el = document.getElementById('streamPreview');
        if (el && text) {
            const plain = text.replace(/<[^>]+>/g, '').trim();
            // Show the last ~200 chars so new content keeps appearing
            const snippet = plain.length > 200 ? '…' + plain.slice(-200) : plain;
            el.textContent = snippet;
        }
    };

    const removeStreamBubble = () => {
        const el = document.getElementById('streamBubble');
        if (el) el.remove();
        if (window._streamTimer) {
            clearInterval(window._streamTimer);
            window._streamTimer = null;
        }
    };

    const loadFeed = async () => {
        const { articles } = await chrome.storage.local.get({ articles: [] });
        feed.innerHTML = '';
        if (articles && articles.length > 0) {
            if (recentEntry) recentEntry.style.display = 'none';
            const sorted = articles.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            // Reverse so oldest is first, newest at bottom (scroll targets it)
            sorted.reverse().slice(0, 10).forEach(addBubble);
            // Scroll to newest (bottom of feed)
            requestAnimationFrame(() => {
                const scrollEl = document.getElementById('feedScroll');
                if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
            });
        } else {
            if (recentEntry) recentEntry.style.display = 'flex';
            if (recentTitle) recentTitle.textContent = 'No recent summaries';
            if (recentMeta) recentMeta.textContent = 'Summarize a page to see it here';
        }
    };

    // ── Click welcome entry to jump to history ─────────────────────────
    if (recentEntry) {
        recentEntry.addEventListener('click', () => {
            if (ui && typeof ui.showScreen === 'function') ui.showScreen('history');
        });
        recentEntry.style.cursor = 'pointer';
    }

    // ── Load feed on init ──────────────────────────────────────────────
    loadFeed();

    // ── Listen for streaming relay from content script ─────────────────
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'summaryProgress') {
            updateStream(msg.chunk || 'Working on it…');
            if (msg.preview) updateStreamPreview(msg.preview);
        }
        if (msg.action === 'summaryComplete') {
            removeStreamBubble();
            // Render the new summary immediately from relayed data
            if (msg.summary) {
                addBubble({
                    title: msg.title || 'Summary',
                    url: msg.url || '',
                    summary: msg.summary,
                    timestamp: msg.timestamp || new Date().toISOString()
                });
            }
            if (fetchSummaryButton) {
                fetchSummaryButton.disabled = false;
                fetchSummaryButton.textContent = '✨ Fetch Summary';
            }
        }
        if (msg.action === 'summaryError') {
            updateStream('❌ ' + (msg.error || 'Something went wrong'));
            if (fetchSummaryButton) {
                setTimeout(() => {
                    fetchSummaryButton.disabled = false;
                    fetchSummaryButton.textContent = '✨ Fetch Summary';
                    removeStreamBubble();
                }, 3000);
            }
        }
    });

    // ── Fetch button ────────────────────────────────────────────────────
    fetchSummaryButton.addEventListener('click', async () => {
        const additionalQuestions = additionalQuestionsInput.value;
        const selectedLanguage = languageSelect.value;

        chrome.storage.sync.get(['prompt', 'promptType', 'presetPrompt'], async (data) => {
            let promptToUse = data.prompt || '';

            const { summaryMode } = await chrome.storage.local.get('summaryMode');
            const mode = summaryMode || 'extension';

            fetchSummaryButton.disabled = true;
            fetchSummaryButton.textContent = '⏳ Summarizing…';

            if (mode === 'extension') {
                // Show the streaming bubble and hide the welcome entry
                if (recentEntry) recentEntry.style.display = 'none';
                const modelLabel = document.getElementById('chipModelLabel');
                addStreamBubble(modelLabel?.textContent || '');
                updateStream('Contacting content script…');
            }

            try {
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                const activeTab = tabs[0];
                if (!activeTab) {
                    updateStream('❌ No active tab found');
                    fetchSummaryButton.disabled = false;
                    fetchSummaryButton.textContent = '✨ Fetch Summary';
                    return;
                }

                await ensureContentScript(activeTab.id, activeTab.url);

                const message = {
                    action: 'fetchSummary',
                    additionalQuestions,
                    selectedLanguage,
                    prompt: promptToUse,
                    summaryMode: mode
                };

                chrome.tabs.sendMessage(activeTab.id, message, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn("Popup communication error:", chrome.runtime.lastError);
                    }
                });

                // Inline mode: close popup
                if (mode !== 'extension') {
                    setTimeout(() => window.close(), 100);
                }
            } catch (err) {
                console.error('Failed to communicate with tab:', err);
                updateStream('❌ ' + err.message);
                fetchSummaryButton.disabled = false;
                fetchSummaryButton.textContent = '✨ Fetch Summary';
            }
        });
    });
}

// Helper to check if content script is loaded, or inject it if not
export async function ensureContentScript(tabId, url) {
    // Restricted Chrome URLs
    if (url && (url.startsWith('chrome://') || url.startsWith('https://chrome.google.com/webstore'))) {
        throw new Error('AI Summary cannot run on system pages or the Web Store.');
    }

    try {
        // Ping the content script
        await chrome.tabs.sendMessage(tabId, { action: 'PING' });
    } catch (e) {
        // If ping fails, inject
        console.log("Injecting content script due to ping failure...");
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js']
        });
        // Give it a moment to initialize listeners
        await new Promise(resolve => setTimeout(resolve, 250));
    }
}
