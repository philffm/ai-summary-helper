import { SK } from './storageKeys.js';
import { T, N_ } from './feedI18n.js';
import { initSendTargets } from './sendTargets.js';
import { bp } from './breakpoints.js';
// settingsNav.js
// Settings home (grouped list) → panel navigation, live row subtitles, and
// search. All controls keep their original ids (settingsManager.js / authManager.js
// bind by id), only their containers moved into the panels in popup.html.

import { INDEX, PANEL_TITLES, settingsEntries } from './settingsIndex.js';
export { settingsEntries };



let screenEl = null;
let currentPanel = 'account';

// Large windows: master–detail (list stays visible, one panel open beside it).
export const settingsIsWide = () => window.innerWidth >= bp('settings-wide');
function syncWide() {
    if (!screenEl) return;
    const wide = settingsIsWide();
    const was = screenEl.classList.contains('st-wide');
    screenEl.classList.toggle('st-wide', wide);
    if (wide === was) return;
    if (wide) openSettingsPanel(currentPanel); else showHome();
}
function markActiveRow(name) {
    document.querySelectorAll('.settings-row[data-panel]').forEach(r => {
        const on = r.dataset.panel === name;
        r.classList.toggle('active', on);
        if (on) r.setAttribute('aria-current', 'true'); else r.removeAttribute('aria-current');
    });
}

function $(id) { return document.getElementById(id); }

