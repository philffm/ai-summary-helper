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
try { if (typeof importScripts === 'function') importScripts('builtinAi.js'); } catch (_) { /* listed in the manifest instead */ }
try { if (typeof importScripts === 'function') importScripts('feed-worker.js'); } catch (_) { /* listed in the manifest instead */ }
try { if (typeof importScripts === 'function') importScripts('inbox-worker.js'); } catch (_) { /* listed in the manifest instead */ }
try { if (typeof importScripts === 'function') importScripts('targets-worker.js'); } catch (_) { /* listed in the manifest instead */ }
try { if (typeof importScripts === 'function') importScripts('mcp-worker.js'); } catch (_) { /* listed in the manifest instead */ }
try { if (typeof importScripts === 'function') importScripts('sync-worker.js'); } catch (_) { /* listed in the manifest instead */ }
const FIN = globalThis.AISH_FINALIZE || null;
const INBOX = globalThis.AISH_INBOX || null;
const TARGETS = globalThis.AISH_TARGETS || null;
const FEED_WORKER = globalThis.AISH_FEED_WORKER || null;
const MCP = globalThis.AISH_MCP || null;
const SYNC = globalThis.AISH_SYNC || null;
const ttsEngine = globalThis.AISH_TTS ? globalThis.AISH_TTS.create({ send: (m) => { try { const r = chrome.runtime.sendMessage(m); if (r && r.catch) r.catch(() => {}); } catch (_) { /* no listener */ } } }) : null;


// storage-keys:begin (generated from modules/storageKeys.js by scripts/sync-storage-keys.mjs — do not edit)
/* eslint-disable no-unused-vars */
/** logical name → storage key (chrome.storage.local) */
const SK = {
    // articles (schema v2: lean index + one heavy record per article)
    articlesIndex: 'articles:index',
    articlesSchema: 'articles:schema',
    // derived: per-article term vectors and nearest neighbours for the graph (graphSimilarityCache.js); rebuilt on demand, never backed up
    graphSim: 'graph:sim',
    // highlights: one key per page (hl:page:<pageKey>, see HL_PAGE) plus a lean index; written only through highlightStore.js
    hlIndex: 'hl:index',      // [{ k: pageKey, n: active, d: dismissed, t: ISO time }]
    hlSchema: 'hl:schema',    // 2 = per-page keys (migrateHighlightsToPages ran)
    // the old single list of all highlights (schema 1). Read by the migration and by old backups only.
    annotations: 'hl:all',
    // feeds
    feedSubs: 'feeds:subs',
    feedItems: 'feeds:items',
    feedRecaps: 'feeds:recaps',
    feedSettings: 'feeds:settings',
    feedUi: 'feeds:ui',
    feedMood: 'feeds:mood',
    feedAudioPos: 'feeds:audioPos',
    feedBackground: 'feeds:background',
    feedBgSeen: 'feeds:bgSeen',
    feedPending: 'feeds:pending',
    feedSync: 'feeds:sync',         // feed-URL vault: revision and the merged list as of the last sync (feedSync.js)
    // learned topic names across languages (topicLexicon.js)
    topicLexicon: 'topics:lexicon',
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
    // phone inbox: links shared from the phone arrive through the byPhil inbox (inboxManager.js)
    inboxConfig: 'inbox:config',     // inbox id, encryption key, write and read tokens — secret, never backed up
    inboxPending: 'inbox:pending',   // links from the phone that wait for the user (Summarize / Dismiss)
    inboxState: 'inbox:state',       // cursor, acknowledged cursor, handled item ids, last poll time and error
    // send targets (targets/*): connections hold no secrets; secrets are one key so backup filtering stays simple
    targetConnections: 'targets:connections',
    targetSecrets: 'targets:secrets',        // { [connectionId]: {...} } — secret, never backed up without opt-in
    targetList: 'targets:list',
    targetDefault: 'targets:default',
    targetOutbox: 'targets:outbox',          // open send jobs — transient, never backed up or restored
    // podcasts
    podcasts: 'podcasts:list',
    podcastName: 'podcasts:lastName',
    podcastLength: 'podcasts:length',
    podcastStyle: 'podcasts:style',
    podcastCustomStyle: 'podcasts:customStyle',
    // ui state
    summaryMode: 'ui:summaryMode',
    summaryLength: 'ui:summaryLength',
    summaryLengthMode: 'ui:summaryLengthMode',   // 'auto' | 'custom' (absent = auto for new installs, custom when a number was saved earlier)
    summaryLengthBias: 'ui:summaryLengthBias',   // 'short' | 'standard' | 'long' (scales the automatic length)
    activityView: 'ui:activityView',
    workspace: 'ui:workspace',
    reviewPrompt: 'ui:reviewPrompt',
    exportAllQuestions: 'ui:exportAllQuestions',
    lastCollection: 'ui:lastCollection',   // id of the collection a page was last added to (pre-selected in the "Add to collection" sheet)
    collStats: 'ui:collStats',             // local counters for the collections feature ({event: count}); no content, never leaves the device
    storageHint: 'ui:storageHint',         // when the "free up space" hint was last dismissed (ISO time)
    // collections: a question and the saved articles that answer it (index = list data, records: coll:rec:<id>)
    collIndex: 'coll:index',
    // configuration with secrets (API keys, endpoints) — never synced
    servicesConfig: 'config:services',
    // AI apps on this computer (MCP relay, aish-mcp) — off by default (claude/prd-local-mcp.md)
    mcpConfig: 'mcp:config',      // { enabled, port, scopes, excludeTag }
    mcpSecret: 'mcp:secret',      // pairing token — never backed up
    mcpLog: 'mcp:log',            // last 50 call records — never backed up
    // library sync (claude/prd-library-sync): this device's id. Never backed up or restored: two devices must not share one.
    syncDeviceId: 'sync:deviceId',
    // the places (WebDAV, S3, folder) this device syncs with: [{ id, name, service, url, root, mode, direction, include, filter, enabled }]. No secrets. Per device, never backed up.
    syncPlaces: 'sync:places',
    // the servers (WebDAV, S3, ...) places live on: [{ id, name, service, url, username }]. One server can hold several places (folders). No secrets.
    syncConnections: 'sync:connections',
    syncSecrets: 'sync:secrets', // { [connectionId]: { password | accessKey/secret | key } } — secret, never backed up
    cloudRoute: 'cloud:route',   // { region: 'eu' | 'global', model, at }: the route the hosted service reported for the last request (transient)
    syncStatus: 'sync:status',   // { [placeId]: { at, ok, error, counts } } last run per place
    syncClock: 'sync:clock',     // { t }: highest stamp time this device has made or seen
    // notes (Notes tab): your own notes and the comments on highlights. One key per note, plus a lean index. Backed up with everything else.
    notesIndex: 'notes:index',
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

/** Prefix of the per-page highlight keys: hl:page:<pageKey> (pageKeyForUrl, the same key the page script computes). */
const HL_PAGE = 'hl:page:';
const hlPageKey = (pageKey) => HL_PAGE + pageKey;
const isHlPageKey = (k) => typeof k === 'string' && k.startsWith(HL_PAGE);

/** Prefix of the per-collection record keys: coll:rec:<id> (name, question, source article ids, notes). */
const COLL_REC = 'coll:rec:';
const collRecKey = (id) => COLL_REC + id;
const isCollRecKey = (k) => typeof k === 'string' && k.startsWith(COLL_REC);

/** Prefix of the per-target ledger keys: targets:ledger:<targetId> (what was sent where). */
const TARGET_LEDGER = 'targets:ledger:';
const targetLedgerKey = (id) => TARGET_LEDGER + id;
const isTargetLedgerKey = (k) => typeof k === 'string' && k.startsWith(TARGET_LEDGER);

/** Prefix of the note records: notes:rec:<id> (kind 'note' or 'comment', text, tags, url, quote). */
const NOTES_REC = 'notes:rec:';
const noteRecKey = (id) => NOTES_REC + id;
const isNoteRecKey = (k) => typeof k === 'string' && k.startsWith(NOTES_REC);

/** Prefix of the sync stamp sidecars: sync:stamps:<hh> (revision stamps per record, sharded by id hash). Per device, never backed up. */
const SYNC_STAMPS = 'sync:stamps:';
const syncStampsKey = (hh) => SYNC_STAMPS + hh;
const isSyncStampsKey = (k) => typeof k === 'string' && k.startsWith(SYNC_STAMPS);

/** Prefix of the per-place ledgers: sync:ledger:<placeId> (what that place holds: id → pushed rev, etag, excluded). */
const SYNC_LEDGER = 'sync:ledger:';
const syncLedgerKey = (placeId) => SYNC_LEDGER + placeId;
const isSyncLedgerKey = (k) => typeof k === 'string' && k.startsWith(SYNC_LEDGER);

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
const localSet = async (obj) => { await keysReady; return new Promise((resolve) => chrome.storage.local.set(obj, resolve)); };

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
    if (!chrome.contextMenus) return;   // iOS Safari has no context menus
    chrome.contextMenus.removeAll(() => {
        // Titles follow the browser language (_locales); English is the fallback.
        const t = (key, fallback) => { try { return chrome.i18n.getMessage(key) || fallback; } catch (_) { return fallback; } };
        chrome.contextMenus.create({ id: 'aish-highlight',        title: t('ctxHighlightSelection', '✏️ Highlight selection'),   contexts: ['selection'] });
        chrome.contextMenus.create({ id: 'aish-clear-highlights', title: t('ctxRemoveHighlights', '🧹 Remove all highlights'),   contexts: ['page', 'selection'] });
        chrome.contextMenus.create({ id: 'sep1', type: 'separator',                                                             contexts: ['page', 'selection'] });
        chrome.contextMenus.create({ id: 'aish-summarize',        title: t('ctxSummarizePage', '✨ Summarize this page'),        contexts: ['page'] });
        chrome.contextMenus.create({ id: 'aish-speedread',        title: t('ctxSpeedRead', '⚡ Speed-Read this page'),          contexts: ['page'] });
        applySpeedReadMenu();
    });
});

// Settings › Reading › Speed-Read › "Show Speed-Read in the menus" hides the right-click entry too.
function applySpeedReadMenu() {
    if (!chrome.contextMenus || !chrome.storage) return;
    chrome.storage.sync.get('speedRead', (d) => {
        const on = !(d && d.speedRead && d.speedRead.enabled === false);
        try { chrome.contextMenus.update('aish-speedread', { visible: on }, () => void chrome.runtime.lastError); } catch (_) { /* menu not created yet */ }
    });
}
chrome.storage?.onChanged?.addListener((changes, area) => { if (area === 'sync' && changes.speedRead) applySpeedReadMenu(); });
const bgT = (key, fallback) => { try { return chrome.i18n.getMessage(key) || fallback; } catch (_) { return fallback; } };

// Pages run only a tiny loader (loader.js). The full content script is injected the first time something needs it:
// the loader asks for it (saved highlights, text selection), and every sender below injects before it talks to a tab.
async function ensureContent(tabId) {
    try { const r = await chrome.tabs.sendMessage(tabId, { action: 'ping' }); if (r && r.status === 'pong') return true; } catch (_) { /* not injected yet */ }
    try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); return true; } catch (_) { return false; }
}
async function sendToTab(tabId, message) { await ensureContent(tabId); return chrome.tabs.sendMessage(tabId, message); }

chrome.contextMenus?.onClicked?.addListener((info, tab) => {
    if (!tab?.id) return;
    if (info.menuItemId === 'aish-highlight') {
        sendToTab(tab.id, { action: 'contextMenuHighlight', text: info.selectionText }).catch(() => {});
    } else if (info.menuItemId === 'aish-clear-highlights') {
        sendToTab(tab.id, { action: 'contextMenuClearHighlights' }).catch(() => {});
    } else if (info.menuItemId === 'aish-summarize') {
        sendToTab(tab.id, { action: 'fetchSummary', summaryMode: 'extension' }).catch(() => {});
    } else if (info.menuItemId === 'aish-speedread') {
        sendToTab(tab.id, { action: 'speedRead' }).catch(() => {});
    }
});

// ── Decision Alarms ("read later" reminders) ──────────────────────────────────
// The page works out when a reminder is due (modules/decisionTime.js: tomorrow / weekend / next week at the time set in
// Settings) and sends { action: 'decisionSave', articleId, timeframe, dueAt }; the alarm is named after the article's
// timestamp, so it finds its article when it fires.
const decisionAlarmName = (timestamp) => `decision_${encodeURIComponent(timestamp)}`;
const withArticlesLock = (fn) => (globalThis.navigator && navigator.locks && navigator.locks.request) ? navigator.locks.request('aish-articles', fn) : fn();

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

// ── Feeds: background polling + Ollama processing ────────────────────────────
const FEED_ALARM = 'feedPoll';

