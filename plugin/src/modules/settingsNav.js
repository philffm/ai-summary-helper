// settingsNav.js
// Settings home (grouped list) → panel navigation, live row subtitles, and
// search. All controls keep their original ids (settingsManager.js / authManager.js
// bind by id), only their containers moved into the panels in popup.html.

// Search index: one entry per control. `target` is the element id to scroll to
// and flash after jumping to its panel; `kw` are extra match words.
const INDEX = [
    ['account', 'Account sync · sign in / log out', 'otpEmail', 'login log in email magic code logout log out account'],
    ['account', 'Pro license key', 'licenseKey', 'activate plan upgrade pass pro subscription'],
    ['models', 'Connection path', 'modeCloud', 'cloud byphil own key bring your own'],
    ['models', 'Preferred cloud model', 'cloudModelSelect', 'gemini gpt claude model cloud'],
    ['models', 'Provider', 'model', 'openai mistral deepseek gemini ollama api'],
    ['models', 'Model identifier', 'modelIdentifier', 'model name id gpt llama'],
    ['models', 'API key', 'apiKey', 'key token secret'],
    ['models', 'Endpoint URL', 'customEndpoint', 'ollama local server custom'],
    ['prompts', 'Preset prompt', 'promptSettingsRoot', 'prompt preset template'],
    ['prompts', 'Custom prompt text', 'promptSettingsRoot', 'prompt instructions system custom guided builder tone length focus'],
    ['prompts', 'Feed briefing & recap style', 'promptSettingsRoot', 'feeds briefing recap style tone length'],
    ['feeds', 'Feed subscriptions · rename · tags', 'feedSubsCard', 'rss feeds subscriptions tags folder group rename mute unsubscribe sources'],
    ['feeds', 'Import / export OPML', 'feedOpmlActions', 'opml import export rss subscriptions backup reader'],
    ['feeds', 'Mark read when opened', 'feedSetMarkRead', 'feed read unread open'],
    ['feeds', 'Rate items with the recap', 'feedSetRate', 'feed ai recap rate score sentiment mood category label automatic'],
    ['feeds', 'Auto-summarize favorites', 'feedSetAutoSum', 'feed favorite star summarize automatic background'],
    ['feeds', 'Check feeds in the background', 'feedSetPoll', 'feed badge notification new items poll background'],
    ['feeds', 'Feed refresh interval', 'feedSetRefresh', 'feed refresh update minutes hour interval'],
    ['feeds', 'Keep feed items for', 'feedSetKeep', 'feed retention days delete old cleanup'],
    ['reading', 'Page highlighting', 'highlightingToggle', 'highlight yellow marker annotate'],
    ['reading', 'AI ghost highlighting', 'aiHighlightingToggle', 'ghost highlight ai quotes blue'],
    ['reading', 'Ghost highlight amount', 'ghostHighlightAmount', 'ghost highlight few regular a lot'],
    ['send', 'Delivery method', 'deliveryPreference', 'kindle koreader localsend send deliver'],
    ['send', 'Kindle devices', 'newKindleEmail', 'kindle email device send to kindle'],
    ['send', 'KOReader / LocalSend devices', 'newLocalSendIp', 'koreader localsend ip device scan'],
    ['send', 'Bookmarklet generator', 'generateBookmarkletBtn', 'bookmarklet ios android mobile safari'],
    ['appearance', 'Theme', 'themeSelect', 'dark light mode appearance system'],
    ['appearance', 'UI language', 'uiLangSelect', 'language translation locale interface'],
    ['appearance', 'Native Chrome side panel', 'nativeSidePanelToggle', 'sidebar side panel popup window'],
    ['library', 'Export settings', 'exportSettingsButton', 'backup export download json'],
    ['library', 'Import settings', 'importSettingsButton', 'restore import backup json'],
    ['library', 'Clean up & merge tags', 'cleanupTagsButton', 'tags duplicates merge clean on-device'],
    ['library', 'Delete history', 'deleteHistoryButton', 'danger erase clear remove articles archive'],
    ['library', 'Delete settings', 'deleteSettingsButton', 'danger reset erase remove'],
    ['about', 'Compatible tools', 'compatibleToolsList', 'apps extensions tools integrations'],
    ['about', 'Feedback · contact · donate', 'settingsPanel-about', 'bug support feedback contact donation help'],
    ['about', 'Version & GitHub', 'versionNumber', 'version contribute open source github'],
];

