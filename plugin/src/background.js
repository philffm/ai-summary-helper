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
/* global FEED_ALARM, applyFeedPollConfig, clearFeedBadge, pollFeeds, cloudRegionHeader, usedModelOf, noteCloudRoute, LOCAL_URL, aiFetch, aiJobs, aiResyncAsked, aiComplete -- defined in bg/feedPoll.js and bg/aiComplete.js */
const FIN = globalThis.AISH_FINALIZE || null;
const INBOX = globalThis.AISH_INBOX || null;
const TARGETS = globalThis.AISH_TARGETS || null;
const FEED_WORKER = globalThis.AISH_FEED_WORKER || null;   /* exported FEED_WORKER -- used by bg/feedPoll.js and bg/aiComplete.js */
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
        chrome.contextMenus.create({ id: 'aish-summarize-close',  title: t('ctxSummarizeClose', '✨ Summarize & close tab'),     contexts: ['page'] });
    });
});

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
    } else if (info.menuItemId === 'aish-summarize-close') {
        sendToTab(tab.id, { action: 'fetchSummaryAndClose', summaryMode: 'extension' }).catch(() => {});
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

// ── Feeds: background polling + Ollama processing: bg/feedPoll.js ──
try { if (typeof importScripts === 'function') importScripts('bg/feedPoll.js'); } catch (_) { /* listed in the manifest instead */ }

if (typeof AishAudio !== 'undefined' && typeof Audio !== 'undefined') AishAudio.host();

// ── One-shot AI completion (feed recaps, tone scoring): bg/aiComplete.js ──
try { if (typeof importScripts === 'function') importScripts('bg/aiComplete.js'); } catch (_) { /* listed in the manifest instead */ }

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
        title: '🔖 Ready to review?',
        message: article.title || article.url,
        contextMessage: article.decisionReason || '',
        buttons: [{ title: 'Open' }, { title: 'Dismiss' }],
        requireInteraction: true
    });
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

    // ── save for later ("Summarize & close") ──
    closeTabSelf: { from: 'page', run(msg, sender, sendResponse) {
        chrome.tabs.remove(sender.tab.id);
        sendResponse({ ok: true });
        return false;
    } },
    scheduleDecisionAlarm: { from: 'page', check: (msg) => !!msg.article && typeof msg.article === 'object', run(msg, sender, sendResponse) {
        const delayMins = decisionAlarmDelayMinutes(msg.article.decisionTimeframe);
        // the encoded timestamp names the alarm, so the alarm finds its article
        if (delayMins) chrome.alarms?.create(`decision_${encodeURIComponent(msg.article.timestamp)}`, { delayInMinutes: delayMins });
        sendResponse({ ok: true });
        return false;
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