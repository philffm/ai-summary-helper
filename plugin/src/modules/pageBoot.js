// pageBoot.js — what every extension page (reading view, home page, …) does first: the user's language and appearance
// settings (brand colours, colour scheme, text size, icon style, motion), so the pages look and read like the popup.
// → { lang, appTheme, appearance }  (appearance = the stored display settings, for pages that offer a way to change them)  (appTheme = 'dark' | 'light' | 'contrast' | '' — what "Auto" follows)
import { applyTranslations } from './i18n.js';
import { applyA11y, normalizeAppearance } from './a11y.js';
import StorageManager from './storageManager.js';

export const APPEARANCE_KEYS = ['theme', 'design', 'textScale', 'lineSpacing', 'readableFont', 'reduceMotion', 'iconStyle', 'colorScheme', 'fontStyle'];

export async function bootPage({ api = globalThis.chrome } = {}) {
    let lang = 'en', appTheme = '', appearance = {};
    try { lang = (await api.storage.sync.get('uiLanguage')).uiLanguage || 'en'; } catch (_) { /* English */ }
    try {
        const a = await StorageManager.get(APPEARANCE_KEYS); appearance = { ...a };
        const n = normalizeAppearance(a); appTheme = n.theme === 'system' ? '' : n.theme;   // the brightness: what the reading view's "Auto" follows
        applyA11y(a);
    } catch (_) { /* the tokens' own defaults */ }
    try { await applyTranslations(lang); } catch (_) { /* English */ }
    return { lang, appTheme, appearance };
}
