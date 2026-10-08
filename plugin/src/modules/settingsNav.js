import { SK } from './storageKeys.js';
import { T, N_ } from './feedI18n.js';
// settingsNav.js
// Settings home (grouped list) → panel navigation, live row subtitles, and
// search. All controls keep their original ids (settingsManager.js / authManager.js
// bind by id), only their containers moved into the panels in popup.html.

// Search index: one entry per control. `target` is the element id to scroll to
// and flash after jumping to its panel; `kw` are extra match words.
const INDEX = [
    ['account', N_('Account sync · sign in / log out'), 'otpEmail', 'login log in email magic code logout log out account'],
    ['account', N_('Pro license key'), 'licenseKey', 'activate plan upgrade pass pro subscription'],
    ['models', N_('Connection path'), 'modeCloud', 'cloud byphil own key bring your own'],
    ['models', N_('Preferred cloud model'), 'cloudModelSelect', 'gemini gpt claude model cloud'],
    ['models', N_('Provider'), 'model', 'openai mistral deepseek gemini ollama api'],
    ['models', N_('Model identifier'), 'modelIdentifier', 'model name id gpt llama'],
    ['models', N_('API key'), 'apiKey', 'key token secret'],
    ['models', N_('Endpoint URL'), 'customEndpoint', 'ollama local server custom'],
    ['prompts', N_('Preset prompt'), 'promptSettingsRoot', 'prompt preset template'],
    ['prompts', N_('Custom prompt text'), 'promptSettingsRoot', 'prompt instructions system custom guided builder tone length focus'],
    ['prompts', N_('Feed briefing & recap style'), 'promptSettingsRoot', 'feeds briefing recap style tone length'],
    ['feeds', N_('Sources · rename · tags · mute'), 'feedSubsCard', 'rss feeds subscriptions tags folder group rename mute unsubscribe sources'],
    ['feeds', N_('Import / export OPML'), 'feedOpmlActions', 'opml import export rss subscriptions backup reader'],
    ['feedprefs', N_('Mark read when opened'), 'feedSetMarkRead', 'feed read unread open'],
    ['feedprefs', N_('Mood on/off (tone analysis)'), 'feedSetMood', 'mood sentiment tone positive negative disable hide analysis diet'],
    ['feedprefs', N_('Rate items with the recap'), 'feedSetRate', 'feed ai recap rate score sentiment mood category label automatic'],
    ['feedprefs', N_('Auto-summarize favorites'), 'feedSetAutoSum', 'feed favorite star summarize automatic background'],
    ['feedprefs', N_('Check feeds in the background'), 'feedSetPoll', 'feed badge notification new items poll background'],
    ['feedprefs', N_('Feed refresh interval'), 'feedSetRefresh', 'feed refresh update minutes hour interval'],
    ['feedprefs', N_('Keep feed items for'), 'feedSetKeep', 'feed retention days delete old cleanup'],
    ['reading', N_('Page highlighting'), 'highlightingToggle', 'highlight yellow marker annotate'],
    ['reading', N_('AI ghost highlighting'), 'aiHighlightingToggle', 'ghost highlight ai quotes blue'],
    ['reading', N_('Ghost highlight amount'), 'ghostHighlightAmount', 'ghost highlight few regular a lot'],
    ['send', N_('Delivery method'), 'deliveryPreference', 'kindle koreader localsend send deliver'],
    ['send', N_('Kindle devices'), 'newKindleEmail', 'kindle email device send to kindle'],
    ['send', N_('KOReader / LocalSend devices'), 'newLocalSendIp', 'koreader localsend ip device scan'],
    ['send', N_('Bookmarklet generator'), 'generateBookmarkletBtn', 'bookmarklet ios android mobile safari'],
    ['appearance', N_('Theme'), 'themeSeg', 'dark light mode appearance system contrast'],
    ['appearance', N_('UI language'), 'uiLangSelect', 'language translation locale interface'],
    ['appearance', N_('Line spacing'), 'lineSeg', 'text size font dyslexia reading spacing'],
    ['appearance', N_('Native Chrome side panel'), 'nativeSidePanelToggle', 'sidebar side panel popup window'],
    ['library', N_('Export settings'), 'exportSettingsButton', 'backup export download json'],
    ['library', N_('Import settings'), 'importSettingsButton', 'restore import backup json'],
    ['library', N_('Clean up & merge tags'), 'cleanupTagsButton', 'tags duplicates merge clean on-device'],
    ['library', N_('Delete history'), 'deleteHistoryButton', 'danger erase clear remove articles archive'],
    ['library', N_('Delete settings'), 'deleteSettingsButton', 'danger reset erase remove'],
    ['about', N_('Compatible tools'), 'compatibleToolsList', 'apps extensions tools integrations'],
    ['about', N_('Feedback · contact · donate'), 'settingsPanel-about', 'bug support feedback contact donation help'],
    ['about', N_('Version & GitHub'), 'versionNumber', 'version contribute open source github'],
];

const PANEL_TITLES = {
    account: N_('Account & Plan'), models: N_('Models & API'), prompts: N_('Prompts'), feeds: N_('Sources'), feedprefs: N_('Feed preferences'), reading: N_('Reading & Highlighting'),
    send: N_('Send & Share'), appearance: N_('Appearance & Language'), library: N_('Library & Data'), about: N_('About & Tools')
};

let screenEl = null;
let currentPanel = 'account';

// Large windows: master–detail (list stays visible, one panel open beside it).
export const settingsIsWide = () => window.innerWidth >= 900;
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
    const v = $('versionNumber');
    set('about', T('Compatible tools') + (v ? ' · v' + v.textContent.trim() : ''));
}

function showHome() {
    if (settingsIsWide()) { openSettingsPanel(currentPanel); return; }
    document.querySelectorAll('.settings-panel').forEach(p => { p.hidden = true; });
    $('settingsHome').hidden = false;
    if (screenEl) screenEl.scrollTop = 0;
    refreshSubtitles();
}

export function openSettingsPanel(name, targetId) {
    const panel = $('settingsPanel-' + name);
    if (!panel) return;
    document.dispatchEvent(new CustomEvent('aish:settings-panel', { detail: { name, targetId } }));
    currentPanel = name;
    markActiveRow(name);
    $('settingsHome').hidden = !settingsIsWide() ? true : false;
    document.querySelectorAll('.settings-panel').forEach(p => { p.hidden = p !== panel; });
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
    setTimeout(refreshSubtitles, 800);   // after settingsManager has populated the controls
    refreshSubtitles();
}

export { showHome as showSettingsHome };
