// ── Cross-browser shim ─────────────────────────────────────────────────────
// Safari/iOS Web Extensions expose ONLY the `browser.*` namespace; `chrome.*`
// is undefined there. Firefox exposes both but prefers `browser.*`. Alias
// chrome → browser so the rest of this script works unchanged on every platform.
if (typeof chrome === 'undefined' && typeof browser !== 'undefined') {
    globalThis.chrome = browser;
}

// Currently, we don't have background tasks

// Convert an ArrayBuffer to a base64 string in chunks — avoids blowing the
// call stack on large images (String.fromCharCode.apply on a huge array
// throws "Maximum call stack size exceeded").
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

// ── Context Menu ─────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({ id: 'aish-highlight',        title: '✏️ Highlight selection',    contexts: ['selection'] });
        chrome.contextMenus.create({ id: 'aish-clear-highlights', title: '🧹 Remove all highlights',  contexts: ['page', 'selection'] });
        chrome.contextMenus.create({ id: 'sep1', type: 'separator',                                   contexts: ['page', 'selection'] });
        chrome.contextMenus.create({ id: 'aish-summarize',        title: '✨ Summarize this page',    contexts: ['page'] });
        chrome.contextMenus.create({ id: 'aish-summarize-close',  title: '✨ Summarize & close tab',  contexts: ['page'] });
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;
    if (info.menuItemId === 'aish-highlight') {
        chrome.tabs.sendMessage(tab.id, { action: 'contextMenuHighlight', text: info.selectionText }).catch(() => {});
    } else if (info.menuItemId === 'aish-clear-highlights') {
        chrome.tabs.sendMessage(tab.id, { action: 'contextMenuClearHighlights' }).catch(() => {});
    } else if (info.menuItemId === 'aish-summarize') {
        chrome.tabs.sendMessage(tab.id, { action: 'fetchSummary', summaryMode: 'extension' }).catch(() => {});
    } else if (info.menuItemId === 'aish-summarize-close') {
        chrome.tabs.sendMessage(tab.id, { action: 'fetchSummaryAndClose', summaryMode: 'extension' }).catch(() => {});
    }
});

// ── Decision Alarms ───────────────────────────────────────────────────────────
function decisionAlarmDelayMinutes(timeframe) {
    const now = new Date();
    switch (timeframe) {
        case 'tomorrow': return 24 * 60;
        case 'weekend': {
            const daysUntilSat = (6 - now.getDay() + 7) % 7 || 7;
            return daysUntilSat * 24 * 60;
        }
        case 'week':    return 7 * 24 * 60;
        default:        return null; // 'research' — no alarm, surface in UI
    }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (!alarm.name.startsWith('decision_')) return;
    const timestamp = alarm.name.replace('decision_', '');
    const { articles = [] } = await chrome.storage.local.get({ articles: [] });
    const article = articles.find(a => a.timestamp === decodeURIComponent(timestamp) && a.isDecision);
    if (!article) return;
    chrome.notifications.create(`decision_notif_${timestamp}`, {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: '🔖 Ready to review?',
        message: article.title || article.url,
        contextMessage: article.decisionReason || '',
        buttons: [{ title: 'Open' }, { title: 'Dismiss' }],
        requireInteraction: true
    });
});

chrome.notifications.onButtonClicked.addListener(async (notifId, btnIdx) => {
    if (!notifId.startsWith('decision_notif_')) return;
    const timestamp = notifId.replace('decision_notif_', '');
    const { articles = [] } = await chrome.storage.local.get({ articles: [] });
    const article = articles.find(a => a.timestamp === decodeURIComponent(timestamp) && a.isDecision);
    if (!article) return;
    if (btnIdx === 0 && article.url) chrome.tabs.create({ url: article.url });
    chrome.notifications.clear(notifId);
});

// Sync side panel behavior with user setting
function updateSidePanelBehavior(useNative) {
    try {
        chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: !!useNative });
    } catch (e) {
        // Silently ignore if sidePanel API is unavailable
    }
}

// Initialize on startup
chrome.storage.sync.get('useNativeSidePanel', (data) => {
    updateSidePanelBehavior(data.useNativeSidePanel);
});

