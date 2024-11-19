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
