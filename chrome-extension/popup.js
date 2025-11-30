import UIManager from './modules/uiManager.js';
import StorageManager from './modules/storageManager.js';
import { initArticleManager } from './modules/articleManager.js';
import { initPromptManager } from './modules/promptManager.js';
import { initSettingsManager } from './modules/settingsManager.js';
// import { initModelManager } from './modules/modelManager.js';
import { initLanguageManager } from './modules/languageManager.js';
// import { initPodcastManager } from './modules/podcastManager.js';
// Use window.initPodcastManager if needed
import { initShortcuts } from './modules/shortcuts.js';
import { initMainScreen } from './modules/mainScreen.js';
import { initToolsManager } from './modules/toolsManager.js';
import { initAccordion } from './modules/accordion.js';

document.addEventListener("DOMContentLoaded", async () => {
    const ui = new UIManager();

    StorageManager.initializeDefaults();

    // initModelManager(ui); // Not exported from modelManager.js
    initPromptManager(ui);
    initSettingsManager(ui);
    initLanguageManager(ui);
    initToolsManager(ui);
    if (window.initPodcastManager) {
        window.initPodcastManager(ui);
    }
    initShortcuts(ui);
    initMainScreen();
    initArticleManager(ui);
    initAccordion(ui);

    ui.showScreen("main");

    // Podcast button in history screen triggers podcast manager in history view
    const podcastButton = document.getElementById('podcastButton');
    if (podcastButton) {
        podcastButton.addEventListener('click', () => {
            ui.enterPodcastMenu();
        });
    }

    // Utility to handle summarize button error state
    function showSummarizeError() {
        const summarizeBtn = document.getElementById('summarizeButton');
        if (summarizeBtn) {
            summarizeBtn.style.backgroundColor = 'red';
            summarizeBtn.textContent = 'Try again later';
        }
    }

    // Example: Wrap your message sending logic with error handling
    function sendMessageToContentScript(message, callback) {
        try {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    showSummarizeError();
                    return;
                }
                if (callback) callback(response);
            });
        } catch (e) {
            showSummarizeError();
        }
    }

    // Wherever you send a message to the background/content script, use sendMessageToContentScript
    // Example usage:
    // sendMessageToContentScript({ action: 'summarize' }, (response) => { /* handle response */ });
});