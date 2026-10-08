// ── Cross-browser shim ─────────────────────────────────────────────────────
// Safari/iOS Web Extensions expose ONLY the `browser.*` namespace; `chrome.*`
// is undefined there. Firefox exposes both but prefers `browser.*`. Alias
// chrome → browser so the rest of this script works unchanged on every platform.
if (typeof chrome === 'undefined' && typeof browser !== 'undefined') {
    globalThis.chrome = browser;
}

// Read-aloud engine (Chrome: service worker + chrome.tts; Firefox/Safari: background page + speechSynthesis).
try { if (typeof importScripts === 'function') importScripts('ttsEngine.js'); } catch (_) { /* listed in the manifest instead */ }
// Finishes a summary whose page went away while the model was still writing (same parsing + saving as the page does).
try { if (typeof importScripts === 'function') importScripts('finalize.js'); } catch (_) { /* listed in the manifest instead */ }
const FIN = globalThis.AISH_FINALIZE || null;
const ttsEngine = globalThis.AISH_TTS ? globalThis.AISH_TTS.create({ send: (m) => { try { const r = chrome.runtime.sendMessage(m); if (r && r.catch) r.catch(() => {}); } catch (_) { /* no listener */ } } }) : null;


// storage-keys:begin (generated from modules/storageKeys.js by scripts/sync-storage-keys.mjs — do not edit)
/* eslint-disable no-unused-vars */
/** logical name → storage key (chrome.storage.local) */
const SK = {
    // articles (schema v2: lean index + one heavy record per article)
    articlesIndex: 'articles:index',
    articlesSchema: 'articles:schema',
    // highlights / annotations (one array for all pages; per-page keys are a later step)
    annotations: 'hl:all',
    // feeds
    feedSubs: 'feeds:subs',
    feedItems: 'feeds:items',
    feedRecaps: 'feeds:recaps',
    feedSettings: 'feeds:settings',
    feedUi: 'feeds:ui',
    feedMood: 'feeds:mood',
    feedAudioPos: 'feeds:audioPos',
    feedBgSeen: 'feeds:bgSeen',
    feedPending: 'feeds:pending',
    // account / identity
    token: 'account:token',
    user: 'account:user',
    otpId: 'account:otpId',
    otpEmail: 'account:otpEmail',
    otpExpiresAt: 'account:otpExpiresAt',
    otpRequestedAt: 'account:otpRequestedAt',
    installId: 'account:installId',
    installedAt: 'account:installedAt',
    licenseKey: 'account:licenseKey',
    // send targets
    devices: 'send:devices',
    activeDevices: 'send:active',
    localSendIp: 'send:localIp',
    // podcasts
    podcasts: 'podcasts:list',
    podcastName: 'podcasts:lastName',
    podcastLength: 'podcasts:length',
    podcastStyle: 'podcasts:style',
    podcastCustomStyle: 'podcasts:customStyle',
    // ui state
    summaryMode: 'ui:summaryMode',
    summaryLength: 'ui:summaryLength',
    activityView: 'ui:activityView',
    workspace: 'ui:workspace',
    reviewPrompt: 'ui:reviewPrompt',
    exportAllQuestions: 'ui:exportAllQuestions',
    // configuration with secrets (API keys, endpoints) — never synced
    servicesConfig: 'config:services',
    // migration flags
    devicesMigrated: 'meta:devicesMigrated',
    migrationVersion: 'meta:version',
    keysSchema: 'meta:keys'        // 1 = keys renamed to the registry names (migrateStorageKeys ran)
};

const KEYS_SCHEMA = 1;

/** Prefix of the per-article record keys: articles:rec:<id> */
const ARTICLE_REC = 'articles:rec:';
const articleRecKey = (id) => ARTICLE_REC + id;
const isArticleRecKey = (k) => typeof k === 'string' && k.startsWith(ARTICLE_REC);

/** old (pre-registry) key → new key. Used by the migration and by backup import. */
const SK_LEGACY = {
    articlesIndex: SK.articlesIndex,
    articlesSchemaVersion: SK.articlesSchema,
    annotations: SK.annotations,
    feedSubs: SK.feedSubs,
    feedItems: SK.feedItems,
    feedRecaps: SK.feedRecaps,
    feedSettings: SK.feedSettings,
    feedUi: SK.feedUi,
    feedMoodDaily: SK.feedMood,
    feedAudioPos: SK.feedAudioPos,
    feedBgSeen: SK.feedBgSeen,
    feedPending: SK.feedPending,
    pb_token: SK.token,
    pb_user: SK.user,
    pending_otp_id: SK.otpId,
    pending_email: SK.otpEmail,
    pending_otp_expires_at: SK.otpExpiresAt,
    pending_otp_requested_at: SK.otpRequestedAt,
    installId: SK.installId,
    installedAt: SK.installedAt,
    licenseKey: SK.licenseKey,
    devices: SK.devices,
    activeDeviceIds: SK.activeDevices,
    localSendIp: SK.localSendIp,
    podcasts: SK.podcasts,
    lastPodcastName: SK.podcastName,
    podcastLength: SK.podcastLength,
    podcastStyle: SK.podcastStyle,
    podcastCustomStyle: SK.podcastCustomStyle,
    summaryMode: SK.summaryMode,
    summaryLength: SK.summaryLength,
    activityView: SK.activityView,
    ws_layout: SK.workspace,
    reviewPrompt: SK.reviewPrompt,
    servicesConfig: SK.servicesConfig,
    devicesMigrated: SK.devicesMigrated,
    migrationVersion: SK.migrationVersion
};
/** old per-article prefix */
const ARTICLE_REC_LEGACY = 'article:';
/** keys that no longer exist anywhere; removed by the migration */
const SK_DEAD = ['ghostHighlights', 'articleHistory'];

/** Every local key the app may hold (static ones; article records are a prefix). */
const LOCAL_KEY_LIST = Object.values(SK);

