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
try { if (typeof importScripts === 'function') importScripts('feed-worker.js'); } catch (_) { /* listed in the manifest instead */ }
const FIN = globalThis.AISH_FINALIZE || null;
const FEED_WORKER = globalThis.AISH_FEED_WORKER || null;
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
    feedBackground: 'feeds:background',
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
    summaryLengthMode: 'ui:summaryLengthMode',   // 'auto' | 'custom' (absent = auto for new installs, custom when a number was saved earlier)
    summaryLengthBias: 'ui:summaryLengthBias',   // 'short' | 'standard' | 'long' (scales the automatic length)
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

// Pages run only a tiny loader (loader.js). The full content script is injected the first time something needs it:
// the loader asks for it (saved highlights, text selection), and every sender below injects before it talks to a tab.
async function ensureContent(tabId) {
    try { const r = await chrome.tabs.sendMessage(tabId, { action: 'ping' }); if (r && r.status === 'pong') return true; } catch (_) { /* not injected yet */ }
    try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); return true; } catch (_) { return false; }
}
async function sendToTab(tabId, message) { await ensureContent(tabId); return chrome.tabs.sendMessage(tabId, message); }

chrome.contextMenus.onClicked.addListener((info, tab) => {
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

// ── Feeds: background polling + Ollama processing ────────────────────────────
const FEED_ALARM = 'feedPoll';

async function pruneBackgroundFeedData(settings) {
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
        const plan = FEED_WORKER.planLibrary({
            items: mergedItems, recaps, source: 'all', inSource: () => true,
            startOfDay: FEED_WORKER.startOfDay, itemSig: FEED_WORKER.itemSig, includeToday: true,
            subs: d.feedSubs, topicLang
        });
        const configuredBatch = [10, 20, 40].includes(Number(state.batchSize || d.feedSettings.libraryBatch))
            ? Number(state.batchSize || d.feedSettings.libraryBatch) : 20;
        const work = FEED_WORKER.boundedLibraryPlan(plan, configuredBatch, FEED_MAX_REQUESTS_PER_TICK);
        if (!work.rate.length && !work.days.length && !(work.tag && work.tag.length)) return;

        const subscriptions = new Map(d.feedSubs.map(sub => [sub.id, sub]));
        let timedOut = false;
        const saveRatings = (items) => {
            for (const item of items) {
                const { ai, sent, cat } = item;
                if (ai || sent !== undefined || cat) state.ratings[item.id] = { ...(ai ? { ai } : {}), ...(sent !== undefined ? { sent } : {}), ...(cat ? { cat } : {}) };
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
        const rateChunk = async (chunk, signal) => {
            const result = await aiCall(aiSignal => FEED_WORKER.scoreItems(chunk, i => (subscriptions.get(i.feedId) || {}).customTitle || (subscriptions.get(i.feedId) || {}).title || '', { signal: aiSignal, service: 'ollama' }), signal);
            chunk.forEach((item, index) => {
                if (!item.ai && result.scores[index] !== null) { item.sent = result.scores[index]; item.ai = true; }
                if (!item.cat && result.labels && result.labels[index]) item.cat = result.labels[index];
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
        const result = await FEED_WORKER.runLibrary(work, configuredBatch, { rateChunk, tagFeed, recapDay, signal: runController.signal });
        if (timedOut && configuredBatch > 10) state.batchSize = 10;
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
async function aiComplete({ system, user, id, partial, service: forcedService, signal }) {
    const sync = await chrome.storage.sync.get(['activeService', 'connectionMode', 'preferredCloudModel']).catch(() => ({}));
    const local = await localGet([SK.servicesConfig, SK.licenseKey, SK.token, SK.installId]).catch(() => ({}));
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
    const abort = () => ctrl.abort();
    if (signal) {
        if (signal.aborted) ctrl.abort();
        else signal.addEventListener('abort', abort, { once: true });
    }
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
        if (signal) signal.removeEventListener('abort', abort);
    }
}

if (typeof FEED_WORKER !== 'undefined' && FEED_WORKER) {
    FEED_WORKER.setAiTransport(({ system, user, signal, partial, service }) =>
        aiComplete({ system, user, signal, partial, service }).then(result => result.text));
}

chrome.runtime.onStartup.addListener(() => applyFeedPollConfig());
chrome.runtime.onInstalled.addListener(() => applyFeedPollConfig());

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === FEED_ALARM) { await pollFeeds(); return; }
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

// ── Summary job queue ───────────────────────────────────────────────────────
// Summaries that stream into the panel ('extension' mode) run one at a time, whatever started them (the Summarize
// button on any tab, a Feeds card, History). A request made while one is running waits here and starts by itself.
// Jobs are plain data so the queue survives a restarted service worker (kept in storage.session when available).
//   { id, kind: 'tab', tabId, url, title, message }   → summarize an already open tab
//   { id, kind: 'feed', url, title, msg }              → open a feed link (or reuse its tab), then summarize it
const SUM_JOB_TIMEOUT = 10 * 60 * 1000;   // safety net if no completion message ever arrives
const sumJobs = { running: null, queue: [], seq: 0, timer: null, ready: null };
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
        const d = await localGet(SK.feedPending);
        const pending = d[SK.feedPending] || 0;
        if (pending > 0) await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
        await chrome.action.setBadgeText({ text: pending > 0 ? (pending > 99 ? '99+' : String(pending)) : '' });
    } catch (_) { /* badge is cosmetic */ }
}
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
chrome.notifications.onClicked.addListener(async (notifId) => {
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
}
function sumJobStart(job) {
    sumJobs.running = job; armSumJobTimer(job.id); publishSumJobs();
    Promise.resolve().then(() => runSumJob(job)).catch(() => sumJobDone(job.id));
}
function sumJobDone(id, ok) {
    if (!sumJobs.running || sumJobs.running.id !== id) return;
    const finished = sumJobs.running;
    clearTimeout(sumJobs.timer); sumJobs.running = null;
    const next = sumJobs.queue.shift();
    if (next) sumJobStart(next); else { publishSumJobs(); if (ok) notifySumDone(finished); }
}
/** Add a job; it starts right away when nothing is running. */
async function enqueueSumJob(job) {
    await sumJobsReady();
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

// Actions only extension pages (popup, side panel, in-page sidebar iframe) send. They spend the user's AI key or fetch
// on the extension's behalf, so a content script running in a compromised page renderer must not reach them.
const EXTENSION_PAGE_ACTIONS = new Set(['aiComplete', 'aiCancel', 'fetchFeedText', 'openFeedItem', 'feedPollConfig', 'feedBadgeClear', 'audioEnsure', 'relayToActiveTab', 'sendLocalSendP2P', 'queueSummary', 'cancelQueuedSummary', 'summaryJobs']);
function fromExtensionPage(sender) {
    if (!sender || (sender.id && sender.id !== chrome.runtime.id)) return false;
    // A content script's url is the web page; an extension page's (also inside the sidebar iframe) is our own origin.
    return sender.url ? sender.url.startsWith(chrome.runtime.getURL('')) : !sender.tab;
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && EXTENSION_PAGE_ACTIONS.has(msg.action) && !fromExtensionPage(sender)) {
        sendResponse({ ok: false, success: false, error: 'Not allowed from a web page' });
        return false;
    }
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
        aiComplete({ system: msg.system || '', user: msg.user, id: msg.id, partial: !!msg.partial, service: msg.service })
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
    }

    // Open a feed item in a new tab; optionally summarize it once the page has
    // loaded, following the mode last picked on the Summarize screen:
    //   inline    → foreground tab, summary inserted into the page
    //   extension → background tab, summary streams to the popup/History and the
    //               tab closes itself when done
    if (msg.action === 'openFeedItem' && msg.url) {
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
    }
    if (msg.action === 'queueSummary' && msg.tabId != null && msg.message) {
        enqueueSumJob({ kind: 'tab', tabId: msg.tabId, url: msg.url || '', title: msg.title || '', message: msg.message })
            .then(sendResponse);
        return true;
    }
    if (msg.action === 'cancelQueuedSummary') { cancelSumJob(msg.id).then(ok => sendResponse({ ok })); return true; }
    if (msg.action === 'summaryJobs') {
        sumJobsReady().then(() => sendResponse({ ok: true, running: sumJobInfo(sumJobs.running), queue: sumJobs.queue.map(sumJobInfo) }));
        return true;
    }

    // A feed-opened background tab reports it's finished → close it shortly
    // after (the content script saves the article right after relaying).
    if ((msg.action === 'summaryComplete' || msg.action === 'summaryError') && sender.tab) {
        untrackFeedTab(sender.tab.id, false, msg.action === 'summaryComplete' ? 6000 : 8000);
    }
    if ((msg.action === 'summaryComplete' || msg.action === 'summaryError' || msg.action === 'summaryCancelled') && sender.tab) {
        sumJobsReady().then(() => sumJobTabFinished(sender.tab.id, msg.action === 'summaryComplete'));
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

    // The loader (loader.js) asks for the full content script: saved highlights on this page, or a text selection.
    if (msg.action === 'aish:injectContent') {
        const id = sender && sender.tab && sender.tab.id;
        if (id == null) { sendResponse({ ok: false }); return false; }
        ensureContent(id).then((ok) => sendResponse({ ok })).catch(() => sendResponse({ ok: false }));
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
        if (r.ctx.summaryMode === 'extension') {
            broadcast({ action: 'summaryComplete', summary: out.cleanHtml, title: out.title, url: r.ctx.sourceUrl, timestamp: new Date().toISOString(), tags: out.tags, modelId: r.ctx.modelIdentifier, moodScore: out.moodScore, questions: out.questions, quick: out.quick, meta: out.pageMeta, content: r.ctx.contentHtml });
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