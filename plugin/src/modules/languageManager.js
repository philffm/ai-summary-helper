// Language Manager
// Handles language dropdown and persistence
import { LANGUAGES } from './languages.js';

export function initLanguageManager(uiManager) {
    // Find the language select element
    const languageSelect = document.getElementById('languageSelect');
    if (!languageSelect) return;

    // Populate the select element
    languageSelect.innerHTML = '';
    LANGUAGES.forEach(language => {
        const option = document.createElement('option');
        option.value = language.code;
        option.textContent = `${language.emoji} ${language.name}`;
        languageSelect.appendChild(option);
    });

    // Set the selected language from storage
    chrome.storage.sync.get('selectedLanguage', (storage) => {
        if (storage.selectedLanguage) {
            languageSelect.value = storage.selectedLanguage;
        }
        // Dispatch change so popup.js picks up the initial flag & label
        languageSelect.dispatchEvent(new Event('change'));
    });

    // Save the selected language to storage when changed
    languageSelect.addEventListener('change', () => {
        chrome.storage.sync.set({ selectedLanguage: languageSelect.value });
    });
}