/** Translate one key from the old naming to the new one (identity if already new). */
function renameKey(k) {
    if (Object.prototype.hasOwnProperty.call(SK_LEGACY, k)) return SK_LEGACY[k];
    if (typeof k === 'string' && k.startsWith(ARTICLE_REC_LEGACY)) return ARTICLE_REC + k.slice(ARTICLE_REC_LEGACY.length);
    return k;
}
/** Translate a whole object (backup import). New names win over old ones. */
function renameKeys(obj) {
    const out = {};
    for (const k of Object.keys(obj || {})) { const n = renameKey(k); if (n === k || !(n in obj)) out[n] = obj[k]; }
    return out;
}

/**
 * One-time (idempotent) move of user data to the new key names in one storage area.
 * Order: write new → verify → remove old, so an interrupted run loses nothing and
 * can simply run again. `articles` (legacy v1 blob) is NOT touched here — the
 * articles migration in StorageManager merges it. Resolves to the number of keys moved.
 */
function migrateStorageKeys(area) {
    return new Promise((resolve) => {
        try {
            // Fast path: after the first run this costs one tiny read, not a get(null) of all data.
            area.get([SK.keysSchema], (flag) => {
                if (flag && flag[SK.keysSchema] >= KEYS_SCHEMA) return resolve(0);
                area.get(null, (all) => {
                    all = all || {};
                    const writes = {}; const olds = [];
                    for (const k of Object.keys(all)) {
                        const n = renameKey(k);
                        if (n === k) continue;
                        olds.push(k);
                        if (!(n in all)) writes[n] = all[k];
                    }
                    const dead = SK_DEAD.filter(k => k in all);
                    const done = () => area.set({ [SK.keysSchema]: KEYS_SCHEMA }, () => resolve(olds.length));
                    const finish = () => (olds.length || dead.length) ? area.remove([...olds, ...dead], done) : done();
                    const names = Object.keys(writes);
                    if (!names.length) return finish();
                    // chunk: one set() of many MB is slow and can hit per-call limits
                    let i = 0;
                    const next = () => {
                        if (i >= names.length) return finish();
                        const chunk = {}; for (const n of names.slice(i, i + 25)) chunk[n] = writes[n]; i += 25;
                        area.set(chunk, next);
                    };
                    next();
                });
            });
        } catch (_) { resolve(0); }
    });
}
/* eslint-enable no-unused-vars */
// storage-keys:end

// Move local keys to the registry names before any handler reads storage. The popup runs the
// same migration; it is idempotent, so whichever runs first wins and the other is a no-op.
const keysReady = migrateStorageKeys(chrome.storage.local);
const localGet = async (...a) => { await keysReady; return chrome.storage.local.get(...a); };

// Convert an ArrayBuffer to a base64 string in chunks — avoids blowing the
// call stack on large images (String.fromCharCode.apply on a huge array
// throws "Maximum call stack size exceeded").
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

// ── Context Menu ─────────────────────────────────────────────────────────────
// ── Uninstall feedback + review timing ───────────────────────────────────────
// Chrome opens this page after the extension is removed. Only the version and the days of use are
// appended — no ids, no content. Re-set on every worker start so "days" stays current.
const GOODBYE_URL = 'https://ai-summary-helper.byphil.eu/goodbye.html';
async function refreshUninstallUrl() {
    try {
        const { [SK.installedAt]: installedAt } = await localGet(SK.installedAt);
        const days = installedAt ? Math.max(0, Math.floor((Date.now() - installedAt) / 86400e3)) : '';
        chrome.runtime.setUninstallURL(`${GOODBYE_URL}?v=${encodeURIComponent(chrome.runtime.getManifest().version)}&d=${days}`);
    } catch (e) { /* not supported on this platform */ }
}
refreshUninstallUrl();
chrome.runtime.onInstalled.addListener(async () => {
    try {
        const { installedAt } = await chrome.storage.local.get('installedAt');
        if (!installedAt) await chrome.storage.local.set({ [SK.installedAt]: Date.now() });
    } catch (e) { /* ignore */ }
    refreshUninstallUrl();
});

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({ id: 'aish-highlight',        title: '✏️ Highlight selection',    contexts: ['selection'] });
        chrome.contextMenus.create({ id: 'aish-clear-highlights', title: '🧹 Remove all highlights',  contexts: ['page', 'selection'] });
        chrome.contextMenus.create({ id: 'sep1', type: 'separator',                                   contexts: ['page', 'selection'] });
        chrome.contextMenus.create({ id: 'aish-summarize',        title: '✨ Summarize this page',    contexts: ['page'] });
        chrome.contextMenus.create({ id: 'aish-summarize-close',  title: '✨ Summarize & close tab',  contexts: ['page'] });
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;
    if (info.menuItemId === 'aish-highlight') {
        chrome.tabs.sendMessage(tab.id, { action: 'contextMenuHighlight', text: info.selectionText }).catch(() => {});
    } else if (info.menuItemId === 'aish-clear-highlights') {
        chrome.tabs.sendMessage(tab.id, { action: 'contextMenuClearHighlights' }).catch(() => {});
    } else if (info.menuItemId === 'aish-summarize') {
        chrome.tabs.sendMessage(tab.id, { action: 'fetchSummary', summaryMode: 'extension' }).catch(() => {});
    } else if (info.menuItemId === 'aish-summarize-close') {
        chrome.tabs.sendMessage(tab.id, { action: 'fetchSummaryAndClose', summaryMode: 'extension' }).catch(() => {});
    }
});

// ── Decision Alarms ───────────────────────────────────────────────────────────
function decisionAlarmDelayMinutes(timeframe) {
    const now = new Date();
    switch (timeframe) {
        case 'tomorrow': return 24 * 60;
        case 'weekend': {
            const daysUntilSat = (6 - now.getDay() + 7) % 7 || 7;
            return daysUntilSat * 24 * 60;
        }
        case 'week':    return 7 * 24 * 60;
        default:        return null; // 'research' — no alarm, surface in UI
    }
}

