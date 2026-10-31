// modules/syncStampStore.js
// Keeps the sync stamp sidecars (sync:stamps:<hh>) up to date. Storage is injected, so the same code runs in the background
// worker (storage events, wake-up scan), in extension pages (explicit deletes) and in the Node tests.
//
// Stamps are only written while a place is set up (sync:places has one that is not switched off); otherwise this module does nothing.
// Rules (see syncStamps.js): stamping is hash-based and idempotent; a missing record is never a deletion, tombstones come
// only from markDeleted(); housekeeping (pruning, reset, restore) therefore never syncs.
//
// Ids in the sidecar are namespaced: article:<id>, hl:<id>, coll:<id>.
import { SK, ARTICLE_REC, SYNC_STAMPS, isArticleRecKey, isCollRecKey, isNoteRecKey, articleRecKey, collRecKey, noteRecKey, syncStampsKey } from './storageKeys.js';
import { hashValue, stampRecord, tombstone, syncFields, unknownFields, RECORD_SIDE } from './syncStamps.js';

export const shardOf = (key) => hashValue(key).slice(-2).padStart(2, '0');

let tail = Promise.resolve();
/** One lock for every stamp read-modify-write: Web Locks across all extension contexts, a promise chain without them. */
export function withStampLock(fn) {
    if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') return navigator.locks.request('aish-sync-stamps', () => fn());
    const run = tail.then(() => fn(), () => fn());
    tail = run.catch(() => {});
    return run;
}

