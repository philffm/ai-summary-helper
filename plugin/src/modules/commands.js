// commands.js — what the ⌘K palette offers: screens, actions, every settings panel and control, and (while typing) saved articles.
import { T } from './feedI18n.js';
import { bgMessage } from './bgMessage.js';
import { scoreCommand } from './commandPalette.js';
import { isMac, openHelp } from './shortcuts.js';
import { webSearchCommand, webSearchPossible } from './webSearch.js';

/** Wraps an article search: results first (from two characters), then "Search the web" as the last entry for any query. */
export function withWebSearch(findArticles) {
    return async (q) => [...(q.trim().length >= 2 && findArticles ? await findArticles(q) : []), ...(webSearchPossible() && q.trim() ? [webSearchCommand(q)] : [])];
}

/** Saved articles matching the query as palette entries (title, address and tags; newest first among equal scores). */
export function articleCommands(index, query, open, { limit = 8 } = {}) {
    const rows = [];
    for (const a of index || []) {
        const host = (() => { try { return new URL(a.url).hostname.replace(/^www\./, ''); } catch (_) { return ''; } })();
        const cmd = { title: a.title || a.url || '', keywords: (a.tags || []).join(' ') + ' ' + (a.url || ''), sub: host };
        const s = scoreCommand(cmd, query);
        if (s > 0) rows.push({ s, t: Date.parse(a.timestamp) || 0, cmd: { id: 'article:' + a.id, group: T('Articles'), title: cmd.title, sub: host, run: () => open(a) } });
    }
    return rows.sort((x, y) => (y.s - x.s) || (y.t - x.t)).slice(0, limit).map((r) => r.cmd);
}

/** ui = the popup's ui object (showScreen); deps are injectable for tests. */
export function buildCommands(ui, deps = {}) {
    const mod = isMac() ? '⌘' : 'Ctrl';
    const go = (screen) => () => ui.showScreen(screen);
    const nav = T('Go to');
    const list = [
        { id: 'go:main', group: nav, title: T('Summary'), keywords: 'home page main', run: go('main') },
        { id: 'go:feeds', group: nav, title: T('Feeds'), keywords: 'rss sources news', run: go('feeds') },
        { id: 'go:history', group: nav, title: T('History'), keywords: 'library articles saved', run: go('history') },
        { id: 'go:notes', group: nav, title: T('Notes'), keywords: 'highlights annotations', run: go('notes') },
        { id: 'go:settings', group: nav, title: T('Settings'), keywords: 'preferences options', run: go('settings') },
    ];
    const act = T('Actions');
    list.push(
        { id: 'do:new', group: act, title: T('New summary'), keywords: 'summarize page', keys: [mod, 'N'], run: () => { ui.showScreen('main'); document.dispatchEvent(new CustomEvent('aish:new-summary')); } },
        { id: 'do:sync', group: act, title: T('Sync now'), keywords: 'backup publish', run: () => bgMessage({ action: 'syncNow' }, { timeout: 5 * 60 * 1000 }) },
        { id: 'do:home', group: act, title: T('Home page'), keywords: 'start dashboard widgets overview', run: () => chrome.tabs.create({ url: chrome.runtime.getURL('home.html') }) },
        { id: 'do:keys', group: act, title: T('Keyboard shortcuts'), keywords: 'help keys', keys: ['?'], run: () => openHelp() },
    );
    const set = T('Settings');
    const entries = deps.settingsEntries ? deps.settingsEntries() : [];
    const open = deps.openSettingsPanel;
    for (const e of entries) list.push({ id: 'set:' + e.panel + ':' + (e.target || ''), group: set, title: e.title, keywords: e.kw, run: () => { ui.showScreen('settings'); if (open) open(e.panel, e.target); } });
    return list;
}