async function pruneBackgroundFeedData(settings) {
    if (FEED_WORKER) FEED_WORKER.pruneFeedBodies(Date.now() - Math.max(1, Number(settings && settings.keepDays) || 30) * 86400000).catch(() => {});
    const raw = await localGet({ [SK.feedBackground]: {}, [SK.feedItems]: [], [SK.articlesIndex]: [] });
    const state = raw[SK.feedBackground];
    if (!state || !Object.keys(state).length) return;
    const items = raw[SK.feedItems] || [];
    const articles = raw[SK.articlesIndex] || [];
    const cutoff = Date.now() - Math.max(1, Number(settings && settings.keepDays) || 30) * 86400000;
    const mainIds = new Set(items.map(item => item.id));
    const mainNonFav = items.filter(item => item.published >= cutoff && !backgroundItemFav(item, articles)).length;
    const retained = (state.items || []).map(item => ({ ...item, favorite: backgroundItemFav(item, articles) }))
        .filter(item => !mainIds.has(item.id) && (item.published >= cutoff || item.favorite));
    const keptItems = FEED_WORKER
        ? FEED_WORKER.mergeWorkerItems([], retained, settings && settings.keepDays, Date.now(), Math.max(0, FEED_MAX_ITEMS_TOTAL - mainNonFav))
        : retained;
    const storedItems = keptItems.map(({ favorite: _favorite, ...item }) => item);
    const ids = new Set([...mainIds, ...storedItems.map(item => item.id)]);
    const ratings = Object.fromEntries(Object.entries(state.ratings || {}).filter(([id]) => ids.has(id)));
    const firstDay = FEED_WORKER ? FEED_WORKER.startOfDay(cutoff) : new Date(cutoff).setHours(0, 0, 0, 0);
    const recaps = Object.fromEntries(Object.entries(state.recaps || {}).filter(([key]) => {
        const day = Number(String(key).split('|')[0]);
        return !Number.isFinite(day) || day >= firstDay;
    }));
    if (storedItems.length !== (state.items || []).length || Object.keys(ratings).length !== Object.keys(state.ratings || {}).length
        || Object.keys(recaps).length !== Object.keys(state.recaps || {}).length) {
        state.items = storedItems;
        state.ratings = ratings;
        state.recaps = recaps;
        await chrome.storage.local.set({ [SK.feedBackground]: state });
    }
}

async function applyFeedPollConfig() {
    if (!chrome.alarms) return;
    const { [SK.feedSettings]: feedSettings } = await localGet(SK.feedSettings);
    await pruneBackgroundFeedData(feedSettings || {});
    if (!feedSettings || !feedSettings.autoProcess) {
        if (feedRunController) feedRunController.abort();
    }
    await chrome.alarms.clear(FEED_ALARM);
    if (feedSettings && (feedSettings.backgroundPoll || feedSettings.autoProcess)) {
        const intervals = [];
        if (feedSettings.backgroundPoll) intervals.push(Number(feedSettings.refreshMinutes) || 30);
        if (feedSettings.autoProcess) intervals.push(Number(feedSettings.autoProcessMinutes) || 30);
        chrome.alarms.create(FEED_ALARM, { delayInMinutes: 1, periodInMinutes: Math.max(15, Math.min(...intervals)) });
    } else {
        await clearFeedBadge();
    }
}

async function clearFeedBadge() {
    await chrome.storage.local.set({ [SK.feedPending]: 0 });
    await updateSumBadge();
}

let feedPollRunning = false;
let feedRunController = null;
const FEED_MAX_REQUESTS_PER_TICK = 3;
const FEED_AI_TIMEOUT_MS = 4 * 60 * 1000;
const FEED_MAX_ITEMS_TOTAL = 6000;

async function backgroundOllamaConfigured() {
    try {
        const sync = await chrome.storage.sync.get(['connectionMode', 'activeService']);
        const cfg = ((await localGet(SK.servicesConfig))[SK.servicesConfig] || {}).ollama || {};
        const active = sync.connectionMode === 'local' && sync.activeService === 'ollama';
        const saved = !!(cfg.endpoint || cfg.endpointUrl || cfg.activeModelId || (Array.isArray(cfg.customModel) ? cfg.customModel.length : cfg.customModel));
        return active || saved;
    } catch (_) { return false; }
}

