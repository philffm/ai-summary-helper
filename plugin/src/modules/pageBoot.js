// pageBoot.js — what every extension page (reading view, home page, …) does first: the user's language and appearance
// settings (brand colours, colour scheme, text size, icon style, motion), so the pages look and read like the popup.
// → { lang, appTheme }  (appTheme = 'dark' | 'light' | 'contrast' | '' — what "Auto" follows)
import { applyTranslations } from './i18n.js';
import { applyA11y } from './a11y.js';
import StorageManager from './storageManager.js';

export const APPEARANCE_KEYS = ['theme', 'textScale', 'lineSpacing', 'readableFont', 'reduceMotion', 'iconStyle', 'colorScheme'];

export async function bootPage({ api = globalThis.chrome } = {}) {
    let lang = 'en', appTheme = '';
    try { lang = (await api.storage.sync.get('uiLanguage')).uiLanguage || 'en'; } catch (_) { /* English */ }
    try {
        const a = await StorageManager.get(APPEARANCE_KEYS);
        appTheme = a.theme === 'dark' || a.theme === 'light' || a.theme === 'contrast' ? a.theme : '';
        applyA11y({ ...a, theme: appTheme });
    } catch (_) { /* the tokens' own defaults */ }
    try { await applyTranslations(lang); } catch (_) { /* English */ }
    return { lang, appTheme };
}