// The articles:index / articles:rec:<id> migration only runs from popup.js's
// StorageManager.initialize() on popup open — this service worker can't run
// it itself (classic, non-module worker; storageManager.js's ES `import`
// syntax isn't usable via importScripts). An alarm can fire before the user
// ever reopens the popup after an update, while storage is still in the old
// shape, so fall back to the legacy 'articles' array in that narrow window.
async function findDecisionArticle(timestamp) {
    const { [SK.articlesIndex]: articlesIndex = [] } = await localGet({ [SK.articlesIndex]: [] });
    let article = articlesIndex.find(a => a.timestamp === timestamp && a.isDecision);
    if (article) return article;
    const { articles = [] } = await localGet({ articles: [] });
    return articles.find(a => a.timestamp === timestamp && a.isDecision) || null;
}

// ── Feeds: background polling + toolbar badge ────────────────────────────────
// Opt-in (Settings > Feeds > "Check in the background"). The service worker has
// no DOMParser, so it only extracts item links with a small regex pass and
// compares them with what the popup already stored. The first poll of a feed
// just records a baseline, so subscribing never produces a burst of "new".
const FEED_ALARM = 'feedPoll';

async function applyFeedPollConfig() {
    if (!chrome.alarms) return;
    const { [SK.feedSettings]: feedSettings } = await localGet(SK.feedSettings);
    await chrome.alarms.clear(FEED_ALARM);
    if (feedSettings && feedSettings.backgroundPoll) {
        chrome.alarms.create(FEED_ALARM, { delayInMinutes: 1, periodInMinutes: Math.max(15, feedSettings.refreshMinutes || 30) });
    } else {
        await clearFeedBadge();
    }
}

async function clearFeedBadge() {
    await chrome.storage.local.set({ [SK.feedPending]: 0 });
    try { await chrome.action.setBadgeText({ text: '' }); } catch (_) { /* badge reset is cosmetic */ }
}