function backgroundItemFav(item, articles) {
    const key = (value) => {
        try {
            const u = new URL(value);
            for (const name of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref', 'source']) u.searchParams.delete(name);
            return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`.toLowerCase();
        } catch (_) { return String(value || '').toLowerCase().trim(); }
    };
    const url = key(item.link);
    return articles.some(article => article.favorite && [article.url, article.feedUrl].some(candidate => candidate && key(candidate) === url));
}

async function fetchBackgroundFeed(sub) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), sub.slow || sub.errorCount ? 5000 : 15000);
    try {
        const res = await fetch(sub.url, {
            credentials: 'omit', redirect: 'follow', signal: ctrl.signal,
            headers: {
                Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.5',
                ...(sub.etag && (sub.validatorFailures || 0) < 10 ? { 'If-None-Match': sub.etag } : {}),
                ...(sub.lastModified && (sub.validatorFailures || 0) < 10 ? { 'If-Modified-Since': sub.lastModified } : {})
            }
        });
        return {
            status: res.status, ok: res.ok, url: res.url || sub.url,
            etag: res.headers.get('etag') || '', lastModified: res.headers.get('last-modified') || '',
            cacheControl: res.headers.get('cache-control') || '', retryAfter: res.headers.get('retry-after') || '',
            xml: res.status === 304 || !res.ok ? '' : (await res.text()).slice(0, 3 * 1024 * 1024)
        };
    } finally { clearTimeout(timer); }
}

function withFeedAiTimeout(signal) {
    const controller = new AbortController();
    let expired = false;
    const abort = () => controller.abort();
    if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', abort, { once: true });
    }
    const timer = setTimeout(() => { expired = true; controller.abort(); }, FEED_AI_TIMEOUT_MS);
    return {
        signal: controller.signal,
        close() { clearTimeout(timer); if (signal) signal.removeEventListener('abort', abort); },
        timedOut() { return expired; }
    };
}

async function pollFeeds() {
    if (feedPollRunning || !FEED_WORKER) return;
    feedPollRunning = true;
    try {
        const raw = await localGet({ [SK.feedSubs]: [], [SK.feedItems]: [], [SK.feedRecaps]: {}, [SK.feedBackground]: {}, [SK.feedBgSeen]: {}, [SK.feedPending]: 0, [SK.feedSettings]: {}, [SK.articlesIndex]: [] });
        const d = {
            feedSubs: raw[SK.feedSubs] || [], feedItems: raw[SK.feedItems] || [], feedRecaps: raw[SK.feedRecaps] || {},
            background: raw[SK.feedBackground] || {}, seen: raw[SK.feedBgSeen] || {},
            feedPending: raw[SK.feedPending] || 0, feedSettings: raw[SK.feedSettings] || {}, articles: raw[SK.articlesIndex] || []
        };
        await pruneBackgroundFeedData(d.feedSettings);
        d.background = (await localGet(SK.feedBackground))[SK.feedBackground] || d.background;
        const configured = d.feedSettings.autoProcess && await backgroundOllamaConfigured();
        if (!d.feedSettings.backgroundPoll && !configured) return;
        const state = { items: [], ratings: {}, recaps: {}, ...(d.background || {}) };
        state.items = Array.isArray(state.items) ? state.items : [];
        state.ratings = state.ratings || {}; state.recaps = state.recaps || {};
        const existing = [...d.feedItems, ...state.items];
        const knownIds = new Set(existing.map(i => i.id));
        const knownLinks = new Set(existing.map(i => i.link));
        const seen = d.seen;
        let fresh = 0;
        const now = Date.now();
        const minimumInterval = Math.max(15, Number(d.feedSettings.refreshMinutes) || 30) * 60000;
        const dueSubs = d.feedSubs.filter(sub => {
            if (sub.muted || (Number(sub.nextFetchAt) || 0) > now) return false;
            const interval = d.feedSettings.smartRefreshOrder === false ? minimumInterval
                : FEED_WORKER.estimateFeedInterval(existing, sub.id, minimumInterval, now);
            return !sub.lastFetched || now - sub.lastFetched >= interval;
        });
        const priorityItems = existing.map(item => ({
            ...item,
            favorite: item.favorite || backgroundItemFav(item, d.articles),
            summarized: d.articles.some(article => !article.feedStub && !article.savedOnly &&
                [article.url, article.feedUrl].some(url => url && url === item.link))
        }));
        const queue = d.feedSettings.smartRefreshOrder === false ? [...dueSubs] : dueSubs.sort((a, b) => {
            const risk = sub => Math.max(Number(sub.errorCount) || 0, sub.slow ? 2 : 0);
            return risk(a) - risk(b) ||
                FEED_WORKER.feedPriority(b, priorityItems, FEED_WORKER.feedQualityWeight(priorityItems, b.id, now), now) -
                FEED_WORKER.feedPriority(a, priorityItems, FEED_WORKER.feedQualityWeight(priorityItems, a.id, now), now) ||
                (Number(a.lastFetched) || 0) - (Number(b.lastFetched) || 0);
        });
        let stateWrite = Promise.resolve();
        const saveBackground = () => {
            stateWrite = stateWrite.then(() => chrome.storage.local.set({ [SK.feedBackground]: state }));
            return stateWrite;
        };
        const worker = async () => {
            while (queue.length) {
                const sub = queue.shift();
                const started = Date.now();
                try {
                    const fetched = await fetchBackgroundFeed(sub);
                    const fetchedAt = Date.now();
                    sub.lastFetched = fetchedAt;
                    sub.fetchDurationMs = fetchedAt - started;
                    sub.slow = sub.fetchDurationMs >= 8000;
                    if (fetched.etag) sub.etag = fetched.etag;
                    if (fetched.lastModified) sub.lastModified = fetched.lastModified;
                    const maxAge = Number((fetched.cacheControl.match(/(?:^|,)\s*max-age=(\d+)/i) || [])[1]) * 1000;
                    const retrySeconds = Number(fetched.retryAfter);
                    const retryDate = Date.parse(fetched.retryAfter);
                    sub.nextFetchAt = maxAge ? fetchedAt + maxAge : 0;
                    if (fetched.retryAfter && Number.isFinite(retrySeconds)) sub.nextFetchAt = fetchedAt + retrySeconds * 1000;
                    else if (fetched.retryAfter && Number.isFinite(retryDate)) sub.nextFetchAt = Math.max(fetchedAt, retryDate);
                    if (fetched.status === 304) {
                        sub.validatorFailures = (sub.validatorFailures || 0) + 1;
                        sub.error = ''; sub.errorCount = 0;
                        console.debug('[feeds] background refresh', sub.id, `${sub.fetchDurationMs}ms`, 'newItems=0');
                        continue;
                    }
                    if (!fetched.ok) throw Object.assign(new Error('HTTP ' + fetched.status), fetched);
                    sub.validatorFailures = 0;
                    sub.error = ''; sub.errorCount = 0;
                const parsed = FEED_WORKER.parseWorkerFeed(fetched.xml, fetched.url, sub);
                // the full text goes to its own keys; the items stay small (see modules/feedBodies.js)
                FEED_WORKER.saveFeedBodies(parsed.map(i => ({ id: i.id, html: i.body, published: i.published }))).catch(() => {});
                parsed.forEach(i => { delete i.body; });
                const links = parsed.map(i => i.link);
                const prev = seen[sub.id];
                if (prev) {
                    const prevSet = new Set(prev);
                    const newLinks = links.filter(l => !prevSet.has(l) && !knownLinks.has(l));
                    fresh += newLinks.length;
                    console.debug('[feeds] background refresh', sub.id, `${sub.fetchDurationMs}ms`, `newItems=${newLinks.length}`);
                } else {
                    console.debug('[feeds] background refresh', sub.id, `${sub.fetchDurationMs}ms`, `newItems=${links.filter(l => !knownLinks.has(l)).length}`);
                }
                seen[sub.id] = [...new Set([...links, ...(prev || [])])].slice(0, 300);
                if (configured) {
                    const additions = parsed.filter(i => !knownIds.has(i.id)).map(item => ({
                        ...item, favorite: backgroundItemFav(item, d.articles)
                    }));
                    if (additions.length) {
                        const cutoff = Date.now() - Math.max(1, Number(d.feedSettings.keepDays) || 30) * 86400000;
                        const mainNonFav = d.feedItems.filter(item => item.published >= cutoff && !backgroundItemFav(item, d.articles)).length;
                        const capacity = Math.max(0, FEED_MAX_ITEMS_TOTAL - mainNonFav);
                        state.items = FEED_WORKER.mergeWorkerItems(state.items, additions, d.feedSettings.keepDays, Date.now(), capacity)
                            .map(({ favorite: _favorite, ...item }) => item);
                        additions.forEach(i => { knownIds.add(i.id); knownLinks.add(i.link); });
                        await saveBackground();
                    }
                }
                } catch (error) {
                    const failedAt = Date.now();
                    sub.lastFetched = failedAt;
                    sub.error = error.message || 'Request failed';
                    sub.errorCount = (sub.errorCount || 0) + 1;
                    const retrySeconds = Number(error.retryAfter);
                    const retryDate = Date.parse(error.retryAfter);
                    const maxAge = Number((String(error.cacheControl || '').match(/(?:^|,)\s*max-age=(\d+)/i) || [])[1]) * 1000;
                    sub.nextFetchAt = error.retryAfter && Number.isFinite(retrySeconds) ? failedAt + retrySeconds * 1000
                        : error.retryAfter && Number.isFinite(retryDate) ? Math.max(failedAt, retryDate)
                            : maxAge ? failedAt + maxAge
                                : failedAt + Math.min(15 * 60 * 1000, 30000 * (2 ** Math.min(sub.errorCount - 1, 5)));
                    console.debug('[feeds] background refresh', sub.id, `${sub.fetchDurationMs || failedAt - started}ms`, 'newItems=0', sub.error);
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
        const pending = (d.feedPending || 0) + fresh;
        const latestSubs = (await localGet(SK.feedSubs))[SK.feedSubs] || [];
        const fetchedById = new Map(d.feedSubs.map(sub => [sub.id, sub]));
        const feedSubs = latestSubs.map(sub => {
            const fetched = fetchedById.get(sub.id);
            if (!fetched || fetched.url !== sub.url) return sub;
            const updated = { ...sub };
            for (const key of ['lastFetched', 'etag', 'lastModified', 'nextFetchAt', 'validatorFailures', 'error', 'errorCount', 'fetchDurationMs', 'slow']) {
                if (key in fetched) updated[key] = fetched[key];
            }
            return updated;
        });
        await chrome.storage.local.set({ [SK.feedBgSeen]: seen, [SK.feedPending]: pending, [SK.feedSubs]: feedSubs });
        await sumJobsReady();
        await updateSumBadge();
        if (!configured) return;

        const latestSettings = (await localGet(SK.feedSettings))[SK.feedSettings] || {};
        if (!latestSettings.autoProcess || !(await backgroundOllamaConfigured())) return;
        d.feedSettings = latestSettings;
        const interval = Math.max(15, Number(d.feedSettings.autoProcessMinutes) || 30) * 60000;
        if (Date.now() - Math.max(Number(d.feedSettings.autoProcessAt) || 0, Number(state.status && state.status.at) || 0) < interval) return;
        const runController = new AbortController();
        feedRunController = runController;
        const articleFavs = d.articles;
        const favoriteItems = list => list.map(item => ({ ...item, favorite: backgroundItemFav(item, articleFavs) }));
        const mergedItems = FEED_WORKER.mergeWorkerItems(
            favoriteItems(d.feedItems), favoriteItems(state.items), d.feedSettings.keepDays, Date.now(), FEED_MAX_ITEMS_TOTAL
        )
            .map(item => {
                const rating = state.ratings[item.id];
                return { ...item, ...(rating || {}), favorite: backgroundItemFav(item, articleFavs) };
            })
            .filter(item => item.published >= Date.now() - (Math.max(1, Number(d.feedSettings.keepDays) || 30) * 86400000) || item.favorite);
        const recaps = { ...d.feedRecaps };
        Object.entries(state.recaps).forEach(([key, recap]) => {
            if (!recaps[key] || (Number(recap.at) || 0) >= (Number(recaps[key].at) || 0)) recaps[key] = recap;
        });
        const topicLang = (await FEED_WORKER.uiLanguage()).code;
        FEED_WORKER.setAiDetail(d.feedSettings.aiDetail);   // titles only, or titles + descriptions
        await FEED_WORKER.loadLexicon();
        const plan = FEED_WORKER.planLibrary({
            items: mergedItems, recaps, source: 'all', inSource: () => true,
            startOfDay: FEED_WORKER.startOfDay, itemSig: FEED_WORKER.itemSig, includeToday: true, rateWithRecap: d.feedSettings.rateWithRecap !== false,
            subs: d.feedSubs, topicLang, articleTags: d.articles.flatMap(a => a.tags || [])
        });
        // A timeout lowers the batch size for this machine (state.batchSize); a new batch size in the settings (e.g. another profile) wins again.
        const settingBatch = [10, 20, 40].includes(Number(d.feedSettings.libraryBatch)) ? Number(d.feedSettings.libraryBatch) : 20;
        const fallbackBatch = state.batchSize && state.batchBase === settingBatch ? Number(state.batchSize) : 0;
        const configuredBatch = [10, 20, 40].includes(fallbackBatch) ? fallbackBatch : settingBatch;
        const requestsPerTick = [1, 2, 3, 4, 6, 8].includes(Number(d.feedSettings.requestsPerTick)) ? Number(d.feedSettings.requestsPerTick) : FEED_MAX_REQUESTS_PER_TICK;
        const work = FEED_WORKER.boundedLibraryPlan(plan, configuredBatch, requestsPerTick);
        if (!work.rate.length && !work.days.length && !(work.tag && work.tag.length) && !(work.lex && work.lex.length)) return;

        const subscriptions = new Map(d.feedSubs.map(sub => [sub.id, sub]));
        let timedOut = false;
        const saveRatings = (items) => {
            for (const item of items) {
                const { ai, sent, cat, catTried } = item;
                if (ai || sent !== undefined || cat) state.ratings[item.id] = { ...(ai ? { ai } : {}), ...(sent !== undefined ? { sent } : {}), ...(cat ? { cat } : {}), ...(catTried && !cat ? { catTried } : {}) };
            }
        };
        const aiCall = async (fn, signal) => {
            const timeout = withFeedAiTimeout(signal);
            try { return await fn(timeout.signal); }
            catch (e) {
                if (timeout.timedOut()) { timedOut = true; throw Object.assign(new Error('Ollama request timed out'), { timeout: true }); }
                throw e;
            } finally { timeout.close(); }
        };
        // Categories already given to items in this library, most used first: the category request picks from these (plus defaults).
        const knownCats = () => { const m = new Map(); for (const r of Object.values(state.ratings || {})) if (r && r.cat) m.set(r.cat, (m.get(r.cat) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1]).slice(0, 12).map(x => x[0]); };
        const rateChunk = async (chunk, signal) => {
            const result = await aiCall(aiSignal => FEED_WORKER.scoreItems(chunk, i => (subscriptions.get(i.feedId) || {}).customTitle || (subscriptions.get(i.feedId) || {}).title || '', { signal: aiSignal, service: 'ollama', knownCats: knownCats() }), signal);
            chunk.forEach((item, index) => {
                if (!item.ai && result.scores[index] !== null) { item.sent = result.scores[index]; item.ai = true; }
                if (!item.cat && result.labels && result.labels[index]) item.cat = result.labels[index];
                if (item.ai && !item.cat) item.catTried = true;
            });
            saveRatings(chunk);
            await chrome.storage.local.set({ [SK.feedBackground]: state });
        };
        // Up to 3 topic tags per feed in the UI language, stored as `topics` (the user's own `tags` are never touched).
        const tagFeed = async (entry, signal) => {
            const sub = subscriptions.get(entry.id) || {};
            const result = entry.keys
                ? { ...(await aiCall(aiSignal => FEED_WORKER.translateFeedTopics(entry.keys, { signal: aiSignal, service: 'ollama' }), signal)), keys: entry.keys }
                : await aiCall(aiSignal => FEED_WORKER.generateFeedTopics(sub.customTitle || sub.title || '', entry.items, { cats: FEED_WORKER.categoryCounts(entry.all), signal: aiSignal, service: 'ollama' }), signal);
            const stored = (await localGet(SK.feedSubs))[SK.feedSubs] || [];
            const target = stored.find(x => x.id === entry.id);
            if (!target) return;
            target.topics = result.tags.slice(0, 3); target.topicKeys = result.keys; target.topicsLang = result.lang;
            await chrome.storage.local.set({ [SK.feedSubs]: stored });
            await FEED_WORKER.saveLexicon();
        };
        // Tags of saved articles that are neither built-in nor learned: named once, kept only in the lexicon.
        const nameTags = async (batch, signal) => {
            await aiCall(aiSignal => FEED_WORKER.learnTagNames(batch, { signal: aiSignal, service: 'ollama' }), signal);
            await FEED_WORKER.saveLexicon();
        };
        const recapDay = async (entry, size, signal, ctx = {}) => {
            const key = `${entry.day}|all`;
            const dayItems = mergedItems.filter(i => FEED_WORKER.startOfDay(i.published) === entry.day).sort((a, b) => b.published - a.published);
            const sigs = list => Object.fromEntries(list.map(item => [item.id, FEED_WORKER.itemSig(item)]));
            const chunks = FEED_WORKER.chunksOf(entry.todo, size);
            let current = recaps[key] || null;
            for (let index = 0; index < chunks.length; index++) {
                const chunk = chunks[index];
                if (signal && signal.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true });
                if (ctx.step) ctx.step({ batch: index + 1, batches: chunks.length, count: chunk.length });
                let recap;
                if (!current) {
                    recap = await aiCall(aiSignal => FEED_WORKER.generateRecap(chunk, i => (subscriptions.get(i.feedId) || {}).customTitle || (subscriptions.get(i.feedId) || {}).title || '', {
                        rate: d.feedSettings.rateWithRecap !== false, signal: aiSignal, service: 'ollama'
                    }), signal);
                    if (d.feedSettings.rateWithRecap !== false) chunk.forEach((item, n) => {
                        if (!item.ai && recap.scores && recap.scores[n] != null) { item.sent = recap.scores[n]; item.ai = true; }
                        if (!item.cat && recap.labels && recap.labels[n]) item.cat = recap.labels[n];
                        if (item.ai && !item.cat) item.catTried = true;
                    });
                    const { labels: _labels, scores: _scores, ...base } = recap;
                    recap = { ...base, covered: sigs(chunk) };
                } else {
                    recap = await aiCall(aiSignal => FEED_WORKER.generateRecapUpdate(current, chunk, i => (subscriptions.get(i.feedId) || {}).customTitle || (subscriptions.get(i.feedId) || {}).title || '', {
                        rate: d.feedSettings.rateWithRecap !== false, edited: item => item.id in current.covered, signal: aiSignal, service: 'ollama'
                    }), signal);
                    if (d.feedSettings.rateWithRecap !== false && recap.sent) recap.sent.forEach((item, n) => {
                        if (!item.ai && recap.scores && recap.scores[n] != null) { item.sent = recap.scores[n]; item.ai = true; }
                        if (!item.cat && recap.labels && recap.labels[n]) item.cat = recap.labels[n];
                        if (item.ai && !item.cat) item.catTried = true;
                    });
                    const { labels: _labels, scores: _scores, sent: _sent, ...base } = recap;
                    recap = { ...base, covered: { ...current.covered, ...sigs(chunk) } };
                }
                current = state.recaps[key] = { ...recap, hash: FEED_WORKER.hash(dayItems.map(i => i.id).sort().join(',')), at: Date.now(), n: dayItems.length, total: dayItems.length };
                recaps[key] = current;
                saveRatings(chunk);
                await chrome.storage.local.set({ [SK.feedBackground]: state });
                if (ctx.tick) ctx.tick();
            }
        };
        const result = await FEED_WORKER.runLibrary(work, configuredBatch, { rateChunk, tagFeed, nameTags, recapDay, signal: runController.signal });
        if (timedOut && configuredBatch > 10) { state.batchSize = 10; state.batchBase = settingBatch; }
        state.status = { at: Date.now(), rated: result.rated, recaps: result.recaps, failed: result.failed };
        await chrome.storage.local.set({ [SK.feedBackground]: state });
        if (result.rated || result.recaps) {
            const message = `${result.rated} new items rated · ${result.recaps} day recaps written`;
            try {
                await chrome.notifications.create(`feed-background-${state.status.at}`, {
                    type: 'basic', iconUrl: 'icons/icon48.png', title: 'Feed processing finished', message
                });
            } catch (_) { /* notification support varies by browser */ }
        }
    } catch (e) {
        console.warn('[feeds] poll failed', e);
    } finally { feedRunController = null; feedPollRunning = false; }
}

// ── One-shot AI completion (feed recaps, tone scoring) ──────────────────────
// Same connection logic as the page summarizer (byPhil Cloud, own key, or a
// local Ollama), but non-streaming and callable from any extension page.
if (typeof AishAudio !== 'undefined' && typeof Audio !== 'undefined') AishAudio.host();

const AISH_API_BASE = 'https://api.byphil.eu';

// "Prefer EU servers" (Settings → Models, hosted models only): the hosted service pins EU endpoints for models that have them and runs the others
// as usual. A service that does not know the header ignores it. The answer's X-AISH-Region says which route was really used; the app shows that.
const AISH_FEATURES = ['summary', 'qa', 'recap', 'tags', 'analysis', 'translate'];
async function cloudRegionHeader(url, feature) {
    if (!String(url).startsWith(AISH_API_BASE + '/v1/projects/')) return {};
    const s = await chrome.storage.sync.get(['cloudRegionPref']).catch(() => ({}));
    return {
        ...(s.cloudRegionPref === 'prefer-eu' ? { 'X-AISH-Region': 'prefer-eu' } : {}),
        // what the request is for: the hosted service's Auto models use it to pick a model (an older service ignores it)
        ...(AISH_FEATURES.includes(feature) ? { 'X-AISH-Feature': feature } : {}),
    };
}
// The model that really answered (the hosted service says so in X-AISH-Model-Used), so history and stats show it and never just "auto". '' when not reported.
function usedModelOf(url, res) {
    try {
        if (!String(url).startsWith(AISH_API_BASE + '/v1/projects/')) return '';
        const m = res.headers.get('x-aish-model-used') || '';
        return /^[A-Za-z0-9_.:\-]{1,60}\/[A-Za-z0-9_.:\-]{1,80}$/.test(m) ? m : '';
    } catch (_) { return ''; }
}
function noteCloudRoute(url, res, model) {
    try {
        if (!String(url).startsWith(AISH_API_BASE + '/v1/projects/')) return;
        const region = res.headers.get('x-aish-region');
        if (region !== 'eu' && region !== 'global') return;   // an older service says nothing: nothing is recorded
        const used = (res.headers.get('x-aish-model-used') || '').slice(0, 120), switched = res.headers.get('x-aish-switched') === 'long-text' ? 'long-text' : '';
        const am = /^(tiny|small|large):([a-z-]{1,24})$/.exec(res.headers.get('x-aish-auto') || '');   // Auto: which tier it chose and why
        chrome.storage.local.set({ [SK.cloudRoute]: { region, model: model || '', ...(used ? { used } : {}), ...(switched ? { switched } : {}), ...(am ? { auto: { tier: am[1], reason: am[2] } } : {}), at: Date.now() } });
    } catch (_) { /* a status note must never break a summary */ }
}

// Login-token expiry (same rule as modules/sessionToken.js; this file is not a module). Only a readable JWT with a past `exp` counts.
function aiTokenExpired(token) {
    if (!token || typeof token !== 'string') return false;
    try {
        let b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        if (b64.length % 4) b64 += '='.repeat(4 - (b64.length % 4));
        const p = JSON.parse(decodeURIComponent(atob(b64).split('').map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')));
        return typeof p.exp === 'number' && p.exp * 1000 <= Date.now();
    } catch (_) { return false; }
}

// Silent login renewal for the worker (same rule as refreshSession() in modules/sessionToken.js): a token with under 7 days left is
// swapped via POST /v1/auth/refresh. Never throws; on any failure the old token stays.
let aiRefreshFailedAt = 0, aiRefreshInflight = null;
function aiTokenNeedsRefresh(token) {
    if (!token || typeof token !== 'string' || aiTokenExpired(token)) return false;
    try {
        let b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        if (b64.length % 4) b64 += '='.repeat(4 - (b64.length % 4));
        const p = JSON.parse(decodeURIComponent(atob(b64).split('').map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')));
        return typeof p.exp === 'number' && p.exp * 1000 - Date.now() < 7 * 24 * 3600e3;
    } catch (_) { return false; }
}
function aiRefreshSession(token) {
    if (aiRefreshInflight) return aiRefreshInflight;
    if (Date.now() - aiRefreshFailedAt < 10 * 60e3) return Promise.resolve(false);
    aiRefreshInflight = (async () => {
        try {
            const res = await fetch('https://api.byphil.eu/v1/auth/refresh', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
            const body = res.ok ? await res.json() : null;
            if (!body || !body.success || !body.token) { aiRefreshFailedAt = Date.now(); return false; }
            const write = { [SK.token]: body.token };
            if (body.record && body.record.id) write[SK.user] = body.record;
            if (body.record && body.record.license_key) write[SK.licenseKey] = body.record.license_key;
            await chrome.storage.local.set(write);
            return true;
        } catch (_) { aiRefreshFailedAt = Date.now(); return false; } finally { aiRefreshInflight = null; }
    })();
    return aiRefreshInflight;
}

function aiFriendlyError(status, body, cloud) {
    const e = `${status} ${body || ''}`;
    // Server-side cost budget (byphilapi): specific codes before the generic "limit" wording below.
    if (/quota_exceeded/.test(e)) return 'Your monthly AI allowance is used up. It resets on the 1st \u2014 local models still work.';
    if (/rate_limited/.test(e)) return 'Too many AI requests in a short time. Please wait a few minutes.';
    if (/too_large/.test(e)) return 'That is too much text for one request. Try fewer items.';
    if (/402|429|trial exhausted|requests per day|requests per week|quota|too many|rate/i.test(e)) {
        return 'You\u2019ve reached your free daily limit. Come back tomorrow \u2014 or upgrade to Pro for unlimited use.' + (cloud ? ' Already a Pro user? Sign in again under Settings \u203a Account.' : '');
    }
    if (cloud && (status === 401 || status === 403)) return 'Your session could not be verified. Please sign in again under Settings \u203a Account.';
    if (status === 401 || status === 403) return `The server rejects the key or the request (${status}). Check the API key in Settings.`;
    if (status === 404) return 'The path does not match (404). With your own server the address usually needs /v1 at the end.';
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

// Local model servers (Ollama, apfel, LM Studio, llama.cpp, Jan) often accept requests only from localhost pages (Ollama:
// OLLAMA_ORIGINS, apfel: "origin: localhost only"). For requests this extension itself sends to them, the Origin header is
// set to http://127.0.0.1 so they are accepted. Web pages are not affected (only requests that belong to no tab: this
// extension's worker, popup and offscreen page; an extension's rules never touch other extensions); session rules,
// renewed whenever the worker starts.
const LOCAL_MODEL_PORTS = [11434, 1234, 8080, 1337];   // Ollama / apfel, LM Studio, llama.cpp, Jan
async function allowLocalModelServers() {
    try {
        const dnr = chrome.declarativeNetRequest;
        if (!dnr || !dnr.updateSessionRules || !chrome.runtime.id) return;
        const rules = []; let id = 9100;
        for (const host of ['127.0.0.1', 'localhost']) for (const port of LOCAL_MODEL_PORTS) {
            rules.push({ id: id++, priority: 1,
                action: { type: 'modifyHeaders', requestHeaders: [{ header: 'origin', operation: 'set', value: 'http://127.0.0.1' }] },
                condition: { urlFilter: `|http://${host}:${port}/`, tabIds: [-1], resourceTypes: ['xmlhttprequest', 'other'] } });
        }
        await dnr.updateSessionRules({ removeRuleIds: rules.map(r => r.id), addRules: rules });
        console.info('[AISH] local model origin rules set', rules.length);
    } catch (e) { console.warn('[AISH] local model origin rule not set', e && e.message); }
}
allowLocalModelServers();

// Model requests: Chrome's built-in model (model id `chrome-builtin`, see builtinAi.js) answers here, everything else is a normal fetch.
const aiFetchRaw = (url, init) => (typeof AishBuiltin !== 'undefined' ? AishBuiltin.aiFetch(url, init) : fetch(url, init));
// A local model that is still loading (apfel right after Apple Intelligence was turned on or updated: "Model assets are loading.
// Try again in a moment.") accepts the request and then breaks the stream. For local servers the start of the stream is read
// first: real text → hand on everything (nothing lost); "loading" → wait and ask again, up to about two minutes; still loading →
// a clear 503 instead of an empty summary.
const LOCAL_URL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//i;
const MODEL_LOADING = /assets are loading|model (is )?loading|\[model loading\]/i;
// Parts of D (AISH-033): when the chosen local model is not ready (not reachable, still loading, server error), the next ready
// local model from Settings › Models › Local answers instead (sync: localFallbackOrder, saved there in recommendation order;
// switch: localFallback, on by default). The answer carries `x-aish-fallback` so the summary says who wrote it.
async function localFallbacks(model) {
    try {
        const s = await chrome.storage.sync.get(['localFallback', 'localFallbackOrder']);
        if (s.localFallback === false || !Array.isArray(s.localFallbackOrder)) return [];
        return s.localFallbackOrder.filter(c => c && c.model && c.model !== model && LOCAL_URL.test(String(c.endpoint || '')));
    } catch (_) { return []; }
}
const withModel = (body, model) => { try { const j = JSON.parse(body); j.model = model; return JSON.stringify(j); } catch (_) { return body; } };   // same messages in both formats
async function aiFetch(url, init = {}) {
    if (!LOCAL_URL.test(String(url))) return aiFetchRaw(url, init);
    let first = null, firstErr = null;
    try { first = await aiFetchOne(url, { ...init, quick: true }); } catch (e) { if (e && e.name === 'AbortError') throw e; firstErr = e; }
    if (first && first.ok) return first;
    let wanted = ''; try { wanted = JSON.parse(init.body || '{}').model || ''; } catch (_) { /* not JSON */ }
    for (const alt of await localFallbacks(wanted)) {
        try {
            const res = await aiFetchOne(alt.endpoint, { ...init, body: withModel(init.body, alt.model), quick: true });
            if (res && res.ok) {
                const h = new Headers(res.headers); h.set('x-aish-fallback', alt.label || alt.model); h.set('x-aish-fallback-from', wanted);
                return new Response(res.body, { status: res.status, headers: h });
            }
        } catch (e) { if (e && e.name === 'AbortError') throw e; }
    }
    if (first && first.status !== 425) return first;   // no fallback answered: the original answer (error) stands
    if (firstErr) throw firstErr;
    return aiFetchOne(url, init);   // only “still loading” is left: wait for it (up to ~2 minutes)
}
async function aiFetchOne(url, init = {}) {
    const { quick, ...req } = init;   // quick: on “still loading” return 425 at once, so a fallback can answer first
    if (!LOCAL_URL.test(String(url))) return aiFetchRaw(url, req);
    const signal = init.signal, dec = new TextDecoder();
    for (let attempt = 0; attempt < 24; attempt++) {
        const res = await aiFetchRaw(url, req);
        if (!res.ok || !res.body) {
            const body = res.ok ? '' : await res.clone().text().catch(() => '');
            if (!MODEL_LOADING.test(body)) return res;
        } else {
            const reader = res.body.getReader(); const head = []; let seen = '', loading = false;
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                head.push(value); seen += dec.decode(value, { stream: true });
                if (MODEL_LOADING.test(seen)) { loading = true; try { await reader.cancel(); } catch (_) { /* gone */ } break; }
                if (/"content"\s*:\s*"(?!")/.test(seen) || /"response"\s*:\s*"(?!")/.test(seen) || seen.length > 6000) break;   // text has started
            }
            if (!loading) {
                const stream = new ReadableStream({
                    start(ctrl) { head.forEach(c => ctrl.enqueue(c)); },
                    async pull(ctrl) { try { const { value, done } = await reader.read(); if (done) ctrl.close(); else ctrl.enqueue(value); } catch (e) { ctrl.error(e); } },
                    cancel() { try { reader.cancel(); } catch (_) { /* gone */ } }
                });
                return new Response(stream, { status: res.status, headers: res.headers });
            }
        }
        if (signal && signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
        if (init.quick) return new Response('{"error":{"message":"model loading"}}', { status: 425, headers: { 'content-type': 'application/json' } });   // let a fallback answer first
        await new Promise(r => setTimeout(r, 5000));   // the model loads in the background; ask again
    }
    return new Response(JSON.stringify({ error: { message: "The local model is still loading on this computer (the first use after turning it on or after an update can take a few minutes). Try again in a moment." } }), { status: 503, headers: { 'content-type': 'application/json' } });
}
const aiJobs = new Map(); // request id → AbortController, so the popup can cancel a slow (e.g. local) model
const aiResyncAsked = new Set(); // request ids whose receiver lost a streamed delta: the next tick resends the whole text
async function aiComplete({ system, user, id, partial, service: forcedService, signal, feature, target }) {
    const sync = await chrome.storage.sync.get(['activeService', 'connectionMode', 'preferredCloudModel']).catch(() => ({}));
    let local = await localGet([SK.servicesConfig, SK.licenseKey, SK.token, SK.installId]).catch(() => ({}));
    if (!forcedService && (sync.connectionMode || 'cloud') === 'cloud' && aiTokenNeedsRefresh(local[SK.token]) && await aiRefreshSession(local[SK.token])) {
        local = await localGet([SK.servicesConfig, SK.licenseKey, SK.token, SK.installId]).catch(() => local);
    }
    // `forcedService` (only 'ollama') lets the whole-library run use the local model whatever is active for summaries.
    const forced = forcedService === 'ollama' ? 'ollama' : '';
    const connectionMode = forced ? 'local' : (sync.connectionMode || 'cloud');
    let service = forced || sync.activeService || 'openai';
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
        // An expired login token is not sent (the API would treat it as signed out): use the license key, else ask for a new sign-in.
        const tokenExpired = aiTokenExpired(local[SK.token]);
        apiKey = (!tokenExpired && local[SK.token]) || local[SK.licenseKey] || '';
        if (tokenExpired && !apiKey) throw new Error('Your session has expired. Please sign in again under Settings \u203a Account.');
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
        if (service === 'ollama') {
            keyOptional = true;
            if (!model) throw new Error('No Ollama model selected. Install one (e.g. "ollama pull llama3.2") and pick it in the model panel.');
        }
        if (service === 'custom' && !model) throw new Error('No model selected for your own server. Pick or type the model name in the model panel.');
    }
    // The quick test in Settings › Models › Local asks one particular local model (never anything outside this computer).
    if (target && target.model && LOCAL_URL.test(String(target.endpoint || ''))) {
        service = 'ollama'; url = target.endpoint; model = target.model; apiKey = ''; keyOptional = true;
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
    const abort = () => ctrl.abort();
    if (signal) {
        if (signal.aborted) ctrl.abort();
        else signal.addEventListener('abort', abort, { once: true });
    }
    if (id) aiJobs.set(id, ctrl);
    const progress = (p) => { if (id) { try { chrome.runtime.sendMessage({ action: 'aiProgress', id, ...p }, () => void chrome.runtime.lastError); } catch (_) { /* popup closed */ } } };
    try {
        Object.assign(headers, await cloudRegionHeader(url, feature));
        const send = target ? aiFetchOne : aiFetch;   // the quick test measures exactly this model: no fallback
        let res = await send(url, { method: 'POST', headers, body, signal: ctrl.signal });
        noteCloudRoute(url, res, model);
        // A provider that rejects "stream": true gets one retry without streaming.
        if ((res.status === 400 || res.status === 422) && service !== 'gemini') {
            res = await send(url, { method: 'POST', headers, body: body.replace('"stream":true', '"stream":false'), signal: ctrl.signal });
        }
        if (!res.ok) throw new Error(aiFriendlyError(res.status, await res.text(), service === 'cloud'));
        progress({ phase: 'headers' });
        let raw = '';
        if (res.body && res.body.getReader) {
            const reader = res.body.getReader();
            const dec = new TextDecoder('utf-8');
            let buf = '', chars = 0, think = 0, last = 0, acc = '', sent = 0;
            // Only what is new since the last tick goes over the wire (the full text every 250 ms is O(n²)); the receiver appends.
            const partialPart = () => {
                if (!partial) return {};
                if (id && aiResyncAsked.delete(id)) sent = 0; // receiver missed a tick: resend from the start (it replaces what it holds)
                const from = sent, delta = acc.slice(sent); sent = acc.length; return { delta, from };
            };
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                const chunk = dec.decode(value, { stream: true });
                raw += chunk; buf += chunk;
                const lines = buf.split('\n'); buf = lines.pop();
                let tail = '';
                for (const l of lines) { const d = aiDelta(l); if (d) { chars += d.text.length; think += d.think.length; tail += d.text; if (partial) acc += d.text; } }
                const now = Date.now();
                if (now - last > 250) { last = now; progress({ phase: 'stream', chars, think, tail: tail.slice(-80), ...partialPart() }); }
            }
            raw += dec.decode();
            progress({ phase: 'stream', chars, think, tail: '', ...partialPart() });
        } else raw = await res.text();
        const text = parseAiResponseText(raw);
        if (!text) throw new Error('The model returned an empty response.');
        return { text, model };
    } catch (e) {
        if (e.name === 'AbortError') throw new Error('The AI request was cancelled.');
        throw e;
    } finally {
        if (id) { aiJobs.delete(id); aiResyncAsked.delete(id); }
        if (signal) signal.removeEventListener('abort', abort);
    }
}

