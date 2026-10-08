// Keyboard shortcuts (one place, cross-platform).
//   ⌘F / Ctrl+F   focus the search box of the current screen (Feeds, History, Settings)
//   /             same, when you are not typing somewhere
//   Esc           (Detail view) back to the list · (Settings panel) back to Settings
// ⌘N / Ctrl+N (new summary) lives in mainScreen.js; arrow keys for tab bars in tabbar.js.

export const isMac = () => /Mac|iPhone|iPad/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || '');
export const modPressed = (e) => (isMac() ? e.metaKey : e.ctrlKey);
export const searchHint = () => (isMac() ? '⌘ + F' : 'Ctrl + F');

const SEARCH_BY_SCREEN = { feeds: 'feedSearch', history: 'searchInput', settings: 'settingsSearch' };
const HINT_RE = /\s*\((?:⌘|Ctrl)\s*\+\s*F\)\s*$/;

/** Appends "(⌘ + F)" / "(Ctrl + F)" to the three search placeholders (idempotent, re-run after translations). */
export function applySearchHints(doc = document) {
    Object.values(SEARCH_BY_SCREEN).forEach((id) => {
        const input = doc.getElementById(id);
        if (!input) return;
        const base = (input.getAttribute('placeholder') || '').replace(HINT_RE, '');
        if (base) input.setAttribute('placeholder', base + ' (' + searchHint() + ')');
    });
}

const visible = (el) => !!el && !el.hidden && (el.offsetParent !== null || el.getClientRects().length > 0 || typeof el.offsetParent === 'undefined');

/** Focuses the search box that belongs to the active screen. Returns true when it did. */
export async function focusSearch(doc = document) {
    const screen = doc.body && doc.body.dataset.screen;
    const id = SEARCH_BY_SCREEN[screen];
    const input = id && doc.getElementById(id);
    if (!input) return false;
    if (screen === 'feeds') { const bar = doc.getElementById('feedControls'); if (bar) bar.classList.remove('scroll-hidden'); }
    if (screen === 'history') {
        const hist = doc.getElementById('historyTopBar');
        if (hist && hist.style.display === 'none') return false;   // detail view / graph: no search box to focus
    }
    if (screen === 'settings' && !visible(input)) {
        try { const nav = await import('./settingsNav.js'); nav.showSettingsHome(); } catch (_) { /* ignore */ }
    }
    input.focus();
    if (typeof input.select === 'function') input.select();
    return true;
}

const isTyping = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function initShortcuts() {
    applySearchHints();
    setTimeout(applySearchHints, 400);                                   // after the first i18n pass
    document.addEventListener('aish:translationsApplied', () => applySearchHints());

    document.addEventListener('keydown', (event) => {
        const key = (event.key || '').toLowerCase();
        if (modPressed(event) && !event.shiftKey && !event.altKey && key === 'f') {
            const screen = document.body.dataset.screen;
            if (SEARCH_BY_SCREEN[screen]) { event.preventDefault(); focusSearch(); }
            return;
        }
        if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !isTyping(event.target)) {
            const screen = document.body.dataset.screen;
            if (SEARCH_BY_SCREEN[screen]) { event.preventDefault(); focusSearch(); }
            return;
        }
        if (event.key === 'Escape' && !event.defaultPrevented && !isTyping(event.target)) {
            // an open dialog / sheet / menu closes itself first (they stop propagation or run in capture phase)
            if (document.querySelector('[aria-modal="true"], .confirm-layer, #detailMoreMenu:not([hidden])')) return;
            const screen = document.body.dataset.screen;
            if (screen === 'history') {
                const detail = document.getElementById('articleDetail');
                if (detail && detail.style.display !== 'none' && detail.style.display !== '') { const back = document.getElementById('detailBackButton'); if (back) { event.preventDefault(); back.click(); } }
            } else if (screen === 'settings') {
                const home = document.getElementById('settingsHome');
                const back = document.querySelector('.settings-panel:not([hidden]) [data-back]');
                if (home && home.hidden && back && visible(back)) { event.preventDefault(); back.click(); }
            }
        }
    });
}
