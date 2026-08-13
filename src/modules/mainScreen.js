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
            setupOnboardingListeners(ui);
            // If a code was already requested (popup may have closed while the
            // user checked their inbox), restore the OTP step so they can type
            // the code without starting over.
            if (data.pending_otp_id) {
                const emailInput = document.getElementById('onboardingEmail');
                const sendBtn = document.getElementById('onboardingSendCodeBtn');
                const otpStep = document.getElementById('onboardingOtpStep');
                const msgBox = document.getElementById('onboardingAuthMessage');
                if (otpStep) otpStep.style.display = 'block';
                if (sendBtn) sendBtn.style.display = 'none';
                if (emailInput) {
                    emailInput.disabled = true;
                    if (data.pending_email) emailInput.value = data.pending_email;
                }
                if (msgBox) msgBox.textContent = 'Code sent! Check your inbox.';
                const otpInput = document.getElementById('onboardingOtpCode');
                if (otpInput) otpInput.focus();
            }
        }
    };

    evaluateOnboarding();

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
                const permissionHint = /permission|not allowed|Cannot access|inject/i.test(msg)
                    ? ' — allow this extension on this site (Safari: tap the icon → Always Allow).'
                    : '';
                updateStream('❌ ' + msg + permissionHint);
                fetchSummaryButton.disabled = false;
                fetchSummaryButton.textContent = '✨ Fetch Summary';
            }
        });
    });
}

// ── Onboarding listeners ─────────────────────────────────────────────
// Wires up the email/OTP auth flow and the "use my own API" fallback on
// the main-screen onboarding view. Reuses the same byphil Cloud endpoints
// as authManager.js.
function setupOnboardingListeners(ui) {
    const emailInput = document.getElementById('onboardingEmail');
    const sendBtn = document.getElementById('onboardingSendCodeBtn');
    const otpStep = document.getElementById('onboardingOtpStep');
    const otpInput = document.getElementById('onboardingOtpCode');
    const verifyBtn = document.getElementById('onboardingVerifyBtn');
    const msgBox = document.getElementById('onboardingAuthMessage');
    const customApiBtn = document.getElementById('onboardingCustomApiBtn');

    // Tertiary button → navigate to Settings
    if (customApiBtn) {
        customApiBtn.addEventListener('click', () => {
            if (ui && typeof ui.showScreen === 'function') ui.showScreen('settings');
        });
    }

    // Send OTP code
    if (sendBtn) {
        sendBtn.addEventListener('click', async () => {
            const email = emailInput.value.trim();
            if (!email) {
                msgBox.textContent = 'Please enter a valid email.';
                return;
            }
            msgBox.textContent = 'Sending code...';
            sendBtn.disabled = true;
            try {
                const response = await fetch(`${StorageManager.getApiBase()}/v1/auth/request-otp`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Failed to send code');

                await StorageManager.set({
                    pending_otp_id: result.otpId,
                    pending_email: email,
                    pending_otp_expires_at: result.otpExpiresAt,
                    pending_otp_requested_at: new Date().toISOString()
                });

                otpStep.style.display = 'block';
                sendBtn.style.display = 'none';
                emailInput.disabled = true;
                msgBox.textContent = 'Code sent! Check your inbox.';
                otpInput.focus();
            } catch (err) {
                msgBox.textContent = 'Error: ' + err.message;
            } finally {
                sendBtn.disabled = false;
            }
        });
    }

    // Verify OTP code
    if (verifyBtn) {
        verifyBtn.addEventListener('click', async () => {
            const code = otpInput.value.replace(/\s+/g, '').trim();
            if (!code) {
                msgBox.textContent = 'Please enter the verification code.';
                return;
            }
            msgBox.textContent = 'Verifying...';
            verifyBtn.disabled = true;
            try {
                const stored = await StorageManager.getAll();
                const effectiveOtpId = stored.pending_otp_id;
                if (!effectiveOtpId) throw new Error('Session lost. Please request a new code.');

                const response = await fetch(`${StorageManager.getApiBase()}/v1/auth/verify-otp`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ otpId: effectiveOtpId, code })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Invalid code');

                await StorageManager.set({
                    pb_token: result.token,
                    pb_user: result.record,
                    pending_otp_id: null,
                    pending_email: null,
                    pending_otp_expires_at: null,
                    pending_otp_requested_at: null
                });

                msgBox.textContent = 'Success!';
                // Reload UI to clear onboarding and show the main app
                setTimeout(() => window.location.reload(), 1000);
            } catch (err) {
                msgBox.textContent = 'Invalid code. Try again.';
            } finally {
                verifyBtn.disabled = false;
            }
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

    // Content script not present — inject it
    console.log('Injecting content script due to ping failure...');
    try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    } catch (e) {
        console.error('ExecuteScript error:', e);
        throw new Error('Failed to inject script: ' + e.message);
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
