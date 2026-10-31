// modules/syncStampStore.js
// Keeps the sync stamp sidecars (sync:stamps:<hh>) up to date. Storage is injected, so the same code runs in the background
// worker (storage events, wake-up scan), in extension pages (explicit deletes) and in the Node tests.
//
// Stamps are only written while sync is enabled (sync:config.enabled); with sync off this module does nothing.
// Rules (see syncStamps.js): stamping is hash-based and idempotent; a missing record is never a deletion, tombstones come
// only from markDeleted(); housekeeping (pruning, reset, restore) therefore never syncs.
//
// Ids in the sidecar are namespaced: article:<id>, hl:<id>, coll:<id>.
import { SK, ARTICLE_REC, SYNC_STAMPS, isArticleRecKey, isCollRecKey, articleRecKey, collRecKey, syncStampsKey } from './storageKeys.js';
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
    async function enabled() {
        const d = await get(storage, { [SK.syncConfig]: {} });
        return !!(d[SK.syncConfig] && d[SK.syncConfig].enabled);
    }

    /** ops: [{ key, apply(prev) → { entry, changed } }]. Loads the shards involved, applies, writes the changed ones. */
    async function commit(ops) {
        if (!ops.length) return 0;
        return lock(async () => {
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
        });
    }

    const stampOp = (key, fields, skip) => ({ key, apply: (prev, ctx) => stampRecord(prev, fields, { ...ctx, skip }) });
    const articleOp = (entry, rec) => stampOp('article:' + entry.id, syncFields('article', entry, rec), unknownFields('article', entry, rec));

    const byId = (list) => new Map((Array.isArray(list) ? list : []).filter((x) => x && x.id).map((x) => [x.id, x]));

    /** chrome.storage.onChanged handler. Never throws into the caller. */
    async function onChanged(changes) {
        try {
            if (!changes || !(await enabled())) return 0;
            const ops = [];
            for (const [key, ch] of Object.entries(changes)) {
                if (key === SK.articlesIndex) {
                    const before = byId(ch.oldValue);
                    for (const e of byId(ch.newValue).values()) if (!before.has(e.id) || !same(before.get(e.id), e)) ops.push(articleOp(e, null));
                } else if (isArticleRecKey(key) && ch.newValue) {
                    // the record alone: stamp only its own fields, leave the index-side fields (tags, favorite, ...) untouched
                    const id = key.slice(ARTICLE_REC.length);
                    const rec = ch.newValue;
                    const all = syncFields('article', {}, rec);
                    const mine = {}; for (const k of RECORD_SIDE) if (k in all) mine[k] = all[k];
                    ops.push({ key: 'article:' + id, apply: (prev, ctx) => {
                        const skip = Object.keys((prev && prev.f) || {}).filter((n) => !RECORD_SIDE.includes(n)).concat(unknownFields('article', {}, rec));
                        return stampRecord(prev, mine, { ...ctx, skip });
                    } });
                } else if (key === SK.annotations) {
                    const before = byId(ch.oldValue);
                    for (const h of byId(ch.newValue).values()) if (!before.has(h.id) || !same(before.get(h.id), h)) ops.push(stampOp('hl:' + h.id, syncFields('highlight', h), []));
                } else if (isCollRecKey(key) && ch.newValue && ch.newValue.id) {
                    ops.push(stampOp('coll:' + ch.newValue.id, syncFields('collection', ch.newValue), []));
                }
            }
            return await commit(ops);
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
            return n;
        } catch (_) { return 0; }
    }

    /** Every stamp, flattened (for the engine and the tests). */
    async function all() {
        const d = await get(storage, null);
        const out = {};
        for (const [k, v] of Object.entries(d || {})) if (k.startsWith(SYNC_STAMPS) && v && typeof v === 'object') Object.assign(out, v);
        return out;
    }

    return { onChanged, markDeleted, scan, all, enabled };
}
