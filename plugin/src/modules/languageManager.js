// Language Manager
// Handles language dropdown and persistence

export function initLanguageManager(uiManager) {
    // Find the language select element
    const languageSelect = document.getElementById('languageSelect');
    if (!languageSelect) return;

    // Hardcoded languages array
    const languages = [
        { "code": "en", "name": "English", "emoji": "🌍" },
        { "code": "cn", "name": "中文", "emoji": "🇨🇳" },
        { "code": "es", "name": "Español", "emoji": "🇪🇸" },
        { "code": "hi", "name": "हिंदी", "emoji": "🇮🇳" },
        { "code": "ar", "name": "العربية", "emoji": "🇦🇪" },
        { "code": "ind-bahasa", "name": "Bahasa Indonesia", "emoji": "🇮🇩" },
        { "code": "da", "name": "Dansk", "emoji": "🇩🇰" },
        { "code": "de", "name": "Deutsch", "emoji": "🇩🇪" },
        { "code": "tl", "name": "Filipino", "emoji": "🇵🇭" },
        { "code": "fr", "name": "Français", "emoji": "🇫🇷" },
        { "code": "it", "name": "Italiano", "emoji": "🇮🇹" },
        { "code": "sw", "name": "Kiswahili", "emoji": "🇰🇪" },
        { "code": "nl", "name": "Nederlands", "emoji": "🇳🇱" },
        { "code": "pl", "name": "Polski", "emoji": "🇵🇱" },
        { "code": "pt", "name": "Português", "emoji": "🇵🇹" },
        { "code": "ro", "name": "Română", "emoji": "🇷🇴" },
        { "code": "sv", "name": "Svenska", "emoji": "🇸🇪" },
        { "code": "vi", "name": "Tiếng Việt", "emoji": "🇻🇳" },
        { "code": "tr", "name": "Türkçe", "emoji": "🇹🇷" },
        { "code": "bg", "name": "Български", "emoji": "🇧🇬" },
        { "code": "ru", "name": "Русский", "emoji": "🇷🇺" },
        { "code": "ua", "name": "Українська", "emoji": "🇺🇦" },
        { "code": "ur", "name": "اردو", "emoji": "🇵🇰" },
        { "code": "fa", "name": "فارسی", "emoji": "🇮🇷" },
        { "code": "bn", "name": "বাংলা", "emoji": "🇧🇩" },
        { "code": "th", "name": "ไทย", "emoji": "🇹🇭" },
        { "code": "jp", "name": "日本語", "emoji": "🇯🇵" },
        { "code": "kr", "name": "한국어", "emoji": "🇰🇷" }
    ];

    // Populate the select element
    languageSelect.innerHTML = '';
    languages.forEach(language => {
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