/** Plays the panel entrance (CSS .st-in-fwd / .st-in-back): forward slides in from the right, back from the left. */
function playPanelIn(el, dir) {
    if (!el) return;
    el.classList.remove('st-in-fwd', 'st-in-back', 'st-in-fade');
    void el.offsetWidth;
    const cls = settingsIsWide() ? 'st-in-fade' : (dir === 'back' ? 'st-in-back' : 'st-in-fwd');
    el.classList.add(cls);
    el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

function selectedText(id) {
    const el = $(id);
    const opt = el && el.selectedOptions && el.selectedOptions[0];
    if (opt) return opt.textContent.trim();
    const on = el && el.querySelector && el.querySelector('[role=radio].on');   // segmented control
    return on ? on.textContent.trim() : '';
}

function onOff(id) { const el = $(id); return el && el.checked ? T('on') : T('off'); }

async function refreshSubtitles() {
    const set = (key, text) => {
        const el = document.querySelector(`.settings-row-sub[data-sub="${key}"]`);
        if (el && text) el.textContent = text;
    };
    try {
        const local = await chrome.storage.local.get([SK.token]);
        set('account', local[SK.token] ? T('Signed in · byPhil Cloud') : T('Not signed in'));
        const sync = await chrome.storage.sync.get(['connectionMode', 'preferredCloudModel']);
        const mode = sync.connectionMode || 'cloud';
        if (mode === 'cloud') {
            const m = (sync.preferredCloudModel || selectedText('cloudModelSelect') || '').split('/').pop();
            set('models', T('byPhil Cloud') + (m ? ' · ' + m : ''));
        } else {
            const prov = selectedText('model');
            set('models', T('Own key') + (prov ? ' · ' + prov : ''));
        }
    } catch (e) { /* storage unavailable (context invalidated) */ }
    const preset = selectedText('promptSelect');
    set('prompts', preset ? T('Preset: {name}', { name: preset }) : T('Preset and custom prompt'));
    set('reading', T('Highlighting {a} · ghost {b}', { a: onOff('highlightingToggle'), b: onOff('aiHighlightingToggle') }));
    const delivery = selectedText('deliveryPreference');
    set('send', delivery ? T('Delivery: {name}', { name: delivery }) : T('Kindle · LocalSend · bookmarklet'));
    const theme = selectedText('themeSeg'); const lang = selectedText('uiLangSelect');
    set('appearance', [theme, lang].filter(Boolean).join(' · ') || T('Theme · language · side panel'));
    const sizeEl = $('textScaleValue'), motionEl = $('reduceMotionToggle');
    if (sizeEl && motionEl) set('accessibility', [sizeEl.textContent.trim(), motionEl.checked ? T('Motion reduced') : T('Motion on')].join(' · '));
    const v = $('versionNumber');
    set('about', T('Feedback · contact · donate') + (v ? ' · v' + v.textContent.trim() : ''));
}

// Panels without a settings form (sign-in and account) have nothing to save: hide the floating Save button there.
const NO_SAVE_PANELS = new Set(['account', 'mcp', 'sync', 'about']);
function syncSaveFab(name) {
    const fab = $('settingsSaveFab');
    if (fab) fab.classList.toggle('no-save', NO_SAVE_PANELS.has(name));
}

function showHome() {
    const fabOnHome = $('settingsSaveFab');
    if (fabOnHome) fabOnHome.classList.remove('no-save');
    if (settingsIsWide()) { openSettingsPanel(currentPanel); return; }
    document.querySelectorAll('.settings-panel').forEach(p => { p.hidden = true; });
    $('settingsHome').hidden = false;
    playPanelIn($('settingsHome'), 'back');
    if (screenEl) screenEl.scrollTop = 0;
    refreshSubtitles();
}

export function openSettingsPanel(name, targetId) {
    const panel = $('settingsPanel-' + name);
    if (!panel) return;
    document.dispatchEvent(new CustomEvent('aish:settings-panel', { detail: { name, targetId } }));
    currentPanel = name;
    syncSaveFab(name);
    markActiveRow(name);
    $('settingsHome').hidden = !settingsIsWide() ? true : false;
    const wasHidden = panel.hidden;
    document.querySelectorAll('.settings-panel').forEach(p => { p.hidden = p !== panel; });
    if (wasHidden) playPanelIn(panel, 'fwd');   // re-opening the panel that is already showing does not replay it
    if (screenEl) screenEl.scrollTop = 0;
    panel.scrollTop = 0;
    if (targetId) {
        // Wait a frame so the panel is laid out before scrolling.
        requestAnimationFrame(() => {
            const t = $(targetId);
            if (!t) return;
            const box = t.closest('.setting-group, .backup-restore, .local-intelligence, .danger-zone, details, p') || t;
            t.scrollIntoView({ block: 'center', behavior: 'smooth' });
            box.classList.add('settings-flash');
            setTimeout(() => box.classList.remove('settings-flash'), 1800);
        });
    }
}

function renderResults(query) {
    const results = $('settingsSearchResults');
    const groups = $('settingsGroups');
    const q = query.trim().toLowerCase();
    if (!q) { results.hidden = true; results.replaceChildren(); groups.hidden = false; return; }
    const tokens = q.split(/\s+/);
    const hits = INDEX.filter(([panel, label, , kw]) => {
        const hay = (label + ' ' + T(label) + ' ' + kw + ' ' + PANEL_TITLES[panel] + ' ' + T(PANEL_TITLES[panel])).toLowerCase();
        return tokens.every(t => hay.includes(t));
    });
    groups.hidden = true; results.hidden = false; results.replaceChildren();
    if (!hits.length) {
        const empty = document.createElement('div');
        empty.className = 'explanatory-card';
        empty.textContent = T('No settings match “{query}”.', { query: query.trim() });
        results.appendChild(empty);
        return;
    }
    for (const [panel, label, target] of hits) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'settings-row settings-result';
        const text = document.createElement('span'); text.className = 'settings-row-text';
        const t = document.createElement('span'); t.className = 'settings-row-title'; t.textContent = T(label);
        const s = document.createElement('span'); s.className = 'settings-row-sub'; s.textContent = T(PANEL_TITLES[panel]);
        text.append(t, s);
        const chev = document.createElement('span'); chev.className = 'settings-row-chev'; chev.textContent = '›';
        b.append(text, chev);
        b.addEventListener('click', () => {
            const input = $('settingsSearch'); input.value = ''; renderResults('');
            openSettingsPanel(panel, target);
        });
        results.appendChild(b);
    }
}

export function initSettingsNav(ui) {
    screenEl = $('settingsScreen');
    if (!screenEl || !$('settingsHome')) return;

    document.querySelectorAll('.settings-row[data-panel]').forEach(row => {
        row.addEventListener('click', () => openSettingsPanel(row.dataset.panel));
    });
    document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', showHome));
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(syncWide, 120); });
    initSendTargets();
    syncWide();
    if (settingsIsWide()) openSettingsPanel('account');

    const search = $('settingsSearch');
    search.addEventListener('input', () => renderResults(search.value));
    search.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { search.value = ''; renderResults(''); }
        if (e.key === 'Enter') { e.preventDefault(); const first = $('settingsSearchResults').querySelector('.settings-result'); if (first) first.click(); }
    });

    // Keep row subtitles in sync with the controls they summarise.
    $('settingsForm').addEventListener('change', () => setTimeout(refreshSubtitles, 50));
    // Once settingsManager has filled the controls from storage (before that they show their defaults, e.g. "off").
    document.addEventListener('aish:settings-populated', refreshSubtitles);
    refreshSubtitles();
}

export { showHome as showSettingsHome };
