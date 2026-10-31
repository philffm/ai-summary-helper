// modules/syncEngine.js
// Two-way sync of one encrypted place. Pure of chrome.*: storage, the remote store, the keys, the stamp store and the data adapter are injected.
//
// Remote layout:  meta.json (plain, see syncCrypto.js)  and  r/<hmac name>  one encrypted file per record:
//   { aish: 'rec/1', key: 'article:<id>', rev, f, values?, deleted? }      (the same record shape syncMerge.js works on)
// Local state per place, `sync:ledger:<placeId>`:  { joined, salt, items: { [key]: { n: name, e: etag, t: rev time pushed }, dirty: [keys] }
//
// A run: 1) pull every file whose etag differs from the ledger, merge it with the local record, adopt the merged stamp FIRST and
// then write the data (so the storage events of that write find matching hashes and stamp nothing: the echo guard), 2) push every
// record whose stamp is newer than what the ledger says the server has. A second run with nothing new makes no PUT and no write.
//
// Safety rules (each has a test):
//   • a file that cannot be read is skipped and reported, never overwritten; a failed or missing record is never a deletion;
//   • a pulled tombstone removes data only, through the adapter: it does not run the app's delete path (which would make new stamps);
//   • a field this device does not hold (pruned text) is taken from the server's copy on push, so it is never erased there;
//   • joining a place that already has data (empty ledger): fields that differ take the server's value; local-only records are pushed;
//   • the local backup hook runs before the first write and aborts the run if it fails.
import { syncLedgerKey } from './storageKeys.js';
import { mergeRecord } from './syncMerge.js';
import { decryptJson, encryptJson, nameOf } from './syncCrypto.js';
import { typeOf, idOf } from './syncDataAdapter.js';
import { canonicalOrder, IDENTITY_FIELDS } from './syncIdentity.js';

const TYPES = new Set(['article', 'hl', 'coll', 'note']);
const KEY_RX = /^(article|hl|coll|note):[A-Za-z0-9_.:-]{1,200}$/;
export const RECORD_DIR = 'r';
const get = (storage, keys) => Promise.resolve(storage.get(keys));
const set = (storage, obj) => Promise.resolve(storage.set(obj));
const clone = (x) => JSON.parse(JSON.stringify(x));
const status = (e) => (e && e.status) || 0;

/**
 * @param {{ place, storage, store, keys, meta, stampStore, adapter, backup?, now?, budgetMs?, chunk?, concurrency?, onProgress? }} o
 * @returns {Promise<{ pulled, applied, pushed, removed, errors: string[], more: boolean, joined: boolean }>}
 */
