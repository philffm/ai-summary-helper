// Currently, we don't have background tasks

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
