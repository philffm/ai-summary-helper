// Currently, we don't have background tasks

// Sync side panel behavior with user setting
function updateSidePanelBehavior(useNative) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: !!useNative })
        .catch(err => console.error('[sidePanel] setPanelBehavior:', err));
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

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'openNativeSidePanel') {
        chrome.windows.getCurrent({}, (win) => {
            chrome.sidePanel.open({ windowId: win.id })
                .then(() => sendResponse({ success: true }))
                .catch(err => sendResponse({ error: err.message }));
        });
        return true; // keep channel open for async response
    }
});

// Listen for connections from the content script for streaming fetches
chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'streamFetch') {
        port.onMessage.addListener(async (msg) => {
            if (msg.action === 'startFetch') {
                try {
                    const response = await fetch(msg.apiUrl, {
                        method: 'POST',
                        headers: msg.headers,
                        body: msg.body
                    });

                    if (!response.ok) {
                        port.postMessage({ error: `HTTP ${response.status}: ${await response.text()}` });
                        return;
                    }

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder("utf-8");

                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) {
                            port.postMessage({ done: true });
                            break;
                        }
                        port.postMessage({ chunk: decoder.decode(value, { stream: true }) });
                    }
                } catch (err) {
                    port.postMessage({ error: err.message });
                }
            }
        });
    }
});
