// mainScreen.js
// Handles main screen UI — chat-style summary feed

import StorageManager from './storageManager.js';

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

        const tags = article.tags || [];
        const tagsHtml = tags.length ? `<div class="bubble-tags">${tags.map(t => `<span class="bubble-tag">${t}</span>`).join('')}</div>` : '';
        const modelEmoji = article.connectionMode === 'cloud' ? '☁️' : '💻';
        const modelHtml = article.modelId ? `<span style="font-size:10px;opacity:0.5;margin-top:4px;display:block;">${modelEmoji} ${article.modelId}</span>` : '';
        const bubble = document.createElement('div');
        bubble.className = 'summary-bubble';
        bubble.innerHTML = `
            <div class="summary-bubble-header">
                <span class="summary-bubble-title">${title.length > 50 ? title.slice(0, 50) + '…' : title}</span>
                <span class="summary-bubble-domain">${domain} · ${date}</span>
            </div>
            <div class="summary-bubble-body">${preview}</div>
            ${tagsHtml}
            ${modelHtml}
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

    const addStreamBubble = (modelName = '', mode = 'local') => {
        // Remove any existing stream bubble
        const old = feed.querySelector('.stream-bubble');
        if (old) old.remove();

        const emoji = mode === 'cloud' ? '☁️' : '💻';
        const bubble = document.createElement('div');
        bubble.className = 'stream-bubble';
        bubble.id = 'streamBubble';
        bubble.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span class="pulse-dot"></span>
            <span id="streamText" style="font-weight:600;">Starting…</span>
            <span id="streamTimer" style="font-size:11px;opacity:0.6;margin-left:auto;"></span>
          </div>
          <div id="streamModel" style="font-size:11px;opacity:0.5;margin-bottom:4px;">${emoji} ${modelName}</div>
          <div id="streamProgressWrap" style="display:none;margin-bottom:6px;">
            <div style="height:4px;background:var(--outline, rgba(100,116,139,0.25));border-radius:999px;overflow:hidden;">
              <div id="streamProgressBar" style="height:100%;width:0%;background:var(--accent, #2563eb);border-radius:999px;transition:width 0.4s ease;"></div>
            </div>
          </div>
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

    // Update the estimated output-progress bar (0-99 while streaming).
    const updateStreamProgress = (pct) => {
        const wrap = document.getElementById('streamProgressWrap');
        const bar = document.getElementById('streamProgressBar');
        if (!wrap || !bar) return;
        if (typeof pct !== 'number' || Number.isNaN(pct) || pct <= 0) return;
        wrap.style.display = 'block';
        bar.style.width = `${Math.min(99, Math.max(0, pct))}%`;
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
            sorted.reverse();
            // Take the last 10 (newest) — if more than 10, slice from the end
            const recent = sorted.length > 10 ? sorted.slice(-10) : sorted;
            recent.forEach(addBubble);
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

    // ── Onboarding / Empty State ───────────────────────────────────────
    // If the user has no articles AND isn't authenticated with byphil Cloud
    // AND hasn't set up a custom API key, show the onboarding login mask
    // instead of a blank feed.
    const onboardingContainer = document.getElementById('mainScreenOnboarding');
    const feedScroll = document.getElementById('feedScroll');
    const controlsBar = document.querySelector('.controls-bar');

    const evaluateOnboarding = async () => {
        const data = await StorageManager.getAll();
        const hasArticles = Array.isArray(data.articles) && data.articles.length > 0;
        const isCloudAuthed = !!data.pb_token;
        const hasCustomApi = data.connectionMode === 'local'
            && !!data.servicesConfig?.[data.activeService]?.apiKey;

        const showOnboarding = !hasArticles && !isCloudAuthed && !hasCustomApi;

        if (onboardingContainer) onboardingContainer.style.display = showOnboarding ? 'flex' : 'none';
        if (feedScroll) feedScroll.style.display = showOnboarding ? 'none' : 'flex';
        // Only hide the recent-entry when onboarding is shown. When onboarding
        // is NOT shown, leave recentEntry alone — loadFeed() already controls
        // its visibility based on whether articles exist. (Setting it to ''
        // here would override loadFeed's 'none' and wrongly show the empty
        // state even when there are recent summaries.)
        if (recentEntry && showOnboarding) recentEntry.style.display = 'none';
        // Hide the input card / controls bar while onboarding is active so
        // there's no visual conflict with the login mask.
        if (controlsBar) controlsBar.style.display = showOnboarding ? 'none' : '';

        if (showOnboarding) {
            setupOnboardingExtras(ui);
        }
    };

    evaluateOnboarding();

    // The onboarding mask's email/OTP login is handled by the shared
    // authManager module (same implementation as the Settings screen).
    // Whenever auth state changes — e.g. the user finishes signing in —
    // re-evaluate whether the onboarding mask should still be shown, so we
    // can swap over to the summary feed without reloading the popup.
    document.addEventListener('aish:authStateChanged', evaluateOnboarding);

    // ── Listen for streaming relay from content script ─────────────────
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'summaryProgress') {
            updateStream(msg.chunk || 'Working on it…');
            if (msg.preview) updateStreamPreview(msg.preview);
            if (typeof msg.progress === 'number') updateStreamProgress(msg.progress);
        }
        if (msg.action === 'summaryComplete') {
            removeStreamBubble();
            // Render the new summary immediately from relayed data
            if (msg.summary) {
                addBubble({
                    title: msg.title || 'Summary',
                    url: msg.url || '',
                    summary: msg.summary,
                    timestamp: msg.timestamp || new Date().toISOString(),
                    tags: msg.tags || [],
                    modelId: msg.modelId || '',
                    connectionMode: msg.connectionMode || 'local',
                    content: msg.content || ''
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
                const chipIcon = document.querySelector('.chip[data-panel="model"] .chip-icon');
                const isCloud = chipIcon?.textContent === '☁️' || (await chrome.storage.sync.get('connectionMode')).connectionMode === 'cloud';
                
                addStreamBubble(modelLabel?.textContent || '', isCloud ? 'cloud' : 'local');
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

                // Safari opt-in model: if we don't yet have access to this site,
                // request it NOW — still within the click gesture, so Safari's
                // native "Allow on this website?" prompt is honored. This avoids
                // the silent PING timeout that happens when access was never
                // granted in the first place.
                if (!(await hasSiteAccess(activeTab.url))) {
                    const granted = await requestSiteAccess(activeTab.url);
                    if (!granted) {
                        updateStream('❌ AI Summary Helper needs permission to run on this site. Please tap "Allow" in the prompt (or enable it in Safari Settings → Extensions → AI Summary Helper).');
                        fetchSummaryButton.disabled = false;
                        fetchSummaryButton.textContent = '✨ Fetch Summary';
                        return;
                    }
                }

                await ensureContentScript(activeTab.id, activeTab.url);

                const {
                    connectionMode = 'cloud',
                    preferredCloudModel = 'google/gemini-2.5-flash'
                } = await chrome.storage.sync.get(['connectionMode', 'preferredCloudModel']);

                const message = {
                    action: 'fetchSummary',
                    additionalQuestions,
                    selectedLanguage,
                    prompt: promptToUse,
                    summaryMode: mode,
                    summaryLength: await chrome.storage.local.get('summaryLength').then(d => d.summaryLength || 200),
                    connectionMode,
                    preferredCloudModel,
                };

                chrome.tabs.sendMessage(activeTab.id, message, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn("Popup communication error:", chrome.runtime.lastError);
                        updateStream('❌ Could not reach page — try refreshing the tab.');
                        fetchSummaryButton.disabled = false;
                        fetchSummaryButton.textContent = '✨ Fetch Summary';
                    }
                });

                // Inline mode: close popup
                if (mode !== 'extension') {
                    setTimeout(() => window.close(), 100);
                }
            } catch (err) {
                console.error('Failed to communicate with tab:', err);
                // Give a clearer message for permission-related failures (e.g.
                // Safari "Ask" permission not granted for this site).
                const msg = (err && err.message) || '';
                // If ensureContentScript already surfaced a full actionable
                // permission message, don't append a redundant short hint.
                const alreadyActionable = /Safari Settings|Always Allow|Allow on this website/i.test(msg);
                const permissionHint = !alreadyActionable && /permission|not allowed|Cannot access|inject/i.test(msg)
                    ? ' — allow this extension on this site (Safari: tap the icon → Always Allow).'
                    : '';
                updateStream('❌ ' + msg + permissionHint);
                fetchSummaryButton.disabled = false;
                fetchSummaryButton.textContent = '✨ Fetch Summary';
            }
        });
    });
}

// ── Onboarding extras ────────────────────────────────────────────────
// The email/OTP login flow itself is wired once, globally, by the shared
// authManager module (see initAuthManager in popup.js / settingsManager.js)
// — it drives both the onboarding mask's inputs and the Settings screen's
// "Account Sync" panel from one implementation. All that's left for
// mainScreen.js to wire up here is the onboarding-only "use my own API"
// fallback button.
function setupOnboardingExtras(ui) {
    const customApiBtn = document.getElementById('onboardingCustomApiBtn');
    if (customApiBtn && !customApiBtn.dataset.bound) {
        customApiBtn.dataset.bound = 'true';
        customApiBtn.addEventListener('click', () => {
            if (ui && typeof ui.showScreen === 'function') ui.showScreen('settings');
        });
    }
}

// Helper to check if tab URL supports content scripts
function isInjectableUrl(url) {
  if (!url) return false;
  return !url.startsWith('chrome://') &&
         !url.startsWith('chrome-extension://') &&
         !url.startsWith('edge://') &&
         !url.startsWith('about:') &&
         !url.includes('chrome.google.com/webstore');
}

// ── Site-access permission helpers (Safari opt-in model) ─────────────
// Safari (macOS + iOS) treats website access as opt-in per site, unlike
// Chrome/Firefox which grant <all_urls> at install time. These helpers use
// the official `chrome.permissions` API to check and request access, which
// shows Safari's native "Allow on this website?" prompt.

/**
 * Check whether the extension currently has access to a given origin.
 * Returns true if the API is unavailable (falls through to injection).
 */
export function hasSiteAccess(url) {
    return new Promise((resolve) => {
        if (typeof chrome.permissions?.contains !== 'function') {
            resolve(true);
            return;
        }
        try {
            chrome.permissions.contains({ origins: [url] }, (result) => {
                if (chrome.runtime.lastError) {
                    resolve(true);
                    return;
                }
                resolve(!!result);
            });
        } catch (e) {
            resolve(true);
        }
    });
}

/**
 * Request access to a given origin via Safari's native permission prompt.
 * MUST be called from within a user gesture (e.g. a click handler) for
 * Safari/Chrome to honor it. Returns true if granted.
 */
export function requestSiteAccess(url) {
    return new Promise((resolve) => {
        if (typeof chrome.permissions?.request !== 'function') {
            resolve(false);
            return;
        }
        try {
            chrome.permissions.request({ origins: [url] }, (granted) => {
                if (chrome.runtime.lastError) {
                    resolve(false);
                    return;
                }
                resolve(!!granted);
            });
        } catch (e) {
            resolve(false);
        }
    });
}

// Helper to check if content script is loaded, or inject it if not
export async function ensureContentScript(tabId, url) {
    // Restricted Chrome URLs
    if (!isInjectableUrl(url)) {
        throw new Error('AI Summary cannot run on system pages or the Web Store.');
    }

    // Try a ping first — if it succeeds we're already good
    const ping = (id) => new Promise((resolve) => {
        chrome.tabs.sendMessage(id, { action: 'ping' }, (res) => {
            if (chrome.runtime.lastError) {
                resolve(false);
                return;
            }
            const status = (res && res.status || '').toLowerCase();
            resolve(status === 'pong');
        });
    });

    if (await ping(tabId)) return; // already loaded

    // Proactively check whether we're allowed to run scripts on this page.
    // Safari (macOS + iOS) treats website access as opt-in per site, so even
    // though the manifest requests <all_urls>, the user must grant access.
    // If not granted, both static injection AND executeScript fail closed
    // with no error surfaced — so detect it here and prompt accordingly.
    const hasAccess = await hasSiteAccess(url);

    if (!hasAccess) {
        throw new Error(
            'AI Summary Helper does not have permission to run on this site. ' +
            'Please enable it in Safari Settings → Extensions → AI Summary Helper ' +
            '→ "Allow on this website" (or "Always Allow on every website").'
        );
    }

    // Content script not present — inject it
    console.log('Injecting content script due to ping failure...');
    try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    } catch (e) {
        console.error('ExecuteScript error:', e);
        const msg = (e && e.message) || '';
        // Safari surfaces permission failures here (e.g. "This extension does
        // not have permission to run scripts on this page").
        if (/permission|not allowed|Cannot access|not permitted|denied/i.test(msg)) {
            throw new Error(
                'AI Summary Helper does not have permission to run on this site. ' +
                'Please enable it in Safari Settings → Extensions → AI Summary Helper ' +
                '→ "Allow on this website" (or "Always Allow on every website").'
            );
        }
        throw new Error('Failed to inject script: ' + msg);
    }

    // Poll with PINGs for up to ~3 seconds (30 × 100ms) to wait for content.js
    // to finish parsing and register its onMessage listener. iOS/Safari can be
    // slow to initialize a large content script, so give it more time.
    for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (await ping(tabId)) return;
    }

    throw new Error('Content script loaded but failed to respond to PING.');
}
