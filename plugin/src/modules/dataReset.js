// dataReset.js — what "Delete settings", "Delete history" and "Delete all data" really remove.
//
// Every key the extension owns belongs to one category here; test104 fails when a key in storageKeys.js (SK) is in none of them,
// so a key added later can never be forgotten by a delete button. The functions take the storage areas as arguments (default:
// the real chrome ones) so they can be tested with plain objects.
import { SK, SK_LEGACY, SK_DEAD, ARTICLE_REC, ARTICLE_REC_LEGACY } from './storageKeys.js';

export const CATEGORY_IDS = ['articles', 'highlights', 'feeds', 'podcasts', 'keys', 'send', 'prefs'];

export const CATEGORIES = {
    // the summaries and everything attached to them
    articles: { keys: [SK.articlesIndex, SK.articlesSchema], prefixes: [ARTICLE_REC, ARTICLE_REC_LEGACY], extra: ['articles', 'articleHistory'] },
    // yellow highlights and AI ghost highlights, all pages
    highlights: { keys: [SK.annotations], extra: [...SK_DEAD.filter((k) => k !== 'articleHistory'), 'annotations'] },
    // RSS: subscriptions, fetched items, recaps, mood snapshots, listening position, background processing state
    feeds: { keys: [SK.feedSubs, SK.feedItems, SK.feedRecaps, SK.feedMood, SK.feedAudioPos, SK.feedBackground, SK.feedBgSeen, SK.feedPending] },
    podcasts: { keys: [SK.podcasts] },
    // API keys and endpoints, sign-in, license
    keys: { keys: [SK.servicesConfig, SK.token, SK.user, SK.otpId, SK.otpEmail, SK.otpExpiresAt, SK.otpRequestedAt, SK.licenseKey], extra: ['servicesConfig'] },
    // Kindle addresses, LocalSend targets
    send: { keys: [SK.devices, SK.activeDevices, SK.localSendIp, SK.devicesMigrated] },
    // preferences: everything in sync storage, plus the local UI state and the feed / podcast preferences
    prefs: {
        syncAll: true, localStorageToo: true,
        keys: [SK.feedSettings, SK.feedUi, SK.podcastName, SK.podcastLength, SK.podcastStyle, SK.podcastCustomStyle,
            SK.summaryMode, SK.summaryLength, SK.summaryLengthMode, SK.summaryLengthBias, SK.activityView, SK.workspace, SK.reviewPrompt, SK.exportAllQuestions],
    },
};

/** Bookkeeping keys: removed only together with everything (a partial delete must not break the migrations). */
export const META_KEYS = [SK.migrationVersion, SK.keysSchema, SK.installId, SK.installedAt];

// old (pre-registry) names of a set of keys
const legacyNames = (keys) => Object.entries(SK_LEGACY).filter(([, nu]) => keys.includes(nu)).map(([old]) => old);

/** Every local key a category owns, including old names. Article records are matched by prefix (see keysToRemove). */
export function staticKeys(id) {
    const c = CATEGORIES[id];
    return [...new Set([...c.keys, ...legacyNames(c.keys), ...(c.extra || [])])];
}
const prefixesOf = (ids) => ids.flatMap((id) => CATEGORIES[id].prefixes || []);

/** The keys in `allKeys` that the chosen categories own. */
export function keysToRemove(ids, allKeys, { everything = false } = {}) {
    if (everything) return [...allKeys];
    const names = new Set(ids.flatMap(staticKeys));
    const prefixes = prefixesOf(ids);
    return allKeys.filter((k) => names.has(k) || prefixes.some((p) => String(k).startsWith(p)));
}

/** Every key in SK is either owned by a category or a meta key. (Used by the test.) */
export function uncoveredKeys() {
    const covered = new Set([...CATEGORY_IDS.flatMap(staticKeys), ...META_KEYS]);
    return Object.values(SK).filter((k) => !covered.has(k));
}

// ── storage helpers (callback style works in Chrome, Firefox and Safari) ──
const call = (area, fn, ...args) => new Promise((resolve, reject) => {
    try {
        area[fn](...args, (res) => {
            const err = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError;
            if (err) reject(new Error(err.message)); else resolve(res);
        });
    } catch (e) { reject(e); }
});

const count = (v) => Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : (v ? 1 : 0));

/** What there is to delete, per category, for the dialog: { articles: n, highlights: n, feeds: n, podcasts: n, keys: n, send: n, prefs: null } */
export async function describeData({ local = chrome.storage.local, sync = chrome.storage.sync } = {}) {
    const all = (await call(local, 'get', null)) || {};
    const syncAll = sync ? ((await call(sync, 'get', null)) || {}) : {};
    const services = all[SK.servicesConfig] || syncAll.servicesConfig || {};
    const withKey = Object.values(services).filter((s) => s && s.apiKey).length;
    const token = (all[SK.token] || all[SK.licenseKey] || all.pb_token || syncAll.licenseKey) ? 1 : 0;
    const prefsCount = Object.keys(syncAll).length + CATEGORIES.prefs.keys.filter((k) => k in all).length;
    return {
        articles: count(all[SK.articlesIndex]),
        highlights: count(all[SK.annotations]),
        feeds: count(all[SK.feedSubs]),
        feedItems: count(all[SK.feedItems]),
        podcasts: count(all[SK.podcasts]),
        keys: withKey + token,
        send: count(all[SK.devices]),
        prefs: prefsCount,
    };
}

/**
 * Delete the chosen categories. `everything` = all of them: both storage areas, session state, alarms, badge, popup localStorage.
 * Returns { removed: <number of local keys removed>, everything }.
 */
export async function deleteData(ids, env = {}) {
    const { local = chrome.storage.local, sync = chrome.storage.sync, session = chrome.storage.session, alarms = chrome.alarms, action = chrome.action, ls } = env;
    const storageLs = ls !== undefined ? ls : (typeof localStorage !== 'undefined' ? localStorage : null);
    const chosen = CATEGORY_IDS.filter((id) => ids.includes(id));
    const everything = CATEGORY_IDS.every((id) => chosen.includes(id));
    if (!chosen.length) return { removed: 0, everything: false };

    const all = (await call(local, 'get', null)) || {};
    const remove = keysToRemove(chosen, Object.keys(all), { everything });
    if (everything) await call(local, 'clear');
    else if (remove.length) await call(local, 'remove', remove);

    if (sync) {
        if (everything || chosen.includes('prefs')) await call(sync, 'clear');
        else {   // old builds kept some of these in sync storage
            const syncKeys = Object.keys((await call(sync, 'get', null)) || {});
            const rm = keysToRemove(chosen, syncKeys);
            if (rm.length) await call(sync, 'remove', rm);
        }
    }
    if (everything) {
        try { if (session && session.clear) await call(session, 'clear'); } catch (e) { /* session storage is optional */ }
        try { if (alarms && alarms.clearAll) await call(alarms, 'clearAll'); } catch (e) { /* alarms are optional */ }
        try { if (action && action.setBadgeText) await action.setBadgeText({ text: '' }); } catch (e) { /* badge reset is cosmetic */ }
    }
    if ((everything || chosen.includes('prefs')) && storageLs) { try { storageLs.clear(); } catch (e) { /* storage unavailable */ } }
    return { removed: remove.length, everything };
}
