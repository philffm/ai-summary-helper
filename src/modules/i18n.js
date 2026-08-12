// i18n.js
// Translation loader — fetches messages.json and applies data-i18n attributes

let currentDictionary = {};
let fallbackDictionary = {};

// Pre-load English fallback
(async () => {
    try {
        const resp = await fetch('_locales/en/messages.json');
        if (resp.ok) fallbackDictionary = await resp.json();
    } catch (e) {}
})();

export async function applyTranslations(langCode) {
    const code = langCode || 'en';
    try {
        const response = await fetch(`_locales/${code}/messages.json`);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        currentDictionary = await response.json();
    } catch (error) {
        console.warn(`Failed to load translations for ${code}, falling back to English.`, error);
        currentDictionary = {};
    }

    // 1. Handle regular text translations
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const msg = currentDictionary[key]?.message || fallbackDictionary[key]?.message;
        if (msg) el.textContent = msg;
    });

    // 2. NEW: Handle placeholder translations
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        const msg = currentDictionary[key]?.message || fallbackDictionary[key]?.message;
        if (msg) el.setAttribute('placeholder', msg);
    });

    document.documentElement.lang = code;
}

export function t(key) {
    return currentDictionary[key]?.message || fallbackDictionary[key]?.message || key;
}
