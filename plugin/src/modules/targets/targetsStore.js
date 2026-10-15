// targetsStore.js — reads and writes the targets:* keys. Nothing here touches chrome.* directly: `storage` is injected
// ({ get(keys) → Promise<object>, set(obj) → Promise, remove(keys) → Promise }), the default is chrome.storage.local.
import { SK, targetLedgerKey } from '../storageKeys.js';

export function createTargetsStore(storage) {
    const st = () => storage || chrome.storage.local;
    const one = async (key, fallback) => { const v = (await st().get([key]))[key]; return v === undefined || v === null ? fallback : v; };
    const arr = async (key) => { const v = await one(key, []); return Array.isArray(v) ? v : []; };
    return {
        storage: { get: (k) => st().get(k), set: (o) => st().set(o), remove: (k) => st().remove(k) },
        getConnections: () => arr(SK.targetConnections),
        setConnections: (v) => st().set({ [SK.targetConnections]: v }),
        getSecrets: async () => { const v = await one(SK.targetSecrets, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; },
        getList: () => arr(SK.targetList),
        setList: (v) => st().set({ [SK.targetList]: v }),
        getDefault: () => one(SK.targetDefault, ''),
        getOutbox: () => arr(SK.targetOutbox),
        setOutbox: (v) => st().set({ [SK.targetOutbox]: v }),
        ledgerKey: targetLedgerKey
    };
}
