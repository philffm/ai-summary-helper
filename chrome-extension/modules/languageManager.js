// Language Manager
// Handles language dropdown and persistence

export function initLanguageManager(uiManager) {
    // Find the language select element
    const languageSelect = document.getElementById('languageSelect');
    if (!languageSelect) return;

    // Load languages from translations.json
    fetch('translations.json')
        .then(response => response.json())
        .then(data => {
            languageSelect.innerHTML = '';
            data.languages.forEach(language => {
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
            });
        })
        .catch(error => console.error('Error loading languages:', error));

    // Save the selected language to storage when changed
    languageSelect.addEventListener('change', () => {
        chrome.storage.sync.set({ selectedLanguage: languageSelect.value });
    });
}
