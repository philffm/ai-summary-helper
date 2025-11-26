import UIManager from './modules/uiManager.js';
import StorageManager from './modules/storageManager.js';
import { initArticleManager } from './modules/articleManager.js';
import { initPromptManager } from './modules/promptManager.js';
import { initSettingsManager } from './modules/settingsManager.js';
// import { initModelManager } from './modules/modelManager.js';
import { initLanguageManager } from './modules/languageManager.js';
import { initPodcastManager } from './modules/podcastManager.js';
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
    initPodcastManager(ui);
    initShortcuts(ui);
    initMainScreen();
    initArticleManager(ui);
    initAccordion(ui);

    ui.showScreen("main");
});