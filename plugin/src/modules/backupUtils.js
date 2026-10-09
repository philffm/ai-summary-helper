import { SK, SK_LEGACY, renameKeys } from './storageKeys.js';
import { SECRET_KEYS } from './dataReset.js';

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

export function prepareImportedData(data, currentData) {
    const imported = renameKeys(data);
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