export async function syncEncryptedPlace(o) {
    const { place, storage, store, keys, meta, stampStore, adapter, backup, now = Date.now, budgetMs = 150000, chunk = 25, concurrency = 4, onProgress = () => {}, pullOnly = false, pushOnly = false, forceFirst = false } = o;
    const started = now();
    const out = { pulled: 0, applied: 0, pushed: 0, removed: 0, merged: 0, errors: [], more: false, joined: false };
    const became = new Set();   // articles that got live data in this run (new here, or brought back): the only ones that can have a twin from another device
    const lk = syncLedgerKey(place.id);
    const L = (await get(storage, { [lk]: {} }))[lk] || {};
    if (L.salt && meta && L.salt !== meta.salt) throw new Error('This place was set up again on the server (a different key). Nothing was changed. Remove the place here and add it again to join it.');
    const items = { ...(L.items || {}) }, dirty = new Set(L.dirty || []);
    const firstRun = !L.joined || forceFirst;   // forceFirst (restore): the server's values win where they differ
    const save = () => set(storage, { [lk]: { joined: 1, salt: (meta && meta.salt) || L.salt || '', items, dirty: [...dirty] } });
    const overBudget = () => now() - started > budgetMs;
    const names = new Map();
    const nameFor = async (key) => { let n = names.get(key); if (!n) { n = await nameOf(keys, typeOf(key), idOf(key)); names.set(key, n); } return n; };
    const path = (name) => RECORD_DIR + '/' + name;

    onProgress({ phase: 'checking', done: 0, total: 0 });
    if (firstRun && backup) await backup();   // a failure aborts the run before anything is written
    await stampStore.scan({});
    let stamps = await stampStore.all();
    const remote = new Map((await store.list(RECORD_DIR)).map((f) => [f.path.slice(RECORD_DIR.length + 1), f]));

    // which keys we already know by name
    const known = new Map();   // name → key
    for (const k of Object.keys(stamps)) known.set(await nameFor(k), k);
    for (const [k, it] of Object.entries(items)) known.set(it.n, k);

    async function readFile(name) {
        const f = await store.get(path(name));
        if (!f) return null;
        let rec;
        try { rec = await decryptJson(keys, f.bytes); } catch (e) { throw new Error(`${name.slice(0, 8)}…: ${e.message}`); }
        if (!rec || rec.aish !== 'rec/1' || !KEY_RX.test(String(rec.key)) || !TYPES.has(typeOf(rec.key)) || !rec.rev || typeof rec.f !== 'object') throw new Error(`${name.slice(0, 8)}…: not a record`);
        if ((await nameFor(rec.key)) !== name) throw new Error(`${name.slice(0, 8)}…: the file name does not belong to its record`);   // a swapped or forged file
        return { name, etag: f.etag, rec };
    }

    /** Merge the downloaded records with the local ones, adopt the stamps, then write the data. */
    async function ingest(files) {
        if (!files.length) return;
        const data = await adapter.readMany(files.map((x) => x.rec.key));
        const adopt = {}, apply = [];
        for (const { name, etag, rec } of files) {
            const key = rec.key, st = stamps[key], d = data.get(key);
            let local = null;
            if (st && st.deleted) local = { rev: st.rev, f: {}, values: {}, deleted: true };
            else if (st && d) {
                const f = clone(st.f), values = clone(d.fields);
                for (const n of Object.keys(f)) {
                    if (!(n in values) && d.unknown.includes(n)) delete f[n];   // not held here is not "removed here": the server's copy decides
                    else if (firstRun && rec.f[n] && rec.f[n].h !== f[n].h) f[n].t = 0;   // joining: the server's value wins where the two differ
                }
                local = { rev: st.rev, f, values };
            }
            const r = mergeRecord(local, rec);
            if (r.changedLocal) {
                const entry = r.merged.deleted ? { rev: r.merged.rev, f: {}, deleted: true } : { rev: r.merged.rev, f: r.merged.f };
                adopt[key] = entry;
                if (!(r.merged.deleted && !d)) apply.push({ key, merged: r.merged });
                if (key.startsWith('article:') && !r.merged.deleted && !d) became.add(idOf(key));
            }
            items[key] = { n: name, e: etag, t: rec.rev.t };
            if (r.changedRemote) dirty.add(key);
            known.set(name, key);
        }
        await stampStore.adopt(adopt);            // the stamps first...
        await adapter.applyMany(apply);           // ...then the data they describe
        if (stampStore.release) stampStore.release(Object.keys(adopt));   // written: events are read against the stored state again
        stamps = await stampStore.all();
        out.applied += apply.length;
    }

    // 1) pull
    const toPull = pushOnly ? [] : [...remote.entries()].filter(([name, f]) => { if (forceFirst) return true;   // a restore looks at every file: the ledger says what was seen, not what is still here
        const k = known.get(name); return !k || !items[k] || items[k].e !== f.etag; }).map(([name]) => name);
    for (let i = 0; i < toPull.length; i += chunk) {
        if (overBudget()) { out.more = true; break; }
        onProgress({ phase: 'pulling', done: i, total: toPull.length });
        const part = toPull.slice(i, i + chunk), got = [];
        for (let j = 0; j < part.length; j += concurrency) {
            await Promise.all(part.slice(j, j + concurrency).map(async (name) => {
                try { const r = await readFile(name); if (r) got.push(r); } catch (e) { out.errors.push(e.message); }
            }));
        }
        await ingest(got); out.pulled += got.length;
        await save();
    }
    if (out.more || pullOnly) { out.joined = !out.more; await save(); return out; }
    await dedupe();

    /**
     * The same URL saved on two devices arrives as two articles. After everything is applied, every group of live articles with one
     * URL identity that contains a newcomer collapses into the earliest saved one (the same pick on every device): fields it lacks are
     * filled from the others WITH their original stamps (so a later real edit still wins and both devices write identical stamps),
     * collections follow, and the others go away through a tombstone. Highlights and notes belong to the URL and stay.
     */
    async function dedupe() {
        if (!became.size || !adapter.articleGroups) return;
        const work = [];
        for (const list of (await adapter.articleGroups()).values()) if (list.length > 1 && list.some((x) => became.has(x.id))) work.push(list.slice().sort(canonicalOrder));
        if (!work.length) return;
        stamps = await stampStore.all();
        const data = await adapter.readMany(work.flat().map((x) => 'article:' + x.id));
        const adopt = {}, apply = [], drop = [], tomb = [], remap = [];
        for (const [win, ...losers] of work) {
            const wk = 'article:' + win.id, ws = stamps[wk], wd = data.get(wk);
            if (!ws || ws.deleted || !wd) continue;
            const f = { ...ws.f }, filled = {}, values = {};
            for (const l of losers) {
                const lk = 'article:' + l.id, ls = stamps[lk], ld = data.get(lk);
                if (ls && !ls.deleted && ld) {
                    for (const [name, st] of Object.entries(ls.f)) {
                        if (IDENTITY_FIELDS.has(name) || name in f) continue;   // the one that stays has it, or removed it on purpose
                        if (name in ld.fields && ld.fields[name] !== undefined) { f[name] = st; filled[name] = st; values[name] = ld.fields[name]; }
                    }
                }
                remap.push([l.id, win.id]); drop.push({ key: lk, merged: { deleted: true } }); tomb.push(l.id);
            }
            if (Object.keys(filled).length) {
                adopt[wk] = { rev: { t: Math.max(ws.rev.t, ...Object.values(filled).map((x) => x.t)), d: ws.rev.d }, f };
                apply.push({ key: wk, merged: { f: filled, values } });
            }
        }
        if (!tomb.length) return;
        await stampStore.adopt(adopt);           // stamps first, then data (the echo guard again)
        await adapter.applyMany(apply);
        await adapter.applyMany(drop);
        if (stampStore.release) stampStore.release(Object.keys(adopt));
        for (const [from, to] of remap) await adapter.remapArticleId(from, to);
        await stampStore.markDeleted('article', tomb);
        await stampStore.scan({ full: true });   // collections changed: stamp them now, they go out in this run
        stamps = await stampStore.all();
        out.merged = tomb.length;
    }

    // 2) push
    const pending = Object.entries(stamps).filter(([key, st]) => st && st.rev && (dirty.has(key) || !items[key] || items[key].t < st.rev.t)).map(([key]) => key);
    for (let i = 0; i < pending.length; i += chunk) {
        if (overBudget()) { out.more = true; break; }
        onProgress({ phase: 'uploading', done: i, total: pending.length });
        const part = pending.slice(i, i + chunk);
        const data = await adapter.readMany(part.filter((k) => !stamps[k].deleted));
        for (let j = 0; j < part.length; j += concurrency) {
            await Promise.all(part.slice(j, j + concurrency).map(async (key) => {
                try { await pushOne(key, data.get(key)); } catch (e) { out.errors.push(`${key}: ${e.message}`); }
            }));
        }
        await save();
    }

    async function build(key, d, remoteRec) {
        const st = stamps[key];
        if (st.deleted) return { aish: 'rec/1', key, rev: st.rev, f: {}, deleted: true };
        if (!d) return null;   // a stamp with no data here (pruned, reset, restored): nothing to say
        const f = clone(st.f), values = {};
        for (const n of Object.keys(f)) {
            if (n in d.fields && d.fields[n] !== undefined) values[n] = d.fields[n];
            else if (d.unknown.includes(n)) {   // not held here: carry the server's version of this field, or none
                if (remoteRec && remoteRec.f && remoteRec.f[n]) { f[n] = remoteRec.f[n]; if (remoteRec.values && n in remoteRec.values) values[n] = remoteRec.values[n]; } else delete f[n];
            }
        }
        return { aish: 'rec/1', key, rev: st.rev, f, values };
    }

    async function pushOne(key, d, retry = true) {
        const st = stamps[key], name = await nameFor(key);
        let remoteRec = null;
        const needsRemote = !st.deleted && d && Object.keys(st.f).some((n) => !(n in d.fields) && d.unknown.includes(n));
        if (needsRemote && remote.has(name)) { try { const r = await readFile(name); remoteRec = r && r.rec; } catch (_) { throw new Error('the server copy cannot be read, not overwriting it'); } }
        const rec = await build(key, d, remoteRec);
        if (!rec) return;
        const cond = items[key] && items[key].e ? { ifMatch: items[key].e } : { ifNoneMatch: '*' };
        try {
            const r = await store.put(path(name), await encryptJson(keys, rec), { contentType: 'application/octet-stream', ...cond });
            items[key] = { n: name, e: r.etag || '', t: st.rev.t }; dirty.delete(key); out.pushed++;
        } catch (e) {
            if (status(e) !== 412 || !retry) throw e;
            // the server's copy changed (or is gone) since we looked: merge with it, then try once more
            let got = null; try { got = await readFile(name); } catch (err) { throw new Error('the server copy cannot be read, not overwriting it'); }
            if (got) { await ingest([got]); out.pulled++; } else { delete items[key]; }
            const again = (await adapter.readMany(stamps[key] && !stamps[key].deleted ? [key] : [])).get(key);
            return pushOne(key, again, false);
        }
    }

    out.joined = true;
    await save();
    return out;
}

/** meta.json of an encrypted place: reads it, or creates it (first device). A race between two devices ends with one meta file: the loser reads it. */
export async function loadOrCreateMeta(store, { createMeta, passphrase, iterations }) {
    const existing = await store.get('meta.json');
    if (existing) return { meta: JSON.parse(new TextDecoder().decode(existing.bytes)), created: false };
    const made = await createMeta(passphrase, iterations ? { iterations } : {});
    try { await store.put('meta.json', JSON.stringify(made.meta, null, 2) + '\n', { contentType: 'application/json', ifNoneMatch: '*' }); }
    catch (e) {
        if (status(e) !== 412) throw e;
        const won = await store.get('meta.json');
        return { meta: JSON.parse(new TextDecoder().decode(won.bytes)), created: false };
    }
    return { meta: made.meta, master: made.master, keys: made.keys, created: true };
}
