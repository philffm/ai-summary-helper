import { T } from './feedI18n.js';
import { trapFocus } from './sheet.js';
// Keyboard shortcuts (one place, cross-platform).
//   ⌘F / Ctrl+F   focus the search box of the current screen (Feeds, History, Settings)
//   /             same, when you are not typing somewhere
//   Esc           (Detail view) back to the list · (Settings panel) back to Settings
//   j / ↓  k / ↑  next / previous card in Feeds and History (Enter opens)
//   ?             shortcut help sheet (searchable)
// ⌘N / Ctrl+N (new summary) and ⌘/Ctrl+Enter (summarize / send) live in mainScreen.js; arrow keys for tab bars in tabbar.js.

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


const CARD_SEL = { feeds: '#feedScroll li.feed-item', history: '#articleList li.article-card' };
const cardsOf = (doc, screen) => [...doc.querySelectorAll(CARD_SEL[screen] || '__none__')].filter(c => c.style.display !== 'none' && c.getClientRects().length > 0);

/** Moves keyboard focus to the next / previous card of the active list. Returns true when it moved. */
export function moveCard(dir, doc = document) {
    const screen = doc.body.dataset.screen;
    if (screen === 'history') {
        const list = doc.getElementById('articleList');
        if (!list || list.style.display === 'none') return false;
    }
    const cards = cardsOf(doc, screen);
    if (!cards.length) return false;
    const cur = doc.activeElement && doc.activeElement.closest ? doc.activeElement.closest(CARD_SEL[screen]) : null;
    let i = cur ? cards.indexOf(cur) : -1;
    i = i === -1 ? (dir > 0 ? 0 : cards.length - 1) : Math.max(0, Math.min(cards.length - 1, i + dir));
    cards[i].focus({ preventScroll: true });
    if (typeof cards[i].scrollIntoView === 'function') cards[i].scrollIntoView({ block: 'nearest' });
    return true;
}

/** Rows of the help sheet: [group, [[label, [keys…]], …]]. */
export function shortcutGroups() {
    const mod = isMac() ? '⌘' : 'Ctrl';
    return [
        [T('Search'), [[T('Focus search'), [mod, 'F']], [T('Focus search'), ['/']]]],
        [T('Lists'), [[T('Next / previous card'), ['j', 'k']], [T('Next / previous card'), ['↓', '↑']], [T('Open'), ['Enter']], [T('Back'), ['Esc']]]],
        [T('Summarize'), [[T('Summarize / send'), [mod, '↵']], [T('New summary'), [mod, 'N']], [T('Switch tab'), ['←', '→']], [T('Keyboard shortcuts'), ['?']]]]
    ];
}

let helpSheet = null;
export function closeHelp() { if (helpSheet) { helpSheet.release(); helpSheet.root.remove(); helpSheet = null; } }

/** "?" help: bottom sheet with every shortcut and a filter field. */
export function openHelp(doc = document) {
    if (helpSheet) { closeHelp(); return; }
    const mk = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const root = mk('div', 'sendsheet kbd-help');
    const scrim = mk('div', 'sendsheet-scrim');
    const panel = mk('div', 'sendsheet-panel');
    const title = mk('div', 'sendsheet-title', T('Keyboard shortcuts'));
    const filter = mk('input', 'kbd-filter'); filter.type = 'search'; filter.placeholder = T('Filter shortcuts…'); filter.setAttribute('aria-label', T('Filter shortcuts…'));
    const body = mk('div', 'kbd-groups');
    const rows = [];
    const empty = mk('div', 'kbd-tip', T('No shortcuts match')); empty.hidden = true;
    shortcutGroups().forEach(([g, items]) => {
        const sec = mk('div', 'kbd-group');
        sec.append(mk('div', 'kbd-group-t', g));
        items.forEach(([label, keys]) => {
            const row = mk('div', 'kbd-row'); row.append(mk('span', 'kbd-label', label));
            const k = mk('span', 'kbd-keys'); keys.forEach(x => k.append(mk('kbd', 'kbd-key', x))); row.append(k);
            sec.append(row); rows.push({ row, sec, text: (label + ' ' + keys.join(' ')).toLowerCase() });
        });
        body.append(sec);
    });
    filter.addEventListener('input', () => {
        const q = filter.value.trim().toLowerCase();
        rows.forEach(r => { r.row.hidden = !!q && !r.text.includes(q); });
        rows.forEach(r => { r.sec.hidden = !r.sec.querySelector('.kbd-row:not([hidden])'); });
        empty.hidden = rows.some(r => !r.row.hidden);
    });
    panel.append(mk('div', 'sendsheet-grab'), title, filter, body, empty, mk('div', 'kbd-tip', T('Press ? anywhere outside a text field')));
    root.append(scrim, panel);
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeHelp(); } });
    scrim.addEventListener('click', closeHelp);
    doc.body.append(root);
    panel.style.minHeight = panel.offsetHeight + 'px';   // keep the full-list height while filtering so nothing jumps
    const trap = trapFocus(root, { label: T('Keyboard shortcuts') });
    helpSheet = { root, release: trap.release };
}

const isTyping = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function initShortcuts() {
    applySearchHints();
    setTimeout(applySearchHints, 400);                                   // after the first i18n pass
    document.addEventListener('aish:translationsApplied', () => applySearchHints());

    // Hint bar above the nav while a list card has keyboard focus (decorative: the help sheet is the accessible source).
    let hint = null;
    const hideHint = () => { if (hint) hint.hidden = true; };
    document.addEventListener('focusin', (e) => {
        const t = e.target;
        if (!(t && t.matches && t.matches(Object.values(CARD_SEL).join(',') ) && (() => { try { return t.matches(':focus-visible'); } catch (_) { return true; } })())) { hideHint(); return; }
        if (!hint) {
            hint = document.createElement('div'); hint.className = 'kbd-hintbar'; hint.setAttribute('aria-hidden', 'true');
            [['j', 'k', T('move')], ['↵', '', T('open')], ['/', '', T('search')], ['?', '', T('help')]].forEach(([a, b, l]) => {
                const g = document.createElement('span'); g.className = 'kbd-hint-g';
                [a, b].filter(Boolean).forEach(x => { const k = document.createElement('kbd'); k.className = 'kbd-key'; k.textContent = x; g.append(k); });
                g.append(document.createTextNode(l)); hint.append(g);
            });
            document.body.append(hint);
        }
        hint.hidden = false;
    });
    document.addEventListener('focusout', (e) => { if (!e.relatedTarget) hideHint(); });
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
        if (event.key === '?' && !event.metaKey && !event.ctrlKey && !event.altKey && !isTyping(event.target)) { event.preventDefault(); openHelp(); return; }
        if (!event.metaKey && !event.ctrlKey && !event.altKey && !isTyping(event.target) && !helpSheet && !document.querySelector('[aria-modal="true"], .confirm-layer')) {
            const dir = (key === 'j' || event.key === 'ArrowDown') ? 1 : (key === 'k' || event.key === 'ArrowUp') ? -1 : 0;
            const t = event.target;
            const plain = !t || t === document.body || (t.matches && t.matches(Object.values(CARD_SEL).join(',')));
            if (dir && (key === 'j' || key === 'k' || plain) && moveCard(dir)) { event.preventDefault(); return; }
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