const PANEL_TITLES = {
    account: 'Account & Plan', models: 'Models & API', prompts: 'Prompts', feeds: 'Feeds', reading: 'Reading & Highlighting',
    send: 'Send & Share', appearance: 'Appearance & Language', library: 'Library & Data', about: 'About & Tools'
};

let screenEl = null;

function $(id) { return document.getElementById(id); }

function selectedText(id) {
    const el = $(id);
    const opt = el && el.selectedOptions && el.selectedOptions[0];
    return opt ? opt.textContent.trim() : '';
}

function onOff(id) { const el = $(id); return el && el.checked ? 'on' : 'off'; }

async function refreshSubtitles() {
    const set = (key, text) => {
        const el = document.querySelector(`.settings-row-sub[data-sub="${key}"]`);
        if (el && text) el.textContent = text;
    };
    try {
        const local = await chrome.storage.local.get(['pb_token']);
        set('account', local.pb_token ? 'Signed in · byPhil Cloud' : 'Not signed in');
        const sync = await chrome.storage.sync.get(['connectionMode', 'preferredCloudModel']);
        const mode = sync.connectionMode || 'cloud';
        if (mode === 'cloud') {
            const m = (sync.preferredCloudModel || selectedText('cloudModelSelect') || '').split('/').pop();
            set('models', 'byPhil Cloud' + (m ? ' · ' + m : ''));
        } else {
            const prov = selectedText('model');
            set('models', 'Own key' + (prov ? ' · ' + prov : ''));
        }
    } catch (e) { /* storage unavailable (context invalidated) */ }
    const preset = selectedText('promptSelect');
    set('prompts', preset ? 'Preset: ' + preset : 'Preset and custom prompt');
    set('reading', `Highlighting ${onOff('highlightingToggle')} · ghost ${onOff('aiHighlightingToggle')}`);
    const delivery = selectedText('deliveryPreference');
    set('send', delivery ? 'Delivery: ' + delivery : 'Kindle · LocalSend · bookmarklet');
    const theme = selectedText('themeSelect'); const lang = selectedText('uiLangSelect');
    set('appearance', [theme, lang].filter(Boolean).join(' · ') || 'Theme · language · side panel');
    const v = $('versionNumber');
    set('about', 'Compatible tools' + (v ? ' · v' + v.textContent.trim() : ''));
}

function showHome() {
    document.querySelectorAll('.settings-panel').forEach(p => { p.hidden = true; });
    $('settingsHome').hidden = false;
    if (screenEl) screenEl.scrollTop = 0;
    refreshSubtitles();
}

export function openSettingsPanel(name, targetId) {
    const panel = $('settingsPanel-' + name);
    if (!panel) return;
    document.dispatchEvent(new CustomEvent('aish:settings-panel', { detail: { name } }));
    $('settingsHome').hidden = true;
    document.querySelectorAll('.settings-panel').forEach(p => { p.hidden = p !== panel; });
    if (screenEl) screenEl.scrollTop = 0;
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
        const hay = (label + ' ' + kw + ' ' + PANEL_TITLES[panel]).toLowerCase();
        return tokens.every(t => hay.includes(t));
    });
    groups.hidden = true; results.hidden = false; results.replaceChildren();
    if (!hits.length) {
        const empty = document.createElement('div');
        empty.className = 'explanatory-card';
        empty.textContent = 'No settings match “' + query.trim() + '”.';
        results.appendChild(empty);
        return;
    }
    for (const [panel, label, target] of hits) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'settings-row settings-result';
        const text = document.createElement('span'); text.className = 'settings-row-text';
        const t = document.createElement('span'); t.className = 'settings-row-title'; t.textContent = label;
        const s = document.createElement('span'); s.className = 'settings-row-sub'; s.textContent = PANEL_TITLES[panel];
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
