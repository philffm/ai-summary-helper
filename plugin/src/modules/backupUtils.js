import { SK, SK_LEGACY, renameKeys } from './storageKeys.js';
import { SECRET_KEYS, TRANSIENT_KEYS, TRANSIENT_PREFIXES } from './dataReset.js';
import { cleanConnection, cleanPlace } from './syncService.js';

const isTransient = (k) => TRANSIENT_KEYS.includes(k) || TRANSIENT_PREFIXES.some((p) => typeof k === 'string' && k.startsWith(p));

const secretNames = new Set([
    ...SECRET_KEYS,
    ...Object.entries(SK_LEGACY).filter(([, current]) => SECRET_KEYS.includes(current)).map(([old]) => old)
]);

function withoutApiKeys(services) {
    return Object.fromEntries(Object.entries(services || {}).map(([id, config]) => {
        if (!config || typeof config !== 'object' || Array.isArray(config)) return [id, config];
        const safeConfig = { ...config };
        delete safeConfig.apiKey;
        return [id, safeConfig];
    }));
}

export function filterBackupSecrets(data, includeSecrets) {
    const result = {};
    for (const [key, value] of Object.entries(data || {})) {
        if (isTransient(key)) continue;   // the send queue, the device id and the sync stamps are never exported
        if (key === SK.servicesConfig || key === 'servicesConfig') {
            result[key] = includeSecrets ? value : withoutApiKeys(value);
        } else if (includeSecrets || !secretNames.has(key)) {
            result[key] = value;
        }
    }
    return result;
}

const hasValue = (value) => value !== undefined && value !== null && value !== '';

export function hasBackupSecrets(data) {
    if (!data || typeof data !== 'object') return false;
    if (data._contains_secrets === true) return true;
    if (Object.entries(data).some(([key, value]) => key !== SK.servicesConfig && key !== 'servicesConfig' && secretNames.has(key) && hasValue(value))) return true;
    if ([data[SK.servicesConfig], data.servicesConfig].some((services) =>
        Object.values(services || {}).some((config) => config && typeof config === 'object' && hasValue(config.apiKey))
    )) return true;
    return hasBackupSecrets(data.settings) || hasBackupSecrets(data.local);
}

/** What a settings-only backup takes from local storage as well: the sync servers and places (their logins only with secrets). */
export const SETTINGS_LOCAL_KEYS = [SK.syncConnections, SK.syncPlaces, SK.syncSecrets];

const rows = (value) => (Array.isArray(value) ? value.filter((x) => x && typeof x === 'object' && typeof x.id === 'string' && x.id) : []);
const cleaned = (list, clean) => list.flatMap((x) => { try { return [clean(x, { id: x.id })]; } catch (_) { return []; } });

/**
 * Sync servers and places from a backup are added next to the ones this device has, never replacing one, and arrive
 * paused: a restored place must not start writing before the person has looked at it and pressed Resume. The device id,
 * the sync stamps and ledgers are not in a backup, so the first run joins the place like a new device does.
 * A stored login or key of this device wins over the one in the file.
 */
function mergeSync(imported, current) {
    if (SK.syncConnections in imported || SK.syncPlaces in imported) {
        const servers = rows(current?.[SK.syncConnections]);
        const places = rows(current?.[SK.syncPlaces]);
        const known = (list) => new Set(list.map((x) => x.id));
        const knownServers = known(servers), knownPlaces = known(places);
        const allServers = [...servers, ...cleaned(rows(imported[SK.syncConnections]).filter((c) => !knownServers.has(c.id)), cleanConnection)];
        const usable = known(allServers);
        const added = cleaned(rows(imported[SK.syncPlaces]).filter((p) => !knownPlaces.has(p.id) && usable.has(p.connectionId)), cleanPlace);
        imported[SK.syncConnections] = allServers;
        imported[SK.syncPlaces] = [...places, ...added.map((p) => ({ ...p, enabled: false }))];
    }
    if (SK.syncSecrets in imported) {
        const secrets = imported[SK.syncSecrets];
        imported[SK.syncSecrets] = { ...(secrets && typeof secrets === 'object' ? secrets : {}), ...(current?.[SK.syncSecrets] || {}) };
    }
    return imported;
}

/**
 * The pieces a restored library is written in, about 2 MB or 50 keys each: a phone cannot take 100 MB in one call.
 * The lists of articles come last, so that they never name a record that is not there yet.
 */
export function restoreChunks(data, maxChars = 2_000_000, maxKeys = 50) {
    const lists = [SK.articlesIndex, SK.collIndex, SK.hlIndex];
    const keys = Object.keys(data || {});
    const ordered = [...keys.filter((k) => !lists.includes(k)), ...keys.filter((k) => lists.includes(k))];
    const chunks = [];
    let chunk = {}, size = 0, count = 0;
    for (const k of ordered) {
        const own = (JSON.stringify(data[k]) || '').length + k.length;
        if (count && (size + own > maxChars || count >= maxKeys)) { chunks.push(chunk); chunk = {}; size = 0; count = 0; }
        chunk[k] = data[k]; size += own; count++;
    }
    if (count) chunks.push(chunk);
    return chunks;
}

/**
 * Writes the local part of a backup piece by piece into local storage and fails loudly: a full or refused store is
 * reported only through runtime.lastError.
 */
export async function writeRestored(data, { area = chrome.storage.local, onProgress } = {}) {
    const chunks = restoreChunks(data);
    for (let i = 0; i < chunks.length; i++) {
        await new Promise((resolve, reject) => {
            const done = () => { const failed = chrome.runtime?.lastError; if (failed) reject(new Error(failed.message || String(failed))); else resolve(); };
            const pending = area.set(chunks[i], done);
            if (pending && typeof pending.catch === 'function') pending.catch(reject);
        });
        onProgress?.(i + 1, chunks.length);
    }
}

export function prepareImportedData(data, currentData) {
    const imported = renameKeys(data);
    for (const k of Object.keys(imported)) if (isTransient(k)) delete imported[k];   // a restored queue would send everything again, maybe from another device
    mergeSync(imported, currentData);
    const importedServices = imported[SK.servicesConfig];
    if (!importedServices || typeof importedServices !== 'object') return imported;

    const currentServices = currentData?.[SK.servicesConfig] || {};
    const mergedServices = { ...currentServices };
    for (const [id, config] of Object.entries(importedServices)) {
        mergedServices[id] = { ...(currentServices[id] || {}), ...(config || {}) };
    }
    imported[SK.servicesConfig] = mergedServices;
    return imported;
}
