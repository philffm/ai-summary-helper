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

// Locale folders shipped in _locales (all fully translated; tests/test60.mjs enforces coverage).
export const SUPPORTED_LOCALES = ['en', 'de', 'es', 'fr', 'it', 'pt_PT', 'ru', 'hi', 'ko', 'ja', 'zh_CN', 'zh_TW', 'zh_HK', 'ar'];
const RTL = new Set(['ar', 'he', 'fa', 'ur']);

/**
 * Stored/browser language code → locale folder. '' (Browser Default) follows the browser's UI language;
 * 'de-DE' → de, 'pt'/'pt-BR' → pt_PT, 'zh-TW'/'zh-Hant' → zh_TW, 'zh-HK' → zh_HK, other zh → zh_CN; unknown → en.
 */
export function resolveLocale(code, browserLang) {
    let c = String(code || '').trim();
    if (!c) {
        let ui = '';
        try { ui = browserLang || (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || (typeof navigator !== 'undefined' && navigator.language) || ''; } catch (e) { /* no API */ }
        c = String(ui || 'en');
    }
    c = c.replace('-', '_');
    const exact = SUPPORTED_LOCALES.find(l => l.toLowerCase() === c.toLowerCase());
    if (exact) return exact;
    const base = c.split('_')[0].toLowerCase();
    if (base === 'zh') return /^zh_(tw|mo|hant)/i.test(c) ? 'zh_TW' : /^zh_hk/i.test(c) ? 'zh_HK' : 'zh_CN';
    if (base === 'pt') return 'pt_PT';
    return SUPPORTED_LOCALES.find(l => l.toLowerCase() === base) || 'en';
}

export async function applyTranslations(langCode) {
    const code = resolveLocale(langCode);
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

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        const msg = currentDictionary[key]?.message || fallbackDictionary[key]?.message;
        if (msg) { el.setAttribute('title', msg); el.setAttribute('aria-label', msg); }
    });

    document.querySelectorAll('[data-i18n-aria]').forEach(el => {
        const key = el.getAttribute('data-i18n-aria');
        const msg = currentDictionary[key]?.message || fallbackDictionary[key]?.message;
        if (msg) el.setAttribute('aria-label', msg);
    });

    document.documentElement.lang = code.replace('_', '-');
    document.documentElement.dir = RTL.has(code.split('_')[0]) ? 'rtl' : 'ltr';
    // Screens that build text in JS (Feeds) re-render with the new dictionary.
    try { document.dispatchEvent(new CustomEvent('aish:translationsApplied', { detail: { code } })); } catch (e) {}
}

export function t(key) {
    return currentDictionary[key]?.message || fallbackDictionary[key]?.message || key;
}