if (typeof FEED_WORKER !== 'undefined' && FEED_WORKER) {
    FEED_WORKER.setAiTransport(({ system, user, signal, partial, service, feature }) =>
        aiComplete({ system, user, signal, partial, service, feature }).then(result => result.text));
}

// ── Phone inbox: while a phone is paired, collect the links it shared every 15 minutes (see modules/inboxManager.js) ──
const INBOX_ALARM = 'inboxPoll';

async function applyInboxPollConfig() {
    if (!chrome.alarms) return;
    const d = await localGet(SK.inboxConfig);
    if (d[SK.inboxConfig]) {
        if (!(await chrome.alarms.get(INBOX_ALARM))) chrome.alarms.create(INBOX_ALARM, { delayInMinutes: 1, periodInMinutes: 15 });
    } else {
        await chrome.alarms.clear(INBOX_ALARM);
    }
}

async function pollInbox() {
    if (!INBOX) return;
    try { await INBOX.createInboxManager().poll(); } catch (e) { console.warn('[Inbox] poll failed:', e && e.message); }
}

chrome.runtime.onStartup.addListener(() => { applyFeedPollConfig(); applyInboxPollConfig(); });

// ── Send targets: durable outbox with retry (modules/targets/). No adapter is registered yet, so nothing is ever queued. ──
const targets = TARGETS ? TARGETS.createTargets({ log: () => {} }) : null;
if (targets) targets.start().catch((e) => console.warn('[Targets] start failed:', e && e.message));

