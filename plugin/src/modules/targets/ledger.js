// ledger.js — what was sent where. One record per target: { [articleId]: { remote, etag?, hash, at } }.
// The hash is SHA-256 over the built payload text, so an unchanged article is not uploaded twice.
import { targetLedgerKey } from '../storageKeys.js';

export async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(String(text));
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function createLedger(storage, { now = () => Date.now() } = {}) {
    const read = async (targetId) => { const k = targetLedgerKey(targetId); const v = (await storage.get([k]))[k]; return v && typeof v === 'object' ? v : {}; };
    return {
        read,
        async get(targetId, articleId) { return (await read(targetId))[articleId] || null; },
        async put(targetId, articleId, entry) {
            const all = await read(targetId);
            const e = { remote: entry.remote, hash: entry.hash, at: now() };
            if (entry.etag) e.etag = entry.etag;
            all[articleId] = e;
            await storage.set({ [targetLedgerKey(targetId)]: all });
            return e;
        },
        async summary(targetId) {
            const all = await read(targetId); const times = Object.values(all).map((e) => e.at || 0);
            return { count: times.length, lastAt: times.length ? Math.max(...times) : 0 };
        }
    };
}