function extractFeedLinks(xml) {
    const links = [];
    const re = /<(item|entry)[\s>][\s\S]*?<\/\1>/gi;
    let m;
    while ((m = re.exec(xml)) && links.length < 100) {
        const blk = m[0];
        let link = '';
        const tags = blk.match(/<link\b[^>]*>/gi) || [];
        for (const t of tags) {
            const rel = (t.match(/\brel=["']([^"']+)["']/i) || [])[1];
            const href = (t.match(/\bhref=["']([^"']+)["']/i) || [])[1];
            if (href && (!rel || rel === 'alternate')) { link = href; break; }
        }
        if (!link) {
            const inner = blk.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
            if (inner) link = inner[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
        }
        link = link.replace(/&amp;/g, '&');
        if (/^https?:\/\//i.test(link)) links.push(link);
    }
    return links;
}

async function pollFeeds() {
    try {
        const raw = await localGet({ [SK.feedSubs]: [], [SK.feedItems]: [], [SK.feedBgSeen]: {}, [SK.feedPending]: 0, [SK.feedSettings]: {} });
        const d = { feedSubs: raw[SK.feedSubs], feedItems: raw[SK.feedItems], feedBgSeen: raw[SK.feedBgSeen], feedPending: raw[SK.feedPending], feedSettings: raw[SK.feedSettings] };
        if (!d.feedSettings.backgroundPoll) return;
        const known = new Set(d.feedItems.map(i => i.link));
        const seen = d.feedBgSeen || {};
        let fresh = 0;
        for (const sub of d.feedSubs) {
            if (sub.muted) continue;
            try {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 15000);
                const res = await fetch(sub.url, { credentials: 'omit', redirect: 'follow', signal: ctrl.signal });
                clearTimeout(timer);
                if (!res.ok) continue;
                const links = extractFeedLinks((await res.text()).slice(0, 3 * 1024 * 1024));
                const prev = seen[sub.id];
                if (prev) {
                    const prevSet = new Set(prev);
                    fresh += links.filter(l => !prevSet.has(l) && !known.has(l)).length;
                }
                seen[sub.id] = [...new Set([...links, ...(prev || [])])].slice(0, 300);
            } catch (_) { /* skip this feed this round */ }
        }
        const pending = (d.feedPending || 0) + fresh;
        await chrome.storage.local.set({ [SK.feedBgSeen]: seen, [SK.feedPending]: pending });
        if (pending > 0) {
            await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
            await chrome.action.setBadgeText({ text: pending > 99 ? '99+' : String(pending) });
        }
    } catch (e) {
        console.warn('[feeds] poll failed', e);
    }
}

// ── One-shot AI completion (feed recaps, tone scoring) ──────────────────────
// Same connection logic as the page summarizer (byPhil Cloud, own key, or a
// local Ollama), but non-streaming and callable from any extension page.
if (typeof AishAudio !== 'undefined' && typeof Audio !== 'undefined') AishAudio.host();

const AISH_API_BASE = 'https://api.byphil.eu';

function aiFriendlyError(status, body) {
    const e = `${status} ${body || ''}`;
    if (/402|429|trial exhausted|requests per day|requests per week|quota|too many|rate/i.test(e)) {
        return 'You\u2019ve reached your free daily limit. Come back tomorrow \u2014 or upgrade to Pro for unlimited use.';
    }
    return `AI request failed (${status}${body ? ': ' + String(body).slice(0, 160) : ''})`;
}

function parseAiResponseText(raw) {
    const t = (raw || '').trim();
    // SSE (some providers stream even when asked not to): accumulate deltas.
    // NDJSON (Ollama's native /api/chat streams one JSON object per line, possibly "thinking" first, then "content").
    if (t.startsWith('{')) {
        let single = true;
        try { JSON.parse(t); } catch (_) { single = false; }
        if (!single) {
            let out = '';
            // One object per line, or objects glued together with just whitespace between them.
            for (const line of t.split(/\r?\n|(?<=\})\s+(?=\{)/)) { const d = aiDelta(line); if (d) out += d.text; }
            if (out.trim()) return out.trim();
        }
    }
    if (/^data:/m.test(t) && !t.startsWith('{')) {
        let out = '';
        for (const line of t.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
                const j = JSON.parse(payload);
                out += j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? j.message?.content
                    ?? (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('') ?? '';
            } catch (_) { /* ignore partial lines */ }
        }
        return out.trim();
    }
    let j;
    try { j = JSON.parse(t); } catch (_) { return t; }
    const gem = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    return String(j.choices?.[0]?.message?.content ?? j.message?.content ?? j.choices?.[0]?.text ?? gem ?? '').trim();
}

/** Text added by one SSE/NDJSON line: { text, think } (think = reasoning tokens of "thinking" models). */
function aiDelta(line) {
    line = line.trim();
    if (line.startsWith('data:')) line = line.slice(5).trim();
    if (!line || line === '[DONE]' || line[0] !== '{') return null;
    try {
        const j = JSON.parse(line);
        const d = j.choices?.[0]?.delta || {};
        const text = d.content ?? j.message?.content ?? (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('') ?? '';
        const think = d.reasoning_content ?? d.reasoning ?? j.message?.thinking ?? '';
        return { text: text || '', think: think || '' };
    } catch (_) { return null; }
}

const aiJobs = new Map(); // request id → AbortController, so the popup can cancel a slow (e.g. local) model
async function aiComplete({ system, user, id, partial }) {
    const sync = await chrome.storage.sync.get(['activeService', 'connectionMode', 'preferredCloudModel']).catch(() => ({}));
    const local = await localGet([SK.servicesConfig, SK.licenseKey, SK.token, SK.installId]).catch(() => ({}));
    const connectionMode = sync.connectionMode || 'cloud';
    let service = sync.activeService || 'openai';
    const cfg = (local[SK.servicesConfig] || {})[service] || {};
    const modelId = (m) => (!m ? '' : typeof m === 'string' ? m : (m.id || ''));

    let url = cfg.endpointUrl || cfg.endpoint;
    let model = modelId(cfg.activeModelId) || (Array.isArray(cfg.customModel) ? modelId(cfg.customModel[0]) : modelId(cfg.customModel)) || cfg.model;
    let apiKey = cfg.apiKey || '';
    let keyOptional = false;

    if (connectionMode === 'cloud') {
        service = 'cloud';
        url = `${AISH_API_BASE}/v1/projects/ai_summary_helper/chat`;
        model = sync.preferredCloudModel || 'google/gemini-3.8-flash';
        apiKey = local[SK.token] || local[SK.licenseKey] || '';
        keyOptional = true;
    } else {
        url = cfg.endpointUrl || url;
        model = cfg.modelIdentifier || model;
        try {
            const list = await (await fetch(chrome.runtime.getURL('services.json'))).json();
            const meta = list.find(x => (x.id || '').toLowerCase() === service.toLowerCase());
            if (meta) {
                keyOptional = !!meta.apiKeyOptional;
                url = url || meta.endpointUrl;
                model = model || meta.defaultModel;
            }
        } catch (_) { /* services.json unavailable */ }
        if (service === 'ollama') keyOptional = true;
    }
    if (!apiKey && !keyOptional) throw new Error('Set your API key under Settings \u203a Models & API first.');
    if (!url && service !== 'gemini') throw new Error('Model endpoint is not configured.');
    if (url) new URL(url);

    const headers = { 'Content-Type': 'application/json' };
    let body;
    if (service === 'gemini') {
        url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
        headers['x-goog-api-key'] = apiKey;
        body = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: `${system}\n\n${user}` }] }] });
    } else {
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        if (local[SK.installId]) headers['X-Install-ID'] = local[SK.installId];
        body = JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], stream: true });
    }

    // No timeout: local models can take minutes. The user cancels from the recap status card instead.
    const ctrl = new AbortController();
    if (id) aiJobs.set(id, ctrl);
    const progress = (p) => { if (id) { try { chrome.runtime.sendMessage({ action: 'aiProgress', id, ...p }, () => void chrome.runtime.lastError); } catch (_) { /* popup closed */ } } };
    try {
        let res = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal });
        // A provider that rejects "stream": true gets one retry without streaming.
        if ((res.status === 400 || res.status === 422) && service !== 'gemini') {
            res = await fetch(url, { method: 'POST', headers, body: body.replace('"stream":true', '"stream":false'), signal: ctrl.signal });
        }
        if (!res.ok) throw new Error(aiFriendlyError(res.status, await res.text()));
        progress({ phase: 'headers' });
        let raw = '';
        if (res.body && res.body.getReader) {
            const reader = res.body.getReader();
            const dec = new TextDecoder('utf-8');
            let buf = '', chars = 0, think = 0, last = 0, acc = '';
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                const chunk = dec.decode(value, { stream: true });
                raw += chunk; buf += chunk;
                const lines = buf.split('\n'); buf = lines.pop();
                let tail = '';
                for (const l of lines) { const d = aiDelta(l); if (d) { chars += d.text.length; think += d.think.length; tail += d.text; if (partial) acc += d.text; } }
                const now = Date.now();
                if (now - last > 250) { last = now; progress({ phase: 'stream', chars, think, tail: tail.slice(-80), ...(partial ? { text: acc } : {}) }); }
            }
            raw += dec.decode();
            progress({ phase: 'stream', chars, think, tail: '', ...(partial ? { text: acc } : {}) });
        } else raw = await res.text();
        const text = parseAiResponseText(raw);
        if (!text) throw new Error('The model returned an empty response.');
        return { text, model };
    } catch (e) {
        if (e.name === 'AbortError') throw new Error('The AI request was cancelled.');
        throw e;
    } finally {
        if (id) aiJobs.delete(id);
    }
}

chrome.runtime.onStartup.addListener(() => { applyFeedPollConfig(); });
chrome.runtime.onInstalled.addListener(() => { applyFeedPollConfig(); });

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === FEED_ALARM) { pollFeeds(); return; }
    if (!alarm.name.startsWith('decision_')) return;
    const timestamp = alarm.name.replace('decision_', '');
    const article = await findDecisionArticle(decodeURIComponent(timestamp));
    if (!article) return;
    chrome.notifications.create(`decision_notif_${timestamp}`, {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: '🔖 Ready to review?',
        message: article.title || article.url,
        contextMessage: article.decisionReason || '',
        buttons: [{ title: 'Open' }, { title: 'Dismiss' }],
        requireInteraction: true
    });
});

