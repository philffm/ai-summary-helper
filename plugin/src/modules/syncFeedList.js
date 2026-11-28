// modules/syncFeedList.js
// The feed list of a library: one encrypted document beside the records, `feeds.bin`. It is not a record under r/, so
// versions that do not know it never look at it. Entries and merge rules are those of the feed vault (feedSync.js):
// { url, title, tags, updatedAt, removed? }, the newer one wins, a removal stays as a marker. Never items or read state.
// Pure of chrome.*: the store, the keys, the storage and the feed adapter (feedSyncStore.js) are injected.
//
// Safety rules (each has a test):
//   • a document this version cannot read is left as it is: nothing is written over it, nothing here changes;
//   • at first contact the library wins: a device does not bring its own name or categories to a feed that is there;
//   • many removals at once are not carried out: more than the larger of 10 and a quarter of the feeds here;
//   • a feed list that vanished here as a whole (more than that) is taken for lost, not for removed: it comes back;
//   • a restore only adds.
import { cleanEntries, localEntries, mergeEntries, planChanges, sameEntries } from './feedSync.js';
import { decryptJson, encryptJson } from './syncCrypto.js';
import { feedListKey } from './storageKeys.js';

export const FEED_LIST_FILE = 'feeds.bin';
export const FEED_LIST_KIND = 'feeds/1';
const most = (feeds) => Math.max(10, Math.ceil(feeds * 0.25));
const liveUrls = (entries) => new Set(entries.filter((e) => !e.removed).map((e) => e.url));

/** The document of the place: { entries, etag }; an empty one where there is none yet. Throws where it cannot be read. */
export async function readFeedList(store, keys) {
    const file = await store.get(FEED_LIST_FILE);
    if (!file) return { entries: [], etag: '' };
    const doc = await decryptJson(keys, file.bytes);
    if (!doc || doc.aish !== FEED_LIST_KIND || !Array.isArray(doc.entries)) throw new Error('The feed list on the server was written by a newer version. It was not changed.');
    return { entries: cleanEntries(doc.entries), etag: file.etag };
}

const write = async (store, keys, entries, etag) => store.put(FEED_LIST_FILE, await encryptJson(keys, { aish: FEED_LIST_KIND, entries }),
    { contentType: 'application/octet-stream', ...(etag ? { ifMatch: etag } : { ifNoneMatch: '*' }) });

/**
 * A phone's run: its own entries (a removed feed as a marker) joined with the document, which is written only where
 * `mayWrite`. The phone changes which feeds there are, never the name or the categories of one the library holds.
 * → the entries the phone applies
 */
export async function joinFeedList({ store, keys, local, mayWrite, now = Date.now }) {
    for (let attempt = 0; ; attempt++) {
        const remote = await readFeedList(store, keys);
        if (!mayWrite) return remote.entries;
        const theirs = liveUrls(remote.entries);
        const merged = mergeEntries(cleanEntries(local).filter((e) => e.removed || !theirs.has(e.url)), remote.entries, now());
        if (!merged.length || sameEntries(merged, remote.entries)) return merged;
        try { await write(store, keys, merged, remote.etag); return merged; }
        catch (e) { if (!(e && e.status === 412 && attempt < 3)) throw e; }
    }
}

/**
 * One run for a place. mode: 'both' (a device that keeps in step), 'push' (a backup place: written, never applied here),
 * 'restore' (what is missing here is added). → { added, updated, removed, held, uploaded }
 */
export async function syncFeedList({ store, keys, adapter, storage, placeId, mode = 'both', now = Date.now }) {
    const out = { added: 0, updated: 0, removed: 0, held: 0, uploaded: false };
    const subs = await adapter.getSubs();
    if (mode === 'restore') {
        const have = new Set(subs.map((s) => s.url));
        const add = (await readFeedList(store, keys)).entries.filter((e) => !e.removed && !have.has(e.url));
        if (add.length) await adapter.applyPlan({ add, update: [], remove: [] });
        out.added = add.length;
        return out;
    }
    const key = feedListKey(placeId);
    let base = cleanEntries((await storage.get(key))[key] || []);
    const known = base.filter((e) => !e.removed).length;
    if (!subs.length && known > most(known)) base = [];
    const local = localEntries(subs, base, now());
    for (let attempt = 0; ; attempt++) {
        const remote = await readFeedList(store, keys);
        // what this device never had from the place does not overrule it
        const theirs = liveUrls(remote.entries), seen = new Set(base.map((e) => e.url));
        const merged = mergeEntries(local.filter((e) => e.removed || seen.has(e.url) || !theirs.has(e.url)), remote.entries, now());
        const plan = mode === 'push' ? { add: [], update: [], remove: [] } : planChanges(subs, merged);
        const held = new Set(plan.remove.length > most(subs.length) ? plan.remove : []);
        if (held.size) plan.remove = [];
        if (merged.length && !sameEntries(merged, remote.entries)) {
            try {
                await write(store, keys, merged, remote.etag);
                out.uploaded = true;
            } catch (e) {
                if (e && e.status === 412 && attempt < 3) continue;   // another device wrote meanwhile: read, merge, once more
                throw e;
            }
        }
        if (plan.add.length || plan.update.length || plan.remove.length) await adapter.applyPlan(plan);
        // a held removal keeps its old base, so that the next run sees the same and holds it again
        const was = new Map(base.map((e) => [e.url, e]));
        const next = merged.map((e) => (held.has(e.url) ? was.get(e.url) : e)).filter(Boolean);
        await storage.set({ [key]: next });
        return { ...out, added: plan.add.length, updated: plan.update.length, removed: plan.remove.length, held: held.size };
    }
}