// ── Library sync: revision stamps (modules/syncStampStore.js, .briefs/prd-library-sync.md). Does nothing until sync is on. ──
// Registered at top level so MV3 wakes the worker for storage events; a scan on every wake catches what was missed.
const syncStamps = SYNC ? SYNC.createStampStore({ storage: chrome.storage.local }) : null;
const SYNC_ALARM = 'aish-sync', SYNC_SOON = 'aish-sync-soon';
const syncSoon = (min) => { try { chrome.alarms?.create(SYNC_SOON, { delayInMinutes: Math.max(1, min) }); } catch (_) { /* no alarms */ } };   // same name replaces the last one: a debounce
const syncSvc = syncStamps ? SYNC.createSyncService({ storage: chrome.storage.local, makeStore: SYNC.makeStore, stampStore: syncStamps, dataHooks: SYNC.dataHooks, log: (...a) => console.log(...a), scheduleSoon: syncSoon,
    viewerSource: async (place) => SYNC.renderViewer(await SYNC.loadViewerTemplates({ getUrl: (p) => chrome.runtime.getURL(p) }), { title: place.name }) }) : null;
if (syncStamps) {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        syncStamps.onChanged(changes);
        // a change to the library (not to sync's own ledger or status) publishes a little later
        if (SK.articlesIndex in changes || SK.annotations in changes || Object.keys(changes).some((k) => isArticleRecKey(k) || isHlPageKey(k))) syncStamps.enabled().then((on) => { if (on) syncSoon(2); });
    });
    syncStamps.scan().catch(() => {});
    (async () => { try { if (!(await chrome.alarms.get(SYNC_ALARM))) chrome.alarms.create(SYNC_ALARM, { delayInMinutes: 5, periodInMinutes: 30 }); } catch (_) { /* no alarms */ } })();
}

// ── Highlights: the one writer (modules/highlightStore.js). Pages send { action: 'hl:apply', ops } (modules/highlightMessages.js). ──
const hlStore = SYNC ? SYNC.createHighlightStore({ storage: chrome.storage.local }) : null;
// the old single list → one key per page, once (the popup runs the same step; whichever comes first wins)
if (hlStore) keysReady.then(() => hlStore.migrate()).then((r) => { if (r && r.ran) console.log('[Highlights] per-page keys:', r); }).catch((e) => console.warn('[Highlights] migration failed, the old list stays in use:', e && e.message));
const hlMsgs = hlStore ? SYNC.createHighlightMessages({ store: hlStore, markDeleted: (ids) => { if (syncStamps) syncStamps.markDeleted('hl', ids.slice(0, 1000)); } }) : null;

// ── Notes from the page: the content script asks, the worker writes (modules/notesMessages.js) ──
const notesMsgs = SYNC ? SYNC.createNotesMessages({ store: SYNC.createNotesStore({ storage: chrome.storage.local }) }) : null;

// ── Local MCP (AI apps on this computer) — off by default (modules/mcp/, claude/prd-local-mcp.md). ──
// The extension connects OUTWARD to the aish-mcp relay; it never listens for inbound connections itself.
const DEFAULT_MCP_SCOPES = { library: true, fulltext: false, feeds: false, write: false };
async function getMcpConfig() {
    const { [SK.mcpConfig]: cfg } = await localGet({ [SK.mcpConfig]: {} });
    return { enabled: false, port: 47615, excludeTag: 'private', scopes: DEFAULT_MCP_SCOPES, ...(cfg || {}) };
}
const mcp = MCP ? MCP.createMcpClient({
    storage: { get: (keys) => localGet(keys) },
    setStorage: (obj) => localSet(obj),
    getConfig: getMcpConfig,
    getToken: async () => { const { [SK.mcpSecret]: t } = await localGet({ [SK.mcpSecret]: '' }); return t || ''; },
    extVersion: chrome.runtime.getManifest ? chrome.runtime.getManifest().version : '',
    log: (...a) => console.log('[MCP]', ...a),
}) : null;
// While the feature is on, a 1-minute alarm wakes the worker if Chrome ever stopped it; waking runs this file again,
// which reconnects. Nothing else could: the relay cannot reach into the extension.
const MCP_ALARM = 'mcp_reconnect';
async function applyMcpAlarm(enabled) {
    try {
        if (enabled) { if (!(await chrome.alarms.get(MCP_ALARM))) chrome.alarms.create(MCP_ALARM, { periodInMinutes: 1 }); }
        else await chrome.alarms.clear(MCP_ALARM);
    } catch (_) { /* alarms unavailable */ }
}
if (mcp) {
    getMcpConfig().then((cfg) => {
        applyMcpAlarm(cfg.enabled);
        if (cfg.enabled) mcp.start().catch((e) => console.warn('[MCP] start failed:', e && e.message));
    });
    // Settings flips mcp:config.enabled or mcp:secret directly in storage; follow it here rather than needing a message round-trip.
    // Only on/off, port or the pairing token need a new socket; scopes and the exclude tag are read on every call.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        const c = changes[SK.mcpConfig];
        const linkChanged = c && (!!(c.oldValue && c.oldValue.enabled) !== !!(c.newValue && c.newValue.enabled)
            || ((c.oldValue && c.oldValue.port) || 47615) !== ((c.newValue && c.newValue.port) || 47615));
        if (!linkChanged && !(SK.mcpSecret in changes)) return;
        mcp.stop();
        getMcpConfig().then((cfg) => {
            applyMcpAlarm(cfg.enabled);
            if (cfg.enabled) mcp.start().catch((e) => console.warn('[MCP] restart failed:', e && e.message));
        });
    });
}
chrome.runtime.onInstalled.addListener(() => { applyFeedPollConfig(); applyInboxPollConfig(); });

chrome.alarms?.onAlarm?.addListener(async (alarm) => {
    if (alarm.name === MCP_ALARM) {
        if (mcp && !mcp.isConnected()) { const cfg = await getMcpConfig(); if (cfg.enabled) mcp.start().catch(() => {}); }
        return;
    }
    if (alarm.name === FEED_ALARM) { await pollFeeds(); return; }
    if (alarm.name === SYNC_ALARM || alarm.name === SYNC_SOON) { if (syncSvc) syncSvc.syncNow().catch(() => {}); return; }
    if (alarm.name === INBOX_ALARM) { await pollInbox(); return; }
    if (targets && alarm.name === targets.ALARM) { targets.drain().catch(() => {}); return; }
    if (!alarm.name.startsWith('decision_')) return;
    const timestamp = alarm.name.replace('decision_', '');
    const article = await findDecisionArticle(decodeURIComponent(timestamp));
    if (!article) return;
    chrome.notifications?.create(`decision_notif_${timestamp}`, {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: bgT('notifReadLaterTitle', '🔖 Ready to read?'),
        message: article.title || article.url,
        contextMessage: article.decisionReason || '',
        buttons: [{ title: bgT('notifOpen', 'Open') }, { title: bgT('notifDismiss', 'Dismiss') }],
        requireInteraction: true
    });
});

const reopenUrls = new Map();   // tab id → URL of a tab Speed-Read closed (until its notification goes)
chrome.notifications?.onButtonClicked?.addListener((notifId) => {
    if (!notifId.startsWith('reopen_')) return;
    const url = reopenUrls.get(notifId.slice(7));
    if (url) chrome.tabs.create({ url });
    reopenUrls.delete(notifId.slice(7));
    chrome.notifications.clear(notifId);
});
chrome.notifications?.onClosed?.addListener((notifId) => { if (notifId.startsWith('reopen_')) reopenUrls.delete(notifId.slice(7)); });
// Firefox shows no notification buttons: a click on the notification itself reopens the tab
chrome.notifications?.onClicked?.addListener((notifId) => {
    if (!notifId.startsWith('reopen_')) return;
    const url = reopenUrls.get(notifId.slice(7));
    if (url) chrome.tabs.create({ url });
    reopenUrls.delete(notifId.slice(7));
    chrome.notifications.clear(notifId);
});