chrome.notifications.onButtonClicked.addListener(async (notifId, btnIdx) => {
    if (!notifId.startsWith('decision_notif_')) return;
    const timestamp = notifId.replace('decision_notif_', '');
    const article = await findDecisionArticle(decodeURIComponent(timestamp));
    if (!article) return;
    if (btnIdx === 0 && article.url) chrome.tabs.create({ url: article.url });
    chrome.notifications.clear(notifId);
});

// Sync side panel behavior with user setting
function updateSidePanelBehavior(useNative) {
    try {
        chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: !!useNative });
    } catch (e) {
        // Silently ignore if sidePanel API is unavailable
    }
}

// Initialize on startup
chrome.storage.sync.get('useNativeSidePanel', (data) => {
    updateSidePanelBehavior(data.useNativeSidePanel);
});

// React to setting changes in real time
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.useNativeSidePanel) {
        updateSidePanelBehavior(changes.useNativeSidePanel.newValue);
    }
});


// ── Feed background tabs ────────────────────────────────────────────────────
// Tabs opened by the Feeds screen in extension mode. Kept in storage.session
// (when available) so a restarted service worker still knows which tabs to close.
const feedTabsMem = new Set();
async function readFeedTabs() {
    try {
        if (chrome.storage.session) {
            const d = await chrome.storage.session.get({ feedBgTabs: [] });
            return new Set(d.feedBgTabs);
        }
    } catch (_) { /* session storage unavailable → in-memory copy below */ }
    return feedTabsMem;
}
async function writeFeedTabs(set) {
    feedTabsMem.clear(); set.forEach(v => feedTabsMem.add(v));
    try { if (chrome.storage.session) await chrome.storage.session.set({ feedBgTabs: [...set] }); } catch (_) { /* session storage unavailable (older Firefox): the in-memory copy is kept */ }
}
async function trackFeedTab(tabId) {
    const set = await readFeedTabs(); set.add(tabId); await writeFeedTabs(set);
}
async function untrackFeedTab(tabId, closeNow = false, delay = 0) {
    const set = await readFeedTabs();
    if (!set.has(tabId)) return;
    set.delete(tabId); await writeFeedTabs(set);
    setTimeout(() => chrome.tabs.remove(tabId).catch(() => {}), closeNow ? 0 : delay);
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.action === 'ttsCmd') {
        if (!ttsEngine) { sendResponse({ ok: false, available: false }); return false; }
        ttsEngine.handle(msg).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
        return true;
    }
    // Dummy endpoint to force Safari to wake the background script before a
    // long-lived connection is attempted. Safari reliably wakes workers for
    // runtime.sendMessage, but may fail a runtime.connect() while asleep.
    if (msg.action === 'wakeup') {
        sendResponse({ status: 'awake' });
        return true; // Keep the message channel open for the response
    }

    // ── Feeds (RSS reader) ──────────────────────────────────────────────
    if (msg.action === 'aiComplete' && msg.user) {
        aiComplete({ system: msg.system || '', user: msg.user, id: msg.id, partial: !!msg.partial })
            .then(r => sendResponse({ ok: true, text: r.text, model: r.model }))
            .catch(e => sendResponse({ ok: false, error: e.message || 'AI request failed' }));
        return true;
    }
    if (msg.action === 'aiCancel') { const c = aiJobs.get(msg.id); if (c) c.abort(); sendResponse({ ok: true }); return true; }
    if (msg.action === 'feedPollConfig') { applyFeedPollConfig().then(() => sendResponse({ ok: true })); return true; }
    if (msg.action === 'audioEnsure') {
        // Chrome: audio must live in an offscreen document. Others: the background page hosts it.
        if (chrome.offscreen && chrome.offscreen.createDocument) {
            (async () => {
                try {
                    const has = chrome.runtime.getContexts
                        ? (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0 : false;
                    if (!has) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'], justification: 'Play podcast episodes from feeds while the popup is closed' });
                    sendResponse({ ok: true });
                } catch (e) { sendResponse({ ok: false, error: String(e && e.message || e) }); }
            })();
            return true;
        }
        sendResponse({ ok: typeof AishAudio !== 'undefined' });
        return false;
    }
    if (msg.action === 'feedBadgeClear') { clearFeedBadge().then(() => sendResponse({ ok: true })); return true; }

    // Fetch a feed or site page on behalf of the popup. Returns raw text; the
    // popup parses it (DOMParser doesn't exist in this service worker).
    if (msg.action === 'fetchFeedText' && msg.url) {
        (async () => {
            try {
                if (!/^https?:\/\//i.test(msg.url)) throw new Error('Unsupported address');
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 15000);
                const res = await fetch(msg.url, {
                    credentials: 'omit',
                    redirect: 'follow',
                    signal: ctrl.signal,
                    headers: { 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5' }
                });
                clearTimeout(timer);
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const text = (await res.text()).slice(0, 3 * 1024 * 1024);
                sendResponse({ ok: true, text, url: res.url || msg.url, contentType: res.headers.get('content-type') || '' });
            } catch (e) {
                sendResponse({ ok: false, error: e.name === 'AbortError' ? 'Timed out' : (e.message || 'Request failed') });
            }
        })();
        return true;
    }

    // Open a feed item in a new tab; optionally summarize it once the page has
    // loaded, following the mode last picked on the Summarize screen:
    //   inline    → foreground tab, summary inserted into the page
    //   extension → background tab, summary streams to the popup/History and the
    //               tab closes itself when done
    if (msg.action === 'openFeedItem' && msg.url) {
        if (!/^https?:\/\//i.test(msg.url)) { sendResponse({ success: false }); return false; }
        (async () => {
            let mode = 'extension';
            let summaryLength = 200;
            if (msg.summarize) {
                const d = await localGet([SK.summaryMode, SK.summaryLength]).catch(() => ({}));
                mode = (d[SK.summaryMode] === 'inline' && !msg.forceExtension) ? 'inline' : 'extension';
                summaryLength = d[SK.summaryLength] || 200;
            }
            const background = !!msg.summarize && mode === 'extension';
            const normKey = (u) => {
                try {
                    const x = new URL(u);
                    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','fbclid','gclid','ref','source'].forEach(k => x.searchParams.delete(k));
                    const qs = x.searchParams.toString();
                    return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + (qs ? '?' + qs : '')).toLowerCase();
                } catch (_) { return String(u || '').toLowerCase().trim(); }
            };
            // Is the page already open somewhere? Then reuse that tab.
            let existing = null;
            try {
                const want = normKey(msg.url);
                const all = await chrome.tabs.query({});
                existing = all.find(tb => tb.url && normKey(tb.url) === want) || null;
            } catch (_) { /* tab list unavailable → fall back to opening a new tab */ }

            const startSummary = (tabId, track) => {
                const start = async (attempt = 0) => {
                    try {
                        await chrome.tabs.sendMessage(tabId, { action: 'ping' });
                    } catch (e) {
                        if (attempt === 2) {
                            try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); } catch (_) { /* restricted page cannot be scripted; the retry loop handles it */ }
                        }
                        if (attempt < 6) return setTimeout(() => start(attempt + 1), 800);
                        if (track) untrackFeedTab(tabId, true);
                        return;
                    }
                    chrome.tabs.sendMessage(tabId, { action: 'fetchSummary', summaryMode: mode, summaryLength, feedUrl: msg.url }).catch(() => {});
                };
                return start;
            };

            if (existing) {
                // Already open: never open it again; never close it afterwards (it's the user's tab).
                if (!msg.summarize || mode === 'inline') {
                    try { await chrome.tabs.update(existing.id, { active: true }); await chrome.windows.update(existing.windowId, { focused: true }); } catch (_) { /* focusing the existing tab is best-effort */ }
                }
                if (msg.summarize) startSummary(existing.id, false)();
                sendResponse({ success: true, mode: msg.summarize ? mode : null, reused: true });
                return;
            }

            chrome.tabs.create({ url: msg.url, active: !background }, (tab) => {
                if (!msg.summarize || !tab) return;
                const tabId = tab.id;
                if (background) trackFeedTab(tabId);
                const start = startSummary(tabId, background);
                const onUpdated = (id, info) => {
                    if (id !== tabId || info.status !== 'complete') return;
                    chrome.tabs.onUpdated.removeListener(onUpdated);
                    start();
                };
                chrome.tabs.onUpdated.addListener(onUpdated);
                // Safety: stop listening if the tab never finishes loading.
                setTimeout(() => chrome.tabs.onUpdated.removeListener(onUpdated), 60000);
            });
            sendResponse({ success: true, mode: msg.summarize ? mode : null });
        })();
        return true;
    }

    // A feed-opened background tab reports it's finished → close it shortly
    // after (the content script saves the article right after relaying).
    if ((msg.action === 'summaryComplete' || msg.action === 'summaryError') && sender.tab) {
        untrackFeedTab(sender.tab.id, false, msg.action === 'summaryComplete' ? 6000 : 8000);
    }

    // ── Tab proxy handlers ──────────────────────────────────────────────
    // When popup.html is loaded inside an <iframe> embedded in a regular web
    // page (the hybrid sidebar), Firefox downgrades that iframe to
    // content-script-level privileges: `chrome.tabs` is undefined there. The
    // background page always has full privileges on every platform, so these
    // handlers do the real tab work on behalf of any context that can't reach
    // `chrome.tabs` directly.
    if (msg.action === 'getActiveTab') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs && tabs[0];
            sendResponse({ success: !!tab, tab: tab ? { id: tab.id, url: tab.url } : null });
        });
        return true;
    }

    if (msg.action === 'relayToActiveTab' && msg.message) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs && tabs[0];
            if (!tab) {
                sendResponse({ success: false, error: 'No active tab' });
                return;
            }
            chrome.tabs.sendMessage(tab.id, msg.message, (response) => {
                if (chrome.runtime.lastError) {
                    sendResponse({ success: false, error: chrome.runtime.lastError.message });
                    return;
                }
                sendResponse({ success: true, response });
            });
        });
        return true;
    }

    if (msg.action === 'sendLocalSendP2P') {
        const method = msg.method || 'POST';
        const isJson = msg.isJson !== false;
        const headers = msg.headers || {
            'Content-Type': isJson ? 'application/json' : 'application/octet-stream'
        };
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        let body = msg.body;
        if (isJson) {
            body = typeof body === 'string' ? body : JSON.stringify(body);
        } else if (Array.isArray(body)) {
            // Reconstruct byte payload sent as number array through runtime messaging.
            body = new Uint8Array(body).buffer;
        }

        fetch(msg.targetUrl, {
            method,
            headers,
            body: method === 'GET' || method === 'HEAD' ? undefined : body,
            signal: controller.signal
        })
            .then(async (res) => {
                clearTimeout(timeout);
                const text = await res.text();
                let data = null;
                try {
                    data = text ? JSON.parse(text) : null;
                } catch (_) {
                    data = null;
                }

                sendResponse({
                    success: true,
                    ok: res.ok,
                    status: res.status,
                    data,
                    text
                });
            })
            .catch((err) => {
                clearTimeout(timeout);
                sendResponse({ success: false, error: err?.message || 'Network request failed' });
            });

        return true;
    }

    if (msg.action === 'openNativeSidePanel') {
        // Native side panel is Chrome-only. On Firefox/Safari/iOS the
        // `sidePanel` API is undefined — fall back to the hybrid sidebar.
        if (!chrome.sidePanel) {
            sendResponse({ success: false, error: 'sidePanel API not available' });
            return;
        }
        // Use sender.tab.windowId to target the correct window
        const windowId = sender?.tab?.windowId;
        if (windowId) {
            chrome.sidePanel.open({ windowId })
                .then(() => sendResponse({ success: true }))
                .catch(err => sendResponse({ error: err.message }));
        } else {
            // Fallback: try all windows
            chrome.windows.getAll({}, (windows) => {
                if (windows.length > 0) {
                    chrome.sidePanel.open({ windowId: windows[0].id })
                        .then(() => sendResponse({ success: true }))
                        .catch(err => sendResponse({ error: err.message }));
                }
            });
        }
        return true;
    }

    // Close the tab after "Summarize & Close" completes
    if (msg.action === 'closeTabSelf' && sender.tab) {
        chrome.tabs.remove(sender.tab.id);
        return true;
    }

    // Schedule an alarm for a decision slip (article with embedded decision metadata)
    if (msg.action === 'scheduleDecisionAlarm' && msg.article) {
        const timeframe = msg.article.decisionTimeframe;
        const delayMins = decisionAlarmDelayMinutes(timeframe);
        if (delayMins) {
            // Use encoded timestamp as alarm name to uniquely identify the article
            chrome.alarms.create(`decision_${encodeURIComponent(msg.article.timestamp)}`, { delayInMinutes: delayMins });
        }
        return true;
    }

    // Fetch a (possibly cross-origin / http:// on an https:// page) image
    // on behalf of a content script and return it as a data URL. Content
    // scripts must not fetch() third-party images directly — Safari applies
    // the *page's* CORS/mixed-content rules to content-script fetches
    // regardless of the extension's host_permissions, unlike Chrome. The
    // background page is a genuine privileged context, so it can fetch
    // cross-origin freely.
    if (msg.action === 'fetchImageAsDataUrl' && msg.url) {
        (async () => {
            try {
                const res = await fetch(msg.url);
                if (!res.ok) {
                    sendResponse({ success: false, error: `HTTP ${res.status}` });
                    return;
                }
                const contentType = res.headers.get('content-type') || 'image/jpeg';
                const buf = await res.arrayBuffer();
                const dataUrl = `data:${contentType};base64,${arrayBufferToBase64(buf)}`;
                sendResponse({ success: true, dataUrl });
            } catch (err) {
                sendResponse({ success: false, error: err?.message || 'Image fetch failed' });
            }
        })();
        return true;
    }

    // Fetch PDF bytes on behalf of a content script, bypassing page-level
    // CORS. Content scripts follow the *page's* CORS rules for their own
    // network requests (since Chrome 73), regardless of the extension's
    // host_permissions — so an embedded PDF from a cross-origin host (e.g.
    // Sci-Hub's embed pointing at a different domain) would fail to a
    // content-script fetch. The background service worker is a genuinely
    // privileged context, so it can fetch cross-origin freely (same
    // precedent as fetchImageAsDataUrl above).
    if (msg.action === 'fetchPdfBytes' && msg.url) {
        fetch(msg.url, { credentials: 'include' })
            .then(r => {
                if (r.status === 401 || r.status === 402 || r.status === 403) { const e = new Error('Login required'); e.code = 'LOGIN'; throw e; }
                if (!r.ok) throw new Error(`Failed to fetch PDF (${r.status})`);
                return r.arrayBuffer();
            })
            .then(buf => {
                // base64 in chunks: a number array of a 20 MB PDF is ~100 MB of JSON and often fails to arrive.
                const u = new Uint8Array(buf);
                let bin = '';
                for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
                sendResponse({ success: true, base64: btoa(bin) });
            })
            .catch(err => sendResponse({ success: false, error: err.message, code: err.code }));
        return true;
    }

    // Start a streaming fetch — message-based (not runtime.connect/ports).
    // Safari's background page is a non-persistent event page, and it does
    // Safari's background page is a non-persistent event page, and it does
    // NOT reliably re-register onConnect listeners after being suspended and
    // woken back up — content scripts calling runtime.connect() at that
    // moment get "No runtime.onConnect listeners found" even after a wakeup
    // ping + retries. runtime.sendMessage / tabs.sendMessage do not have
    // this problem, so we push each chunk back to the tab individually
    // instead of relying on a long-lived port.
    if (msg.action === 'runDetached' && msg.requestId) { markDetached(msg.requestId); sendResponse({ ok: true }); return false; }
    if (msg.action === 'runSaved' && msg.requestId) { const r = runs.get(msg.requestId); if (r) { r.saved = true; runs.delete(msg.requestId); } sendResponse({ ok: true }); return false; }

    if (msg.action === 'stopFetch' && msg.requestId) {
        const c = activeStreams.get(msg.requestId);
        if (c) { stoppedStreams.add(msg.requestId); c.abort(); }
        sendResponse({ stopped: !!c });
        return false;
    }

    if (msg.action === 'startFetch' && msg.requestId) {
        // Fallback: Safari sometimes omits sender.tab.id in
        // chrome.runtime.onMessage for content scripts. If it's missing,
        // resolve the active tab so we can push chunks back to it.
        const handleStart = async () => {
            let tabId = sender?.tab?.id;
            if (tabId == null) {
                const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                tabId = activeTab?.id;
            }

            if (tabId == null) {
                console.error('[AISH Background] No active tab found for startFetch');
                return;
            }

            handleStreamFetch(msg, tabId);
        };

        handleStart();
        // Respond synchronously WITHOUT return true, so the handshake is
        // acknowledged immediately. In Safari, an async sendResponse paired
        // with `return true` can close the message port pre-emptively and
        // surface "The message port closed before a response was received".
        sendResponse({ started: true });
        return false;
    }
});