const newDeviceId = () => 'd_' + ((globalThis.crypto && globalThis.crypto.randomUUID) ? globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2, 10) + Date.now().toString(36));
const get = (storage, keys) => new Promise((res) => { const r = storage.get(keys, res); if (r && r.then) r.then(res, () => res({})); });
const set = (storage, obj) => new Promise((res) => { const r = storage.set(obj, res); if (r && r.then) r.then(res, res); });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function createStampStore({ storage, now = Date.now, lock = withStampLock, chunk = 25 } = {}) {
    /** Stamps are kept only while at least one place is set up (and not switched off). */
    async function enabled() {
        const d = await get(storage, { [SK.syncPlaces]: [] });
        return Array.isArray(d[SK.syncPlaces]) && d[SK.syncPlaces].some((p) => p && p.enabled !== false);
    }

    /** ops: [{ key, apply(prev) → { entry, changed } }]. Loads the shards involved, applies, writes the changed ones. */
    const commit = (ops) => (ops.length ? lock(() => commitInner(ops)) : Promise.resolve(0));
    async function commitInner(ops) {
        {
            const meta = await get(storage, { [SK.syncDeviceId]: '', [SK.syncClock]: { t: 0 } });
            let device = meta[SK.syncDeviceId];
            const clock = { t: (meta[SK.syncClock] && meta[SK.syncClock].t) || 0 };
            const shardKeys = [...new Set(ops.map((o) => syncStampsKey(shardOf(o.key))))];
            const shards = await get(storage, shardKeys);
            const dirty = new Set();
            let n = 0;
            if (!device) device = newDeviceId();
            for (const o of ops) {
                const sk = syncStampsKey(shardOf(o.key));
                const shard = shards[sk] && typeof shards[sk] === 'object' ? shards[sk] : (shards[sk] = {});
                const r = o.apply(shard[o.key], { clock, now: now(), device });
                if (r.changed) { shard[o.key] = r.entry; dirty.add(sk); n++; }
            }
            const out = {};
            for (const sk of dirty) out[sk] = shards[sk];
            if (n) { out[SK.syncClock] = { t: clock.t }; }
            if (meta[SK.syncDeviceId] !== device) out[SK.syncDeviceId] = device;
            if (Object.keys(out).length) await set(storage, out);
            return n;
        }
    }

    // Stamps taken over from another device (adopt) are held until the data they describe is written (release). In that gap the stored data
    // does not match the stamps yet, and stamping it would turn "not written yet" into a local removal. While a key is held, fields whose
    // value does not match the adopted stamp are left alone. Events are always read against the CURRENT stored state, never their payload,
    // so a late event for an earlier write cannot bring an old value back.
    const HOLD_MS = 30000, held = new Map();   // a safety expiry only: the engine releases right after it has written the data
    const hold = (entries) => { const until = Date.now() + HOLD_MS; for (const [k, e] of Object.entries(entries)) held.set(k, { f: (e && e.f) || {}, until }); };
    /** The data for adopted stamps is written: from now on the storage events are read against the stored state like any other. */
    const release = (keys) => { for (const k of keys || [...held.keys()]) held.delete(k); };
    const heldNames = (key, fields) => {
        const p = held.get(key);
        if (!p || p.until < Date.now()) return [];
        return Object.keys(p.f).filter((n) => hashValue((fields || {})[n]) !== p.f[n].h);
    };
    const stampOp = (key, fields, skip) => ({ key, apply: (prev, ctx) => stampRecord(prev, fields, { ...ctx, skip: [...(skip || []), ...heldNames(key, fields)] }) });
    const articleOp = (entry, rec) => stampOp('article:' + entry.id, syncFields('article', entry, rec), unknownFields('article', entry, rec));

    const byId = (list) => new Map((Array.isArray(list) ? list : []).filter((x) => x && x.id).map((x) => [x.id, x]));

    /**
     * chrome.storage.onChanged handler. Never throws into the caller. It only uses the event to learn WHICH keys changed: what gets stamped is
     * read from storage now, inside the stamp lock, so an event that arrives late (after a sync wrote newer data) cannot stamp an old value.
     */
    async function onChanged(changes) {
        try {
            if (!changes || !(await enabled())) return 0;
            return await lock(async () => {
                const ops = [];
                const cur = async (key, empty) => (await get(storage, { [key]: empty }))[key];
                for (const [key, ch] of Object.entries(changes)) {
                    if (key === SK.articlesIndex) {
                        const before = byId(ch.oldValue);
                        for (const e of byId(await cur(key, [])).values()) if (!before.has(e.id) || !same(before.get(e.id), e)) ops.push(articleOp(e, null));
                    } else if (isArticleRecKey(key) && ch.newValue) {
                        // the record alone: stamp only its own fields, leave the index-side fields (tags, favorite, ...) untouched
                        const id = key.slice(ARTICLE_REC.length);
                        const rec = await cur(key, null);
                        if (!rec) continue;
                        const all = syncFields('article', {}, rec);
                        const mine = {}; for (const k of RECORD_SIDE) if (k in all) mine[k] = all[k];
                        ops.push({ key: 'article:' + id, apply: (prev, ctx) => {
                            const skip = Object.keys((prev && prev.f) || {}).filter((n) => !RECORD_SIDE.includes(n)).concat(unknownFields('article', {}, rec));
                            return stampRecord(prev, mine, { ...ctx, skip: [...skip, ...heldNames('article:' + id, mine)] });
                        } });
                    } else if (key === SK.annotations) {
                        const before = byId(ch.oldValue);
                        for (const h of byId(await cur(key, [])).values()) if (!before.has(h.id) || !same(before.get(h.id), h)) ops.push(stampOp('hl:' + h.id, syncFields('highlight', h), []));
                    } else if (isNoteRecKey(key) && ch.newValue && ch.newValue.id) {
                        const r = await cur(key, null); if (r && r.id) ops.push(stampOp('note:' + r.id, syncFields('note', r), []));
                    } else if (isCollRecKey(key) && ch.newValue && ch.newValue.id) {
                        const r = await cur(key, null); if (r && r.id) ops.push(stampOp('coll:' + r.id, syncFields('collection', r), []));
                    }
                }
                return ops.length ? await commitInner(ops) : 0;
            });
        } catch (_) { return 0; }
    }

    /** Explicit deletion markers. type: 'article' | 'hl' | 'coll'. The only way a tombstone is made. */
    async function markDeleted(type, ids) {
        try {
            if (!(await enabled())) return 0;
            const list = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean))];
            return await commit(list.map((id) => ({ key: type + ':' + id, apply: (prev, ctx) => tombstone(prev, ctx) })));
        } catch (_) { return 0; }
    }

    /**
     * Catch up on anything the events missed (worker killed, extension reloaded). Default: the index, highlights and
     * collections, plus the records that have no stamp yet. `full` also re-reads every record (run before a sync, not on
     * every worker start). Never creates a tombstone.
     */
    async function scan({ full = false } = {}) {
        try {
            if (!(await enabled())) return 0;
            const d = await get(storage, { [SK.articlesIndex]: [], [SK.annotations]: [], [SK.collIndex]: [] });
            const index = Array.isArray(d[SK.articlesIndex]) ? d[SK.articlesIndex].filter((e) => e && e.id) : [];
            let n = 0;
            const shardsNow = {};
            const stamped = async (key) => {
                const sk = syncStampsKey(shardOf(key));
                if (!(sk in shardsNow)) shardsNow[sk] = (await get(storage, sk))[sk] || {};
                return !!shardsNow[sk][key];
            };
            for (let i = 0; i < index.length; i += chunk) {
                const part = index.slice(i, i + chunk);
                const need = [];
                for (const e of part) if (full || !(await stamped('article:' + e.id))) need.push(e);
                const recs = need.length ? await get(storage, need.map((e) => articleRecKey(e.id))) : {};
                const ops = part.map((e) => articleOp(e, need.includes(e) ? (recs[articleRecKey(e.id)] || null) : null));
                n += await commit(ops);
                for (const k of Object.keys(shardsNow)) delete shardsNow[k];   // re-read after the commit
            }
            const hls = (Array.isArray(d[SK.annotations]) ? d[SK.annotations] : []).filter((h) => h && h.id);
            n += await commit(hls.map((h) => stampOp('hl:' + h.id, syncFields('highlight', h), [])));
            const colls = (Array.isArray(d[SK.collIndex]) ? d[SK.collIndex] : []).filter((c) => c && c.id);
            for (let i = 0; i < colls.length; i += chunk) {
                const recs = await get(storage, colls.slice(i, i + chunk).map((c) => collRecKey(c.id)));
                n += await commit(Object.values(recs).filter((r) => r && r.id).map((r) => stampOp('coll:' + r.id, syncFields('collection', r), [])));
            }
            const notes = (Array.isArray((await get(storage, { [SK.notesIndex]: [] }))[SK.notesIndex]) ? (await get(storage, { [SK.notesIndex]: [] }))[SK.notesIndex] : []).filter((x) => x && x.id);
            for (let i = 0; i < notes.length; i += chunk) {
                const recs = await get(storage, notes.slice(i, i + chunk).map((x) => noteRecKey(x.id)));
                n += await commit(Object.values(recs).filter((r) => r && r.id).map((r) => stampOp('note:' + r.id, syncFields('note', r), [])));
            }
            return n;
        } catch (_) { return 0; }
    }

    /**
     * Take over stamps that came from another device (the merged result of a pull). Written BEFORE the data they describe, so the
     * storage events of that data find matching hashes and stamp nothing (the echo guard). Raises the clock above everything seen.
     * entries: { 'article:<id>': { rev, f, deleted? } }
     */
    async function adopt(entries) {
        const keys = Object.keys(entries || {});
        if (!keys.length) return 0;
        return lock(async () => {
            const meta = await get(storage, { [SK.syncClock]: { t: 0 } });
            let top = (meta[SK.syncClock] && meta[SK.syncClock].t) || 0;
            const shards = await get(storage, [...new Set(keys.map((k) => syncStampsKey(shardOf(k))))]);
            const dirty = new Set();
            for (const k of keys) {
                const sk = syncStampsKey(shardOf(k));
                const shard = shards[sk] && typeof shards[sk] === 'object' ? shards[sk] : (shards[sk] = {});
                shard[k] = entries[k]; dirty.add(sk);
                top = Math.max(top, (entries[k].rev && entries[k].rev.t) || 0);
            }
            const out = { [SK.syncClock]: { t: top } };
            for (const sk of dirty) out[sk] = shards[sk];
            await set(storage, out);
            hold(entries);
            return keys.length;
        });
    }

    /** Every stamp, flattened (for the engine and the tests). */
    async function all() {
        const d = await get(storage, null);
        const out = {};
        for (const [k, v] of Object.entries(d || {})) if (k.startsWith(SYNC_STAMPS) && v && typeof v === 'object') Object.assign(out, v);
        return out;
    }

    return { onChanged, markDeleted, scan, all, adopt, release, enabled };
}