chrome.notifications?.onButtonClicked?.addListener(async (notifId, btnIdx) => {
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
    if (namespace === 'local' && changes[SK.inboxConfig]) applyInboxPollConfig();
    // links from the phone arrived, or were summarized / saved / dismissed: the toolbar number follows
    if (namespace === 'local' && changes[SK.inboxPending]) updateSumBadge();
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

// ── Summary job queue ───────────────────────────────────────────────────────
// Summaries that stream into the panel ('extension' mode) run one at a time, whatever started them (the Summarize
// button on any tab, a Feeds card, History). A request made while one is running waits here and starts by itself.
// Jobs are plain data so the queue survives a restarted service worker (kept in storage.session when available).
//   { id, kind: 'tab', tabId, url, title, message }   → summarize an already open tab
//   { id, kind: 'feed', url, title, msg }              → open a feed link (or reuse its tab), then summarize it
const SUM_JOB_TIMEOUT = 10 * 60 * 1000;   // safety net if no completion message ever arrives
// A job counts as started-up for this long before a dead one may be cleared (a feed tab still has to load).
const SUM_JOB_GRACE = { tab: 20 * 1000, feed: 90 * 1000 };
const SUM_JOB_PROBE = 30 * 1000;           // while something waits, check this often that the running job is still alive
const sumJobs = { running: null, queue: [], seq: 0, timer: null, probe: null, reaping: null, ready: null };
const sumJobInfo = (j) => j ? { id: j.id, url: j.url || '', title: j.title || '', kind: j.kind, tabId: j.tabId == null ? null : j.tabId } : null;
function sumJobKey(u) {
    try {
        const x = new URL(u);
        ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','fbclid','gclid','ref','source'].forEach(k => x.searchParams.delete(k));
        const qs = x.searchParams.toString();
        return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + (qs ? '?' + qs : '')).toLowerCase();
    } catch (_) { return String(u || '').toLowerCase().trim(); }
}
function publishSumJobs() {
    const snap = { running: sumJobs.running, queue: sumJobs.queue, seq: sumJobs.seq };
    try { if (chrome.storage.session) chrome.storage.session.set({ sumJobs: snap }).catch(() => {}); } catch (_) { /* in-memory only */ }
    updateSumBadge();
    chrome.runtime.sendMessage({ action: 'summaryQueue', running: sumJobInfo(sumJobs.running), queue: sumJobs.queue.map(sumJobInfo) }).catch(() => {});
}
/** Toolbar badge: jobs running + waiting ("…" while only the running one is left); falls back to the Feeds count when idle. */
async function updateSumBadge() {
    try {
        const n = (sumJobs.running ? 1 : 0) + sumJobs.queue.length;
        if (n > 0) {
            await chrome.action.setBadgeBackgroundColor({ color: '#d97706' });
            await chrome.action.setBadgeText({ text: n > 1 ? (n > 99 ? '99+' : String(n)) : '…' });
            return;
        }
        // idle: unread Feeds items + links waiting from the phone
        const d = await localGet([SK.feedPending, SK.inboxPending]);
        const feed = d[SK.feedPending] || 0;
        const inbox = Array.isArray(d[SK.inboxPending]) ? d[SK.inboxPending].length : 0;
        const b = (INBOX && INBOX.badgeFor) ? INBOX.badgeFor(feed, inbox)
            : { text: feed > 0 ? (feed > 99 ? '99+' : String(feed)) : '', color: '#2563eb', inbox: 0 };
        if (b.text) await chrome.action.setBadgeBackgroundColor({ color: b.color });
        await chrome.action.setBadgeText({ text: b.text });
        // the tooltip says what the number is made of
        try {
            const name = (chrome.i18n && chrome.i18n.getMessage('extensionShortName')) || 'AI Summary Helper';   // the store title is too long for a tooltip
            await chrome.action.setTitle({ title: b.inbox > 0 ? `${name} · ${b.inbox} link${b.inbox === 1 ? '' : 's'} from your phone` : name });
        } catch (_) { /* tooltip is cosmetic */ }
    } catch (_) { /* badge is cosmetic */ }
}
updateSumBadge();   // the number is gone after a browser restart: repaint it when the worker wakes up

/** "Done" notification once the whole queue has drained; click focuses the tab the summary ran in. */
async function notifySumDone(job) {
    try {
        const { notifyWhenDone } = await chrome.storage.sync.get({ notifyWhenDone: true });
        if (notifyWhenDone === false || !chrome.notifications) return;
        chrome.notifications.create(`sumdone_${job.tabId == null ? 'x' : job.tabId}_${Date.now()}`, {
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: 'AI Summary Helper',
            message: job.title ? `Summary ready: ${job.title}` : 'Your summary is ready'
        });
    } catch (_) { /* notifications unavailable */ }
}
chrome.notifications?.onClicked?.addListener(async (notifId) => {
    if (!notifId.startsWith('sumdone_')) return;
    const tabId = parseInt(notifId.split('_')[1], 10);
    chrome.notifications.clear(notifId);
    try {
        const tab = await chrome.tabs.get(tabId);
        await chrome.tabs.update(tabId, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
    } catch (_) { /* tab is gone or none recorded */ }
});
function sumJobsReady() {
    if (!sumJobs.ready) {
        sumJobs.ready = (async () => {
            try {
                if (!chrome.storage.session) return;
                const d = await chrome.storage.session.get({ sumJobs: null });
                const s = d.sumJobs;
                if (s && !sumJobs.running && !sumJobs.queue.length) {
                    sumJobs.seq = s.seq || 0; sumJobs.queue = s.queue || [];
                    if (s.running) { sumJobs.running = s.running; armSumJobTimer(s.running.id); }
                    updateSumBadge();
                }
            } catch (_) { /* nothing to restore */ }
        })();
    }
    return sumJobs.ready;
}
function armSumJobTimer(id) {
    clearTimeout(sumJobs.timer);
    sumJobs.timer = setTimeout(() => sumJobDone(id), SUM_JOB_TIMEOUT);
    clearInterval(sumJobs.probe);
    sumJobs.probe = setInterval(() => { if (sumJobs.queue.length) reapSumJob(); }, SUM_JOB_PROBE);
}
function sumJobStart(job) {
    job.startedAt = Date.now();
    sumJobs.running = job; armSumJobTimer(job.id); publishSumJobs();
    Promise.resolve().then(() => runSumJob(job)).catch(() => sumJobDone(job.id));
}
/**
 * Is the running job still working? The finish message can get lost (the page navigated and the background finished the
 * summary, the content script bailed out early, the worker was restarted and lost its timers), and then the queue would
 * wait forever. Ask the background's own stream list and the tab itself.
 */
async function sumJobAlive(job) {
    const age = Date.now() - (job.startedAt || 0);
    if (!job.startedAt || age > SUM_JOB_TIMEOUT) return false;   // a job from before this fix, or the 10-minute net
    if (age < (SUM_JOB_GRACE[job.kind] || SUM_JOB_GRACE.tab)) return true;
    if (job.tabId == null) return false;
    try { for (const r of runs.values()) if (r.tabId === job.tabId && !r.saved) return true; } catch (_) { /* no streams yet */ }
    try {
        const st = await chrome.tabs.sendMessage(job.tabId, { action: 'getSummaryState' });
        return !!(st && (st.running || st.busy));
    } catch (_) { return false; }   // tab gone or no content script: nothing runs there
}
/** Clear a running job that is no longer alive, so the next one starts. Resolves once checked. */
function reapSumJob() {
    if (sumJobs.reaping) return sumJobs.reaping;
    const job = sumJobs.running;
    if (!job) return Promise.resolve();
    sumJobs.reaping = sumJobAlive(job)
        .then(alive => { if (!alive && sumJobs.running && sumJobs.running.id === job.id) sumJobDone(job.id); })
        .catch(() => {})
        .finally(() => { sumJobs.reaping = null; });
    return sumJobs.reaping;
}
function sumJobDone(id, ok) {
    if (!sumJobs.running || sumJobs.running.id !== id) return;
    const finished = sumJobs.running;
    clearTimeout(sumJobs.timer); clearInterval(sumJobs.probe); sumJobs.running = null;
    const next = sumJobs.queue.shift();
    if (next) sumJobStart(next); else { publishSumJobs(); if (ok) notifySumDone(finished); }
}
/** Add a job; it starts right away when nothing is running. */
async function enqueueSumJob(job) {
    await sumJobsReady();
    await reapSumJob();
    const key = sumJobKey(job.url);
    const dup = [sumJobs.running, ...sumJobs.queue].find(j => j && sumJobKey(j.url) === key);
    if (dup) return { ok: true, queued: dup !== sumJobs.running, duplicate: true, id: dup.id };
    job.id = ++sumJobs.seq;
    if (!sumJobs.running) { sumJobStart(job); return { ok: true, queued: false, id: job.id }; }
    sumJobs.queue.push(job); publishSumJobs();
    return { ok: true, queued: true, position: sumJobs.queue.length, id: job.id };
}
async function cancelSumJob(id) {
    await sumJobsReady();
    const i = sumJobs.queue.findIndex(j => j.id === id);
    if (i < 0) return false;
    sumJobs.queue.splice(i, 1); publishSumJobs(); return true;
}
/** A summary in tab `tabId` finished, failed or was stopped. */
function sumJobTabFinished(tabId, ok) {
    const r = sumJobs.running;
    if (r && r.tabId === tabId) sumJobDone(r.id, ok);
}
function runSumJob(job) {
    if (job.kind === 'tab') {
        return chrome.tabs.sendMessage(job.tabId, job.message).catch(() => sumJobDone(job.id));
    }
    return openFeedItem(job.msg, job);
}
chrome.tabs.onRemoved.addListener((tabId) => { sumJobsReady().then(() => sumJobTabFinished(tabId)); });

/** Open a feed link (reusing its tab when already open) and, with `job`, run the summary in it. Resolves once started. */
async function openFeedItem(msg, job) {
    // Without a job a summarize request is inline mode (the page shows the summary itself); with one it streams to the panel.
    const mode = (msg.summarize && !job) ? 'inline' : 'extension';
    let summaryLength = 'auto';   // resolved from the article's length in the content script
    if (msg.summarize) {
        const d = await localGet([SK.summaryLength, SK.summaryLengthMode, SK.summaryLengthBias]).catch(() => ({}));
        const stored = d[SK.summaryLengthMode];
        const mode = stored === 'auto' || stored === 'custom' ? stored : (d[SK.summaryLength] ? 'custom' : 'auto');
        const bias = d[SK.summaryLengthBias];
        summaryLength = mode === 'custom' ? (Number(d[SK.summaryLength]) || 200) : (bias === 'short' || bias === 'long' ? 'auto:' + bias : 'auto');
    }
    const doSummary = !!msg.summarize;
    const background = doSummary && mode === 'extension';
    const fail = (tabId, track) => { if (track && tabId != null) untrackFeedTab(tabId, true); if (job) sumJobDone(job.id); };
    // Is the page already open somewhere? Then reuse that tab.
    let existing = null;
    try {
        const want = sumJobKey(msg.url);
        const all = await chrome.tabs.query({});
        existing = all.find(tb => tb.url && sumJobKey(tb.url) === want) || null;
    } catch (_) { /* tab list unavailable → fall back to opening a new tab */ }

    const startSummary = (tabId, track) => {
        const start = async (attempt = 0) => {
            try {
                await chrome.tabs.sendMessage(tabId, { action: 'ping' });
            } catch (e) {
                if (attempt === 1) {   // pages run only loader.js until the full script is injected
                    try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); } catch (_) { /* restricted page cannot be scripted; the retry loop handles it */ }
                }
                if (attempt < 6) return setTimeout(() => start(attempt + 1), 800);
                return fail(tabId, track);
            }
            chrome.tabs.sendMessage(tabId, { action: 'fetchSummary', summaryMode: mode, summaryLength, feedUrl: msg.url }).catch(() => fail(tabId, track));
        };
        return start;
    };

    if (existing) {
        // Already open: never open it again; never close it afterwards (it's the user's tab).
        if (job) { job.tabId = existing.id; publishSumJobs(); }
        if (!doSummary || mode === 'inline') {
            try { await chrome.tabs.update(existing.id, { active: true }); await chrome.windows.update(existing.windowId, { focused: true }); } catch (_) { /* focusing the existing tab is best-effort */ }
        }
        if (doSummary) startSummary(existing.id, false)();
        return;
    }

    await new Promise((resolve) => {
        chrome.tabs.create({ url: msg.url, active: !background }, (tab) => {
            resolve();
            if (!doSummary || !tab) { if (!tab) fail(null, false); return; }
            const tabId = tab.id;
            if (job) { job.tabId = tabId; if (sumJobs.running && sumJobs.running.id === job.id) sumJobs.running.tabId = tabId; publishSumJobs(); }
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
    });
}

/**
 * "Save only" for a link that is not open anywhere (the phone inbox): load the page in a background tab, let its content
 * script store it in History without the AI, close the tab again. A tab the user already has open is used as is and never
 * closed. Resolves { success, id?, title?, error? }.
 */
async function saveFeedItem(url) {
    let tab = null, opened = false;
    const keepAlive = setInterval(() => { try { chrome.runtime.getPlatformInfo(() => { void chrome.runtime.lastError; }); } catch (_) { /* optional */ } }, 20000);
    try {
        const want = sumJobKey(url);
        tab = (await chrome.tabs.query({})).find(tb => tb.url && sumJobKey(tb.url) === want) || null;
    } catch (_) { /* tab list unavailable → open a new one */ }
    try {
        if (!tab) {
            tab = await chrome.tabs.create({ url, active: false });
            opened = true;
            await new Promise((resolve) => {
                const done = () => { chrome.tabs.onUpdated.removeListener(onUpdated); clearTimeout(timer); resolve(); };
                const onUpdated = (id, info) => { if (id === tab.id && info.status === 'complete') done(); };
                const timer = setTimeout(done, 45000);
                chrome.tabs.onUpdated.addListener(onUpdated);
                chrome.tabs.get(tab.id).then(t => { if (t && t.status === 'complete') done(); }).catch(() => {});
            });
        }
        // Let late-rendering pages settle, then make sure the full content script is there (pages run only loader.js).
        if (opened) await new Promise(r => setTimeout(r, 1500));
        let reachable = false;
        for (let attempt = 0; attempt < 6 && !reachable; attempt++) {
            if (await ensureContent(tab.id)) {
                try { const r = await chrome.tabs.sendMessage(tab.id, { action: 'ping' }); reachable = !!(r && r.status === 'pong'); } catch (_) { /* still starting */ }
            }
            if (!reachable) await new Promise(r => setTimeout(r, 900));
        }
        if (!reachable) { console.debug('[inbox] save only: page did not answer', url); return { success: false, error: 'unreachable' }; }
        // Heavy pages (many images) can take a while: keep the worker alive, cap every try, and fall back to no images.
        let res = null, lastErr = '';
        const asked = (noImages) => Promise.race([
            chrome.tabs.sendMessage(tab.id, { action: 'savePage', feedUrl: url, noImages }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 70000))
        ]);
        for (let attempt = 0; attempt < 3 && !(res && res.success); attempt++) {
            try { res = await asked(attempt > 0); }   // first try with images, the retries without
            catch (e) { lastErr = String((e && e.message) || e); res = null; }
            if (res && (res.success || res.error === 'empty')) break;   // 'empty' will not change by asking again
            await new Promise(r => setTimeout(r, 1000));
        }
        if (res && res.success) return res;
        console.debug('[inbox] save only failed', url, (res && res.error) || lastErr);
        return { success: false, error: (res && res.error) || (lastErr === 'timeout' ? 'timeout' : 'failed'), detail: String((res && res.error) || lastErr || '').slice(0, 160) };
    } catch (e) {
        return { success: false, error: String((e && e.message) || e) };
    } finally {
        clearInterval(keepAlive);
        if (opened && tab && tab.id != null) { try { await chrome.tabs.remove(tab.id); } catch (_) { /* already closed */ } }
    }
}

// ── Messages: one table, action → { from, check, run } (claude/full-audit-2026-11-09.md, R3) ─────────────────────────
//   from   'ext'  only extension pages (popup, side panel, the in-page sidebar iframe). These spend the user's AI key or
//                 fetch on the extension's behalf, so a content script in a compromised page renderer must not reach them.
//          'page' only a page's content script (needs sender.tab).
//          'any'  both.
//   check(msg, sender)               false → the message is dropped. Payload checks live here, once.
//   run(msg, sender, sendResponse)   like an onMessage listener: return true when the answer comes later.
function fromExtensionPage(sender) {
    if (!sender || (sender.id && sender.id !== chrome.runtime.id)) return false;
    // A content script's url is the web page; an extension page's (also inside the sidebar iframe) is our own origin.
    return sender.url ? sender.url.startsWith(chrome.runtime.getURL('')) : !sender.tab;
}
const isStr = (v, max = 4096) => typeof v === 'string' && v.length > 0 && v.length <= max;
const isHttpUrl = (v) => isStr(v, 8192) && /^https?:\/\//i.test(v);
const errText = (e) => String((e && e.message) || e);
// a summary job's tab reports how it ended (no answer expected): close a feed tab shortly after, move the queue on
const summaryEnded = (msg, sender) => {
    if (msg.action !== 'summaryCancelled') untrackFeedTab(sender.tab.id, false, msg.action === 'summaryComplete' ? 6000 : 8000);
    sumJobsReady().then(() => sumJobTabFinished(sender.tab.id, msg.action === 'summaryComplete'));
    return false;
};

const MESSAGE_HANDLERS = {
    // ── library sync (settings screen); keeps running after the popup closes ──
    syncNow: { from: 'ext', run(msg, sender, sendResponse) {
        if (!syncSvc) { sendResponse({ ok: false, error: 'unavailable' }); return false; }
        // decide: { keep: [record key], remove: [record key] }, the answers to deletions from other devices, one place at a time
        const keyList = (v) => (Array.isArray(v) ? v : []).map(String).filter((k) => /^(article|hl|coll|note):[A-Za-z0-9_.:-]{1,200}$/.test(k)).slice(0, 500);
        const decide = msg.placeId && msg.decide && typeof msg.decide === 'object' ? { keep: keyList(msg.decide.keep), remove: keyList(msg.decide.remove) } : null;
        syncSvc.syncNow(msg.placeId ? String(msg.placeId) : undefined, { confirmRemovals: !!msg.confirmRemovals, decide })
            .then((results) => sendResponse({ ok: true, results })).catch((e) => sendResponse({ ok: false, error: errText(e) }));
        return true;
    } },
    syncRestore: { from: 'ext', run(msg, sender, sendResponse) {   // bring an encrypted place back to this device
        if (!syncSvc) { sendResponse({ ok: false, error: 'unavailable' }); return false; }
        syncSvc.restore(String(msg.placeId || ''))
            .then((r) => sendResponse({ ok: true, result: { pulled: r.pulled, applied: r.applied, errors: r.errors.length, more: r.more } })).catch((e) => sendResponse({ ok: false, error: errText(e) }));
        return true;
    } },
    syncHlDeleted: { from: 'any', check: (msg) => Array.isArray(msg.ids), run(msg, sender, sendResponse) {   // the user removed these highlights (Notes tab)
        if (syncStamps) syncStamps.markDeleted('hl', msg.ids.filter((i) => typeof i === 'string').slice(0, 1000));
        sendResponse({ ok: true });
        return false;
    } },

    // ── highlights and notes from a page: the page changes only its own records (highlightMessages.js, notesMessages.js) ──
    'hl:apply': { from: 'page', run(msg, sender, sendResponse) {
        if (!hlMsgs) { sendResponse({ ok: false, error: 'unavailable' }); return false; }
        hlMsgs.handle(msg, sender).then(sendResponse).catch(() => sendResponse({ ok: false, error: 'failed' }));
        return true;
    } },
    noteAdd: { from: 'page', run: (msg, sender, sendResponse) => notesMessage(msg, sender, sendResponse) },
    commentSet: { from: 'page', run: (msg, sender, sendResponse) => notesMessage(msg, sender, sendResponse) },
    openNotes: { from: 'any', run(msg, sender, sendResponse) {
        try { chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?surface=tab#notes') }); sendResponse({ ok: true }); } catch (_) { sendResponse({ ok: false }); }
        return false;
    } },

    // ── send targets, AI apps (MCP), read aloud ──
    targetEnqueue: { from: 'ext', run: (msg, sender, sendResponse) => targetMessage(() => targets.enqueue(String(msg.targetId || ''), String(msg.articleId || '')), sendResponse) },
    targetStatus: { from: 'ext', run: (msg, sender, sendResponse) => targetMessage(() => targets.status(msg.targetId ? String(msg.targetId) : ''), sendResponse) },
    targetCancel: { from: 'ext', run: (msg, sender, sendResponse) => targetMessage(() => targets.cancel(String(msg.jobId || '')), sendResponse) },
    mcpStatus: { from: 'ext', run(msg, sender, sendResponse) {
        if (!mcp) { sendResponse({ ok: true, available: false, enabled: false, connected: false }); return false; }
        getMcpConfig().then((cfg) => sendResponse({ ok: true, available: true, enabled: !!cfg.enabled, connected: mcp.isConnected(), tools: MCP.toolList().length }));
        return true;
    } },
    ttsCmd: { from: 'any', run(msg, sender, sendResponse) {
        if (!ttsEngine) { sendResponse({ ok: false, available: false }); return false; }
        ttsEngine.handle(msg).then(sendResponse).catch((e) => sendResponse({ ok: false, error: errText(e) }));
        return true;
    } },
    // Safari wakes a sleeping worker reliably for runtime.sendMessage, not for runtime.connect(): callers ping first.
    wakeup: { from: 'any', run(msg, sender, sendResponse) { sendResponse({ status: 'awake' }); return true; } },

    // ── AI requests (feeds, follow-ups, briefings) ──
    aiComplete: { from: 'ext', check: (msg) => isStr(msg.user, 2000000), run(msg, sender, sendResponse) {
        aiComplete({ system: msg.system || '', user: msg.user, id: msg.id, partial: !!msg.partial, service: msg.service, feature: msg.feature, target: msg.target })
            .then(r => sendResponse({ ok: true, text: r.text, model: r.model }))
            .catch(e => sendResponse({ ok: false, error: e.message || 'AI request failed' }));
        return true;
    } },
    aiResync: { from: 'ext', run(msg, sender, sendResponse) { if (aiJobs.has(msg.id)) aiResyncAsked.add(msg.id); sendResponse({ ok: true }); return true; } },
    aiCancel: { from: 'ext', run(msg, sender, sendResponse) { const c = aiJobs.get(msg.id); if (c) c.abort(); sendResponse({ ok: true }); return true; } },
    // Info about a local model server (context window: llama.cpp /props, LM Studio /api/v0/models/<id>). Localhost only, short timeout.
    localGetJson: { from: 'any', run(msg, sender, sendResponse) {
        if (!LOCAL_URL.test(String(msg.url || ''))) { sendResponse({ ok: false }); return false; }
        (async () => {
            const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 1500);
            try { const r = await fetch(msg.url, { signal: ctrl.signal }); sendResponse(r.ok ? { ok: true, json: await r.json() } : { ok: false, status: r.status }); }
            catch (_) { sendResponse({ ok: false }); } finally { clearTimeout(t); }
        })();
        return true;
    } },

    // ── feeds (RSS reader) ──
    feedPollConfig: { from: 'ext', run(msg, sender, sendResponse) { applyFeedPollConfig().then(() => sendResponse({ ok: true })); return true; } },
    feedBadgeClear: { from: 'ext', run(msg, sender, sendResponse) { clearFeedBadge().then(() => sendResponse({ ok: true })); return true; } },
    audioEnsure: { from: 'ext', run(msg, sender, sendResponse) {
        // Chrome: audio must live in an offscreen document. Others: the background page hosts it.
        if (chrome.offscreen && chrome.offscreen.createDocument) {
            (async () => {
                try {
                    const has = chrome.runtime.getContexts
                        ? (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0 : false;
                    if (!has) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'], justification: 'Play podcast episodes from feeds while the popup is closed' });
                    sendResponse({ ok: true });
                } catch (e) { sendResponse({ ok: false, error: errText(e) }); }
            })();
            return true;
        }
        sendResponse({ ok: typeof AishAudio !== 'undefined' });
        return false;
    } },
    // Fetch a feed or site page for the popup. Returns raw text; the popup parses it (no DOMParser in the worker).
    fetchFeedText: { from: 'ext', check: (msg) => isStr(msg.url, 8192), run(msg, sender, sendResponse) {
        (async () => {
            let timer = null;
            try {
                if (!/^https?:\/\//i.test(msg.url)) throw new Error('Unsupported address');
                const ctrl = new AbortController();
                const timeoutMs = Math.max(1000, Math.min(15000, Number(msg.timeoutMs) || 15000));
                timer = setTimeout(() => ctrl.abort(), timeoutMs);
                const res = await fetch(msg.url, {
                    credentials: 'omit',
                    redirect: 'follow',
                    signal: ctrl.signal,
                    headers: {
                        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5',
                        ...(msg.etag ? { 'If-None-Match': msg.etag } : {}),
                        ...(msg.lastModified ? { 'If-Modified-Since': msg.lastModified } : {})
                    }
                });
                const details = {
                    status: res.status, url: res.url || msg.url, contentType: res.headers.get('content-type') || '',
                    etag: res.headers.get('etag') || '', lastModified: res.headers.get('last-modified') || '',
                    cacheControl: res.headers.get('cache-control') || '', retryAfter: res.headers.get('retry-after') || ''
                };
                if (!res.ok && res.status !== 304) {
                    sendResponse({ ok: false, error: 'HTTP ' + res.status, ...details });
                    return;
                }
                const text = res.status === 304 ? '' : (await res.text()).slice(0, 3 * 1024 * 1024);
                sendResponse({ ok: true, text, ...details });
            } catch (e) {
                sendResponse({ ok: false, error: e.name === 'AbortError' ? 'Timed out' : (e.message || 'Request failed') });
            } finally { if (timer) clearTimeout(timer); }
        })();
        return true;
    } },
    // Open a feed item in a new tab; optionally summarize it once loaded, in the mode last picked on the Summarize screen:
    //   inline → foreground tab, summary inserted into the page; extension → queued background tab that closes itself when done
    openFeedItem: { from: 'ext', check: (msg) => isStr(msg.url, 8192), run(msg, sender, sendResponse) {
        if (!/^https?:\/\//i.test(msg.url)) { sendResponse({ success: false }); return false; }
        (async () => {
            if (!msg.summarize) { await openFeedItem(msg, null); sendResponse({ success: true, mode: null }); return; }
            const d = await localGet([SK.summaryMode]).catch(() => ({}));
            const mode = (d[SK.summaryMode] === 'inline' && !msg.forceExtension) ? 'inline' : 'extension';
            if (mode === 'inline') { await openFeedItem(msg, null); sendResponse({ success: true, mode }); return; }
            const r = await enqueueSumJob({ kind: 'feed', url: msg.url, title: msg.title || '', msg });
            sendResponse({ success: true, mode, queued: !!r.queued, position: r.position || 0, id: r.id });
        })();
        return true;
    } },
    saveFeedItem: { from: 'ext', check: (msg) => isStr(msg.url, 8192), run(msg, sender, sendResponse) {
        if (!/^https?:\/\//i.test(msg.url)) { sendResponse({ success: false, error: 'bad-url' }); return false; }
        saveFeedItem(msg.url).then(sendResponse, () => sendResponse({ success: false, error: 'failed' }));
        return true;
    } },
    // A page that is open in a tab and also waits in the phone inbox reports its real title / description (from the loader).
    inboxMeta: { from: 'page', check: (msg) => isStr(msg.url, 8192), run(msg, sender, sendResponse) {
        if (INBOX && INBOX.applyLinkMeta) {
            (async () => {
                try {
                    const d = await localGet([SK.inboxPending]);
                    const list = Array.isArray(d[SK.inboxPending]) ? d[SK.inboxPending] : [];
                    if (INBOX.applyLinkMeta(list, sender.tab.url || '', msg)) await new Promise(r => chrome.storage.local.set({ [SK.inboxPending]: list }, r));
                } catch (_) { /* cosmetic */ }
            })();
        }
        sendResponse({ ok: true });
        return false;
    } },

    // ── summary queue ──
    queueSummary: { from: 'ext', check: (msg) => msg.tabId != null && !!msg.message, run(msg, sender, sendResponse) {
        enqueueSumJob({ kind: 'tab', tabId: msg.tabId, url: msg.url || '', title: msg.title || '', message: msg.message }).then(sendResponse);
        return true;
    } },
    cancelQueuedSummary: { from: 'ext', run(msg, sender, sendResponse) { cancelSumJob(msg.id).then(ok => sendResponse({ ok })); return true; } },
    summaryJobs: { from: 'ext', run(msg, sender, sendResponse) {
        sumJobsReady().then(reapSumJob).then(() => sendResponse({ ok: true, running: sumJobInfo(sumJobs.running), queue: sumJobs.queue.map(sumJobInfo) }));
        return true;
    } },
    summaryComplete: { from: 'page', run: summaryEnded },
    summaryError: { from: 'page', run: summaryEnded },
    summaryCancelled: { from: 'page', run: summaryEnded },

    // ── tab proxy: a Firefox sidebar iframe gets content-script privileges (no chrome.tabs), so the worker does the tab work ──
    getActiveTab: { from: 'any', run(msg, sender, sendResponse) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs && tabs[0];
            sendResponse({ success: !!tab, tab: tab ? { id: tab.id, url: tab.url } : null });
        });
        return true;
    } },
    // The loader (loader.js) asks for the full content script: saved highlights on this page, or a text selection.
    'aish:injectContent': { from: 'page', run(msg, sender, sendResponse) {
        ensureContent(sender.tab.id).then((ok) => sendResponse({ ok })).catch(() => sendResponse({ ok: false }));
        return true;
    } },
    relayToActiveTab: { from: 'ext', check: (msg) => !!msg.message && typeof msg.message === 'object', run(msg, sender, sendResponse) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs && tabs[0];
            if (!tab) { sendResponse({ success: false, error: 'No active tab' }); return; }
            chrome.tabs.sendMessage(tab.id, msg.message, (response) => {
                if (chrome.runtime.lastError) { sendResponse({ success: false, error: chrome.runtime.lastError.message }); return; }
                sendResponse({ success: true, response });
            });
        });
        return true;
    } },
    sendLocalSendP2P: { from: 'ext', check: (msg) => isHttpUrl(msg.targetUrl), run(msg, sender, sendResponse) {
        const method = msg.method || 'POST';
        const isJson = msg.isJson !== false;
        const headers = msg.headers || { 'Content-Type': isJson ? 'application/json' : 'application/octet-stream' };
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        let body = msg.body;
        if (isJson) body = typeof body === 'string' ? body : JSON.stringify(body);
        else if (Array.isArray(body)) body = new Uint8Array(body).buffer;   // byte payload sent as a number array through messaging
        fetch(msg.targetUrl, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : body, signal: controller.signal })
            .then(async (res) => {
                clearTimeout(timeout);
                const text = await res.text();
                let data = null;
                try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
                sendResponse({ success: true, ok: res.ok, status: res.status, data, text });
            })
            .catch((err) => { clearTimeout(timeout); sendResponse({ success: false, error: err?.message || 'Network request failed' }); });
        return true;
    } },
    // Native side panel is Chrome-only; on Firefox/Safari/iOS the caller falls back to the hybrid sidebar.
    openNativeSidePanel: { from: 'any', run(msg, sender, sendResponse) {
        if (!chrome.sidePanel) { sendResponse({ success: false, error: 'sidePanel API not available' }); return false; }
        const windowId = sender?.tab?.windowId;
        if (windowId) {
            chrome.sidePanel.open({ windowId }).then(() => sendResponse({ success: true })).catch(err => sendResponse({ error: err.message }));
        } else {
            chrome.windows.getAll({}, (windows) => {
                if (windows.length > 0) chrome.sidePanel.open({ windowId: windows[0].id }).then(() => sendResponse({ success: true })).catch(err => sendResponse({ error: err.message }));
                else sendResponse({ success: false, error: 'no window' });
            });
        }
        return true;
    } },

    // ── Speed-Read: close the tab at the end; "Reopen" brings it back (no extra permission: a new tab with the URL) ──
    speedReadCloseTab: { from: 'page', run(msg, sender, sendResponse) {
        const tab = sender.tab || {};
        chrome.tabs.remove(tab.id, () => void chrome.runtime.lastError);
        if (tab.url && chrome.notifications) {
            reopenUrls.set(String(tab.id), tab.url);
            chrome.notifications.create(`reopen_${tab.id}`, {
                type: 'basic', iconUrl: 'icons/icon48.png',
                title: bgT('notifTabClosedTitle', 'Tab closed · the summary is saved'),
                message: String(msg.title || tab.title || tab.url).slice(0, 200),
                buttons: [{ title: bgT('notifReopen', 'Reopen') }],
            }, () => void chrome.runtime.lastError);
        }
        sendResponse({ ok: true });
        return false;
    } },
    // ── "read later" reminder for a saved article: { articleId, timeframe, dueAt } (dueAt null/none = no reminder) ──
    decisionSave: { from: 'page', check: (msg) => typeof msg.articleId === 'string' && ['none', 'tomorrow', 'weekend', 'week'].includes(msg.timeframe) && (msg.dueAt == null || Number.isFinite(msg.dueAt)), run(msg, sender, sendResponse) {
        withArticlesLock(async () => {
            const { [SK.articlesIndex]: index = [] } = await localGet({ [SK.articlesIndex]: [] });
            const i = index.findIndex((a) => a && a.id === msg.articleId);
            if (i < 0) return { ok: false, error: 'not-found' };
            const a = index[i];
            const on = msg.timeframe !== 'none' && msg.dueAt != null && msg.dueAt > Date.now();
            index[i] = on
                ? { ...a, isDecision: true, decisionTimeframe: msg.timeframe, decisionSavedAt: new Date().toISOString(), decisionDueAt: msg.dueAt }
                : { ...a, isDecision: false, decisionTimeframe: undefined, decisionDueAt: undefined };
            await chrome.storage.local.set({ [SK.articlesIndex]: index });
            const name = decisionAlarmName(a.timestamp);
            try { await chrome.alarms.clear(name); } catch (_) { /* none yet */ }
            if (on) chrome.alarms?.create(name, { when: msg.dueAt });
            return { ok: true, dueAt: on ? msg.dueAt : null };
        }).then(sendResponse, (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
        return true;
    } },

    // ── fetches for content scripts, which follow the page's CORS / mixed-content rules (Safari also for images) ──
    fetchImageAsDataUrl: { from: 'any', check: (msg) => isHttpUrl(msg.url), run(msg, sender, sendResponse) {
        (async () => {
            try {
                const res = await fetch(msg.url);
                if (!res.ok) { sendResponse({ success: false, error: `HTTP ${res.status}` }); return; }
                const contentType = res.headers.get('content-type') || 'image/jpeg';
                const buf = await res.arrayBuffer();
                sendResponse({ success: true, dataUrl: `data:${contentType};base64,${arrayBufferToBase64(buf)}` });
            } catch (err) {
                sendResponse({ success: false, error: err?.message || 'Image fetch failed' });
            }
        })();
        return true;
    } },
    // PDF bytes for a cross-origin embed (e.g. a reader page that embeds the PDF from another host)
    fetchPdfBytes: { from: 'any', check: (msg) => isHttpUrl(msg.url), run(msg, sender, sendResponse) {
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
    } },

    // ── streaming summaries: message based, not ports (Safari does not re-register onConnect after waking an event page) ──
    runDetached: { from: 'any', check: (msg) => !!msg.requestId, run(msg, sender, sendResponse) { markDetached(msg.requestId); sendResponse({ ok: true }); return false; } },
    runSaved: { from: 'any', check: (msg) => !!msg.requestId, run(msg, sender, sendResponse) { const r = runs.get(msg.requestId); if (r) { r.saved = true; runs.delete(msg.requestId); } sendResponse({ ok: true }); return false; } },
    stopFetch: { from: 'any', check: (msg) => !!msg.requestId, run(msg, sender, sendResponse) {
        const c = activeStreams.get(msg.requestId);
        if (c) { stoppedStreams.add(msg.requestId); c.abort(); }
        sendResponse({ stopped: !!c });
        return false;
    } },
    startFetch: { from: 'any', check: (msg) => !!msg.requestId, run(msg, sender, sendResponse) {
        (async () => {
            // Safari sometimes omits sender.tab.id for content scripts: then push the chunks to the active tab
            let tabId = sender?.tab?.id;
            if (tabId == null) { const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true }); tabId = activeTab?.id; }
            if (tabId == null) { console.error('[AISH Background] No active tab found for startFetch'); return; }
            handleStreamFetch(msg, tabId);
        })();
        // Answer at once, without `return true`: in Safari an async answer can close the port early ("message port closed").
        sendResponse({ started: true });
        return false;
    } },
};
function notesMessage(msg, sender, sendResponse) {
    if (!notesMsgs) { sendResponse({ ok: false, error: 'unavailable' }); return false; }
    notesMsgs.handle(msg, sender).then(sendResponse).catch(() => sendResponse({ ok: false, error: 'failed' }));
    return true;
}
function targetMessage(start, sendResponse) {
    if (!targets) { sendResponse({ ok: false, error: 'targets-unavailable' }); return false; }
    start().then(sendResponse).catch((e) => sendResponse({ ok: false, error: errText(e) }));
    return true;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.action !== 'string') return false;
    const h = Object.prototype.hasOwnProperty.call(MESSAGE_HANDLERS, msg.action) ? MESSAGE_HANDLERS[msg.action] : null;
    if (!h) return false;   // not ours (other listeners, other surfaces)
    if (h.from === 'ext' && !fromExtensionPage(sender)) { sendResponse({ ok: false, success: false, error: 'Not allowed from a web page' }); return false; }
    // a page-only or malformed message is dropped without an answer (as before the table): another listener may own it
    if (h.from === 'page' && !(sender && sender.tab && sender.tab.id != null)) return false;
    if (h.check && !h.check(msg, sender)) return false;
    return h.run(msg, sender, sendResponse);
});