// React to setting changes in real time
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.useNativeSidePanel) {
        updateSidePanelBehavior(changes.useNativeSidePanel.newValue);
    }
});

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Dummy endpoint to force Safari to wake the background script before a
    // long-lived connection is attempted. Safari reliably wakes workers for
    // runtime.sendMessage, but may fail a runtime.connect() while asleep.
    if (msg.action === 'wakeup') {
        sendResponse({ status: 'awake' });
        return true; // Keep the message channel open for the response
    }

    if (msg.action === 'sendLocalSendP2P') {
        const method = msg.method || 'POST';
        const isJson = msg.isJson !== false;
        const headers = msg.headers || {
            'Content-Type': isJson ? 'application/json' : 'application/octet-stream'
        };
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        let body = msg.body;
        if (isJson) {
            body = typeof body === 'string' ? body : JSON.stringify(body);
        } else if (Array.isArray(body)) {
            // Reconstruct byte payload sent as number array through runtime messaging.
            body = new Uint8Array(body).buffer;
        }

        fetch(msg.targetUrl, {
            method,
            headers,
            body: method === 'GET' || method === 'HEAD' ? undefined : body,
            signal: controller.signal
        })
            .then(async (res) => {
                clearTimeout(timeout);
                const text = await res.text();
                let data = null;
                try {
                    data = text ? JSON.parse(text) : null;
                } catch (_) {
                    data = null;
                }

                sendResponse({
                    success: true,
                    ok: res.ok,
                    status: res.status,
                    data,
                    text
                });
            })
            .catch((err) => {
                clearTimeout(timeout);
                sendResponse({ success: false, error: err?.message || 'Network request failed' });
            });

        return true;
    }

    if (msg.action === 'openNativeSidePanel') {
        // Native side panel is Chrome-only. On Firefox/Safari/iOS the
        // `sidePanel` API is undefined — fall back to the hybrid sidebar.
        if (!chrome.sidePanel) {
            sendResponse({ success: false, error: 'sidePanel API not available' });
            return;
        }
        // Use sender.tab.windowId to target the correct window
        const windowId = sender?.tab?.windowId;
        if (windowId) {
            chrome.sidePanel.open({ windowId })
                .then(() => sendResponse({ success: true }))
                .catch(err => sendResponse({ error: err.message }));
        } else {
            // Fallback: try all windows
            chrome.windows.getAll({}, (windows) => {
                if (windows.length > 0) {
                    chrome.sidePanel.open({ windowId: windows[0].id })
                        .then(() => sendResponse({ success: true }))
                        .catch(err => sendResponse({ error: err.message }));
                }
            });
        }
        return true;
    }

    // Close the tab after "Summarize & Close" completes
    if (msg.action === 'closeTabSelf' && sender.tab) {
        chrome.tabs.remove(sender.tab.id);
        return true;
    }

    // Schedule an alarm for a decision slip (article with embedded decision metadata)
    if (msg.action === 'scheduleDecisionAlarm' && msg.article) {
        const timeframe = msg.article.decisionTimeframe;
        const delayMins = decisionAlarmDelayMinutes(timeframe);
        if (delayMins) {
            // Use encoded timestamp as alarm name to uniquely identify the article
            chrome.alarms.create(`decision_${encodeURIComponent(msg.article.timestamp)}`, { delayInMinutes: delayMins });
        }
        return true;
    }

    // Fetch a (possibly cross-origin / http:// on an https:// page) image
    // on behalf of a content script and return it as a data URL. Content
    // scripts must not fetch() third-party images directly — Safari applies
    // the *page's* CORS/mixed-content rules to content-script fetches
    // regardless of the extension's host_permissions, unlike Chrome. The
    // background page is a genuine privileged context, so it can fetch
    // cross-origin freely.
    if (msg.action === 'fetchImageAsDataUrl' && msg.url) {
        (async () => {
            try {
                const res = await fetch(msg.url);
                if (!res.ok) {
                    sendResponse({ success: false, error: `HTTP ${res.status}` });
                    return;
                }
                const contentType = res.headers.get('content-type') || 'image/jpeg';
                const buf = await res.arrayBuffer();
                const dataUrl = `data:${contentType};base64,${arrayBufferToBase64(buf)}`;
                sendResponse({ success: true, dataUrl });
            } catch (err) {
                sendResponse({ success: false, error: err?.message || 'Image fetch failed' });
            }
        })();
        return true;
    }

    // Start a streaming fetch — message-based (not runtime.connect/ports).
    // Safari's background page is a non-persistent event page, and it does
    // NOT reliably re-register onConnect listeners after being suspended and
    // woken back up — content scripts calling runtime.connect() at that
    // moment get "No runtime.onConnect listeners found" even after a wakeup
    // ping + retries. runtime.sendMessage / tabs.sendMessage do not have
    // this problem, so we push each chunk back to the tab individually
    // instead of relying on a long-lived port.
    if (msg.action === 'startFetch' && msg.requestId) {
        // Fallback: Safari sometimes omits sender.tab.id in
        // chrome.runtime.onMessage for content scripts. If it's missing,
        // resolve the active tab so we can push chunks back to it.
        const handleStart = async () => {
            let tabId = sender?.tab?.id;
            if (tabId == null) {
                const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                tabId = activeTab?.id;
            }

            if (tabId == null) {
                console.error('[AISH Background] No active tab found for startFetch');
                return;
            }

            handleStreamFetch(msg, tabId);
        };

        handleStart();
        // Respond synchronously WITHOUT return true, so the handshake is
        // acknowledged immediately. In Safari, an async sendResponse paired
        // with `return true` can close the message port pre-emptively and
        // surface "The message port closed before a response was received".
        sendResponse({ started: true });
        return false;
    }
});

