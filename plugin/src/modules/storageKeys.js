// modules/storageKeys.js
// Single registry of every chrome.storage KEY the extension owns.
//
//   chrome.storage is a flat key/value store, so we organise by naming:
//   `domain:name`. DevTools sorts keys alphabetically, which groups a domain
//   together (articles:*, feeds:*, account:*, ...). Never nest big objects under
//   one key (every save would rewrite all of it) — one key per independently
//   written thing.
//
//   Preferences (chrome.storage.sync) are small, user-visible settings and keep
//   their plain names; they are not listed here.
//
// Rules for contributors:
//   • new local key → add it here first, use SK.<name> in code (never a literal);
//   • rename → keep the old name in SK_LEGACY so the migration moves user data;
//   • tests/test41.mjs fails when code reads a local key that is not registered.
//
// NOTE: background.js is a classic (non-module) worker and cannot import this
// file. It carries a generated copy between `storage-keys:begin/end` markers;
// tests/test41.mjs fails if that copy drifts from this registry.

/** logical name → storage key (chrome.storage.local) */
export const SK = {
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

export const KEYS_SCHEMA = 1;

/** Prefix of the per-article record keys: articles:rec:<id> */
export const ARTICLE_REC = 'articles:rec:';
export const articleRecKey = (id) => ARTICLE_REC + id;
export const isArticleRecKey = (k) => typeof k === 'string' && k.startsWith(ARTICLE_REC);

/** old (pre-registry) key → new key. Used by the migration and by backup import. */
export const SK_LEGACY = {
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
export const ARTICLE_REC_LEGACY = 'article:';
/** keys that no longer exist anywhere; removed by the migration */
export const SK_DEAD = ['ghostHighlights', 'articleHistory'];

/** Every local key the app may hold (static ones; article records are a prefix). */
export const LOCAL_KEY_LIST = Object.values(SK);

/** Translate one key from the old naming to the new one (identity if already new). */
export function renameKey(k) {
    if (Object.prototype.hasOwnProperty.call(SK_LEGACY, k)) return SK_LEGACY[k];
    if (typeof k === 'string' && k.startsWith(ARTICLE_REC_LEGACY)) return ARTICLE_REC + k.slice(ARTICLE_REC_LEGACY.length);
    return k;
}
/** Translate a whole object (backup import). New names win over old ones. */
export function renameKeys(obj) {
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
export function migrateStorageKeys(area) {
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
