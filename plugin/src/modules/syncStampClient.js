// modules/syncStampClient.js
// For code that runs in extension pages (popup, side panel): writes sync deletion markers through the same stamp store the
// background worker uses (shared Web Lock). Does nothing while sync is off. Never throws.
import { createStampStore } from './syncStampStore.js';

let store = null;
const stamps = () => store || (store = createStampStore({ storage: chrome.storage.local }));

/** type: 'article' | 'hl' | 'coll'. The user deleted these records: the explicit, and only, source of tombstones. */
export function markDeleted(type, ids) {
    try { return stamps().markDeleted(type, ids).catch(() => 0); } catch (_) { return Promise.resolve(0); }
}