chrome.commands.onCommand.addListener((command) => {
    console.log(`Command received: ${command}`);
    if (command === 'toggle-popup') {
        chrome.action.openPopup();
    } else if (command === 'fetch-summary') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'fetchSummary' });
        });
    }
});

// Performs the streaming fetch on behalf of the content script and pushes
// each chunk back via chrome.tabs.sendMessage (see comment above for why
// this replaces the old runtime.connect()-based approach).
async function handleStreamFetch(msg, tabId) {
    const { requestId, apiUrl, headers, body } = msg;
    const push = (payload) => chrome.tabs.sendMessage(tabId, { action: 'streamChunk', requestId, payload }).catch(() => {});

    const startedAt = Date.now();
    const controller = new AbortController();

    // Activity-based timeout: resets on every received chunk. This prevents
    // long-running streams (e.g. Ollama thinking models like qwen3:8b) from
    // being killed just because the overall request exceeds a fixed
    // wall-clock limit — as long as output keeps flowing, the request stays
    // alive. We only abort if the stream is truly idle for IDLE_TIMEOUT_MS.
    const IDLE_TIMEOUT_MS = 120000;
    let timeoutId = null;
    const armTimeout = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
    };
    const clearTimeoutHandle = () => {
        if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
    };

    let heartbeatId = null;
    let chunkCount = 0;
    let byteCount = 0;

    try {
        push({ meta: 'request-started', requestId, url: apiUrl });

        heartbeatId = setInterval(() => {
            push({ meta: 'heartbeat', requestId, elapsedMs: Date.now() - startedAt, chunkCount, byteCount });
        }, 3000);

        // Start the idle timeout (aborts only if no data arrives).
        armTimeout();

        const response = await fetch(apiUrl, { method: 'POST', headers, body, signal: controller.signal });

        push({ meta: 'response', requestId, status: response.status, contentType: response.headers.get('content-type') || '' });

        if (!response.ok) {
            if (heartbeatId) clearInterval(heartbeatId);
            clearTimeoutHandle();
            push({ error: `HTTP ${response.status}: ${await response.text()}` });
            return;
        }

        if (!response.body) {
            if (heartbeatId) clearInterval(heartbeatId);
            clearTimeoutHandle();
            push({ error: 'No response body received from API.' });
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');

        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                if (heartbeatId) clearInterval(heartbeatId);
                clearTimeoutHandle();
                push({ meta: 'stream-complete', requestId, elapsedMs: Date.now() - startedAt, chunkCount, byteCount });
                push({ done: true });
                break;
            }

            chunkCount += 1;
            byteCount += value?.byteLength || 0;

            const decoded = decoder.decode(value, { stream: true });
            if (chunkCount <= 2) {
                push({ meta: 'chunk-preview', requestId, chunkCount, preview: decoded.slice(0, 120) });
            }

            push({ chunk: decoded });
            armTimeout();
        }
    } catch (err) {
        if (heartbeatId) clearInterval(heartbeatId);
        clearTimeoutHandle();
        const errorMessage = err?.name === 'AbortError'
            ? `Request timed out after ${IDLE_TIMEOUT_MS / 1000}s of inactivity`
            : err.message;
        push({ error: errorMessage });
    }
}