// ── Cross-browser shim ─────────────────────────────────────────────────────
// Safari/iOS Web Extensions expose ONLY the `browser.*` namespace; `chrome.*`
// is undefined there. Firefox exposes both but prefers `browser.*`. Alias
// chrome → browser so the rest of this script works unchanged on every platform.
if (typeof chrome === 'undefined' && typeof browser !== 'undefined') {
    globalThis.chrome = browser;
}

// Currently, we don't have background tasks

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

// Listen for connections from the content script for streaming fetches
chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'streamFetch') {
        port.onMessage.addListener(async (msg) => {
            if (msg.action === 'startFetch') {
                const requestId = Math.random().toString(36).slice(2, 10);
                const startedAt = Date.now();
                const controller = new AbortController();
                const timeoutMs = 120000;
                const timeoutId = setTimeout(() => {
                    controller.abort();
                }, timeoutMs);

                let heartbeatId = null;
                let chunkCount = 0;
                let byteCount = 0;

                try {
                    port.postMessage({
                        meta: 'request-started',
                        requestId,
                        url: msg.apiUrl,
                    });

                    heartbeatId = setInterval(() => {
                        port.postMessage({
                            meta: 'heartbeat',
                            requestId,
                            elapsedMs: Date.now() - startedAt,
                            chunkCount,
                            byteCount,
                        });
                    }, 3000);

                    const response = await fetch(msg.apiUrl, {
                        method: 'POST',
                        headers: msg.headers,
                        body: msg.body,
                        signal: controller.signal,
                    });

                    port.postMessage({
                        meta: 'response',
                        requestId,
                        status: response.status,
                        contentType: response.headers.get('content-type') || '',
                    });

                    if (!response.ok) {
                        if (heartbeatId) clearInterval(heartbeatId);
                        clearTimeout(timeoutId);
                        port.postMessage({ error: `HTTP ${response.status}: ${await response.text()}` });
                        return;
                    }

                    if (!response.body) {
                        if (heartbeatId) clearInterval(heartbeatId);
                        clearTimeout(timeoutId);
                        port.postMessage({ error: 'No response body received from API.' });
                        return;
                    }

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder("utf-8");

                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) {
                            if (heartbeatId) clearInterval(heartbeatId);
                            clearTimeout(timeoutId);
                            port.postMessage({
                                meta: 'stream-complete',
                                requestId,
                                elapsedMs: Date.now() - startedAt,
                                chunkCount,
                                byteCount,
                            });
                            port.postMessage({ done: true });
                            break;
                        }

                        chunkCount += 1;
                        byteCount += value?.byteLength || 0;

                        const decoded = decoder.decode(value, { stream: true });
                        if (chunkCount <= 2) {
                            port.postMessage({
                                meta: 'chunk-preview',
                                requestId,
                                chunkCount,
                                preview: decoded.slice(0, 120),
                            });
                        }

                        port.postMessage({ chunk: decoded });
                    }
                } catch (err) {
                    if (heartbeatId) clearInterval(heartbeatId);
                    clearTimeout(timeoutId);

                    const errorMessage = err?.name === 'AbortError'
                        ? `Request timed out after ${timeoutMs / 1000}s`
                        : err.message;

                    port.postMessage({ error: errorMessage });
                }
            }
        });
    }
});