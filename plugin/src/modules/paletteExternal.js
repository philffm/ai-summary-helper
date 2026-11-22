// paletteExternal.js — the ⌘K palette on pages that are not the popup (reading view, home page): screens open the app in a tab,
// the page adds its own commands (`extra`), articles open through `openArticle`.
import { T } from './feedI18n.js';
import { openPalette } from './commandPalette.js';
import { articleCommands, withWebSearch } from './commands.js';
import { isMac } from './shortcuts.js';
import StorageManager from './storageManager.js';
import { settingsEntries } from './settingsIndex.js';

const appUrl = (hash = '') => chrome.runtime.getURL('popup.html') + hash;

/** The app's places as palette entries for pages that are not the popup (they open the app in a tab). `extra` = the page's own entries, shown first. */
export function externalCommands({ extra = [], home = true, openScreen = null } = {}) {
    const open = (url) => (chrome.tabs ? chrome.tabs.create({ url }) : window.open(url, '_blank'));
    const go = (name) => () => (openScreen ? openScreen(name) : open(appUrl('#' + name)));   // the home page shows the app beside itself, other pages in a tab
    const nav = T('Go to'), set = T('Settings');
    // every setting the app has, as in the popup's palette: the app opens on that panel (hash settings/<panel>/<control>)
    const settings = settingsEntries().map((e) => ({ id: 'set:' + e.panel + ':' + (e.target || ''), group: set, title: e.title, keywords: e.kw, run: go('settings/' + e.panel + '/' + (e.target || '')) }));
    return [
        ...extra,
        ...(home ? [{ id: 'home', group: nav, title: T('Home page'), keywords: 'start dashboard widgets', run: () => open(chrome.runtime.getURL('home.html')) }] : []),
        { id: 'go:main', group: nav, title: T('Summary'), keywords: 'home main', run: go('main') },
        { id: 'go:feeds', group: nav, title: T('Feeds'), keywords: 'rss sources news', run: go('feeds') },
        { id: 'go:history', group: nav, title: T('History'), keywords: 'library articles saved', run: go('history') },
        { id: 'go:notes', group: nav, title: T('Notes'), keywords: 'highlights annotations', run: go('notes') },
        { id: 'go:settings', group: nav, title: T('Settings'), keywords: 'preferences options', run: go('settings') },
        ...settings,
    ];
}

/** Saved articles for the search (loads the index once). */
export function externalArticleSearch(openArticle, notify) {
    let index = null;
    const open = openArticle || ((a) => window.open(chrome.runtime.getURL('readerPage.html') + '#id=' + encodeURIComponent(a.id), '_blank'));
    return withWebSearch(async (q) => articleCommands(index = index || await StorageManager.getArticlesIndex(), q, open), notify);
}

export function openExternalPalette({ extra = [], openArticle, notify, doc = document } = {}) {
    openPalette({ doc, getCommands: () => externalCommands({ extra }), findMore: externalArticleSearch(openArticle, notify) });
}
export const paletteKeyHint = () => (isMac() ? '⌘K' : 'Ctrl+K');

/** ⌘K / Ctrl+K on a page. */
export function bindPaletteKey(open, doc = document) {
    doc.addEventListener('keydown', (e) => {
        if ((isMac() ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key || '').toLowerCase() === 'k') { e.preventDefault(); open(); }
    });
}