chrome.commands?.onCommand?.addListener((command) => {
    if (command === 'toggle-popup') {
        chrome.action.openPopup();
    } else if (command === 'fetch-summary') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0]) sendToTab(tabs[0].id, { action: 'fetchSummary' }).catch(() => {});
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
        r.ok = true;
        if (r.ctx.summaryMode === 'extension') {
            broadcast({ action: 'summaryComplete', summary: out.cleanHtml, title: out.title, url: r.ctx.sourceUrl, timestamp: new Date().toISOString(), tags: out.tags, modelId: r.ctx.modelIdentifier, moodScore: out.moodScore, questions: out.questions, quick: out.quick, meta: out.pageMeta, content: r.ctx.contentHtml });
        }
        if (out.article && out.article.id) broadcast({ action: 'summarySaved', id: out.article.id, url: r.ctx.sourceUrl });
    } catch (e) {
        console.error('[AISH Background] Could not finish the summary of a closed page:', e);
    } finally {
        r.saved = true; runs.delete(r.id);
        sumJobsReady().then(() => sumJobTabFinished(r.tabId, !!r.ok));   // its own broadcast never reaches this listener
    }
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

        const response = await aiFetch(apiUrl, { method: 'POST', headers: { ...headers, ...(await cloudRegionHeader(apiUrl, msg.feature)) }, body, signal: controller.signal });
        { let m = ''; try { m = JSON.parse(body).model || ''; } catch (_) { /* not JSON */ } noteCloudRoute(apiUrl, response, m); }

        const fallback = response.headers.get('x-aish-fallback') || '';   // another local model answered (the chosen one was not ready)
        if (fallback) push({ meta: 'fallback', to: fallback, from: response.headers.get('x-aish-fallback-from') || '' });
        const modelUsed = fallback || usedModelOf(apiUrl, response);
        if (modelUsed && run) run.ctx.modelIdentifier = modelUsed;   // a summary finished here (its page was closed) is saved under the model that wrote it
        push({ meta: 'response', requestId, status: response.status, contentType: response.headers.get('content-type') || '', ...(modelUsed ? { modelUsed } : {}) });

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
        if (run) {
            if (run.detached && run.ctx.summaryMode === 'extension') broadcast({ action: 'summaryError', error: errorMessage });
            if (run.detached) sumJobsReady().then(() => sumJobTabFinished(run.tabId, false));   // the page is gone, nobody else reports it
            runs.delete(requestId);
        }
    } finally {
        activeStreams.delete(requestId);
    }
}