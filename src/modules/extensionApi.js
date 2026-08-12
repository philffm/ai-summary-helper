/**
 * Cross-browser API wrapper.
 *
 * Chrome MV3 uses the `chrome.*` namespace (callback-based, but Promises
 * work when omitting the callback). Firefox and Safari use the standard
 * `browser.*` namespace (Promise-based by default).
 *
 * This module normalises access so the rest of the codebase can always
 * use `ext.storage.local.get(...)` etc. without worrying about the
 * underlying platform.
 *
 * Usage:
 *   import { ext } from './extensionApi.js';
 *   const data = await ext.storage.local.get('key');
 */

export const ext = typeof browser !== 'undefined' ? browser : chrome;

/**
 * Normalise the storage API surface so callers always get Promise-based
 * methods regardless of whether the platform is Chrome (callback-style)
 * or Firefox/Safari (Promise-style).
 *
 * Chrome MV3 supports Promises natively when the callback is omitted, so
 * in practice `chrome.storage.local.get(key)` already returns a Promise.
 * This helper is kept for forward-compatibility with older Chrome versions
 * or edge cases where the callback form is required.
 *
 * @param {'sync' | 'local'} area
 * @param {string | string[] | object | null} keys
 * @returns {Promise<object>}
 */
export function storageGet(area, keys) {
    return new Promise((resolve) => {
        ext.storage[area].get(keys, resolve);
    });
}

/**
 * Promise-based storage set.
 * @param {'sync' | 'local'} area
 * @param {object} data
 * @returns {Promise<void>}
 */
export function storageSet(area, data) {
    return new Promise((resolve) => {
        ext.storage[area].set(data, resolve);
    });
}

/**
 * Promise-based storage remove.
 * @param {'sync' | 'local'} area
 * @param {string | string[]} keys
 * @returns {Promise<void>}
 */
export function storageRemove(area, keys) {
    return new Promise((resolve) => {
        ext.storage[area].remove(keys, resolve);
    });
}

/**
 * Promise-based storage clear.
 * @param {'sync' | 'local'} area
 * @returns {Promise<void>}
 */
export function storageClear(area) {
    return new Promise((resolve) => {
        ext.storage[area].clear(resolve);
    });
}

/**
 * Detect the current platform.
 * @returns {'chrome' | 'firefox' | 'safari' | 'unknown'}
 */
export function detectPlatform() {
    if (typeof browser !== 'undefined') {
        // Firefox exposes `browser` globally; Safari does too inside
        // Safari WebExtension contexts.
        if (navigator.userAgent?.includes('Firefox')) return 'firefox';
        if (navigator.userAgent?.includes('Safari')) return 'safari';
        return 'firefox'; // safe fallback — non-Chrome browser
    }
    return 'chrome';
}

/**
 * Check whether the native `chrome.sidePanel` API is available.
 * Safari and Firefox do not support it.
 */
export function supportsNativeSidePanel() {
    return !!(ext.sidePanel && ext.sidePanel.setPanelBehavior);
}