chrome.commands.onCommand.addListener((command) => {
    if (command === 'toggle-popup') {
        chrome.action.openPopup();
    } else if (command === 'fetch-summary') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'fetchSummary' });
        });
    }
});

// Performs the streaming fetch on behalf of the content script and pushes
// each chunk back via chrome.tabs.sendMessage (see comment above for why
// this replaces the old runtime.connect()-based approach).
// Running streams by requestId so the popup's Stop button can abort one (stopFetch).
const activeStreams = new Map();

// Summaries in flight: requestId → { ctx, parser, tabId, detached, done, saved }. The page normally finishes them;
// when its tab navigates away or closes first, the background does (see finishRun).
const runs = new Map();
const broadcast = (m) => { try { const r = chrome.runtime.sendMessage(m); if (r && r.catch) r.catch(() => {}); } catch (_) { /* nobody listening */ } };
function markDetached(requestId) {
    const r = runs.get(requestId);
    if (!r || r.saved) return;
    r.detached = true;
    if (r.done) finishRun(r);
}
async function finishRun(r) {
    if (r.finishing || r.saved || !FIN) return;
    r.finishing = true;
    try {
        r.parser.end();
        const out = await FIN.finishDetached(r.ctx, r.parser.summary, r.parser.thinking);
        if (out.error) { if (r.ctx.summaryMode === 'extension') broadcast({ action: 'summaryError', error: out.error }); return; }
        if (r.ctx.summaryMode === 'extension') {
            broadcast({ action: 'summaryComplete', summary: out.cleanHtml, title: out.title, url: r.ctx.sourceUrl, timestamp: new Date().toISOString(), tags: out.tags, modelId: r.ctx.modelIdentifier, moodScore: out.moodScore, questions: out.questions, meta: out.pageMeta, content: r.ctx.contentHtml });
        }
        if (out.article && out.article.id) broadcast({ action: 'summarySaved', id: out.article.id, url: r.ctx.sourceUrl });
    } catch (e) {
        console.error('[AISH Background] Could not finish the summary of a closed page:', e);
    } finally { r.saved = true; runs.delete(r.id); }
}
try {
    chrome.tabs.onUpdated.addListener((tabId, info) => {
        if (info && info.status === 'loading') for (const r of runs.values()) if (r.tabId === tabId) markDetached(r.id);
    });
    chrome.tabs.onRemoved.addListener((tabId) => { for (const r of runs.values()) if (r.tabId === tabId) markDetached(r.id); });
} catch (_) { /* tabs API unavailable */ }
const stoppedStreams = new Set();

async function handleStreamFetch(msg, tabId) {
    const { requestId, apiUrl, headers, body } = msg;
    const push = (payload) => chrome.tabs.sendMessage(tabId, { action: 'streamChunk', requestId, payload }).catch(() => {});

    const startedAt = Date.now();
    const controller = new AbortController();
    activeStreams.set(requestId, controller);
    let run = null;
    if (msg.detach && FIN) {
        run = { id: requestId, ctx: msg.detach, parser: FIN.createStreamParser(msg.detach.service), tabId, detached: false, done: false, saved: false, lastRelay: 0, startedAt };
        runs.set(requestId, run);
    }

    // No timeout while we wait for the first byte: the model may be reading a long page (local models, thinking models) and the UI
    // shows the elapsed time via the heartbeat, with a Stop button — the user decides, not a fixed clock.
    // Once the stream is flowing we only guard against a connection that goes silent mid-stream: the timer resets on every chunk
    // and aborts after IDLE_TIMEOUT_MS without data.
    const IDLE_TIMEOUT_MS = 300000;
    let timeoutId = null;
    const armTimeout = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
    };
    const clearTimeoutHandle = () => {
        if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
    };

    let heartbeatId = null;
    let chunkCount = 0;
    let byteCount = 0;

    try {
        push({ meta: 'request-started', requestId, url: apiUrl });

        heartbeatId = setInterval(() => {
            push({ meta: 'heartbeat', requestId, elapsedMs: Date.now() - startedAt, chunkCount, byteCount });
        }, 3000);

        const response = await fetch(apiUrl, { method: 'POST', headers, body, signal: controller.signal });

        push({ meta: 'response', requestId, status: response.status, contentType: response.headers.get('content-type') || '' });

        if (!response.ok) {
            if (heartbeatId) clearInterval(heartbeatId);
            clearTimeoutHandle();
            push({ error: `HTTP ${response.status}: ${await response.text()}` });
            return;
        }

        if (!response.body) {
            if (heartbeatId) clearInterval(heartbeatId);
            clearTimeoutHandle();
            push({ error: 'No response body received from API.' });
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');

        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                if (heartbeatId) clearInterval(heartbeatId);
                clearTimeoutHandle();
                push({ meta: 'stream-complete', requestId, elapsedMs: Date.now() - startedAt, chunkCount, byteCount });
                push({ done: true });
                if (run) { run.done = true; run.parser.end(); if (run.detached) finishRun(run); else setTimeout(() => { if (!run.detached) runs.delete(requestId); }, 180000); }
                break;
            }

            chunkCount += 1;
            byteCount += value?.byteLength || 0;

            const decoded = decoder.decode(value, { stream: true });
            if (chunkCount <= 2) {
                push({ meta: 'chunk-preview', requestId, chunkCount, preview: decoded.slice(0, 120) });
            }

            push({ chunk: decoded });
            if (run) {
                run.parser.push(decoded);
                const now = Date.now();
                if (run.detached && run.ctx.summaryMode === 'extension' && now - run.lastRelay > 250) {
                    run.lastRelay = now;
                    const words = run.parser.summary.split(/\s+/).filter(Boolean).length;
                    const pct = Math.min(99, Math.max(30, Math.round((words / (Number(run.ctx.summaryLength) || 200)) * 100)));
                    broadcast({ action: 'summaryProgress', chunk: `${words} words · ${Math.floor((now - startedAt) / 1000)}s · ${pct}%`, preview: run.parser.summary, progress: pct });
                }
            }
            armTimeout();
        }
    } catch (err) {
        if (heartbeatId) clearInterval(heartbeatId);
        clearTimeoutHandle();
        if (stoppedStreams.delete(requestId)) { runs.delete(requestId); push({ stopped: true }); return; }
        const errorMessage = err?.name === 'AbortError'
            ? `Request timed out after ${IDLE_TIMEOUT_MS / 1000}s of inactivity`
            : err.message;
        push({ error: errorMessage });
        if (run) { if (run.detached && run.ctx.summaryMode === 'extension') broadcast({ action: 'summaryError', error: errorMessage }); runs.delete(requestId); }
    } finally {
        activeStreams.delete(requestId);
    }
}