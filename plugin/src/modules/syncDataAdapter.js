// modules/syncDataAdapter.js
// Reads and writes this device's data in the shape the sync engine needs. Storage is injected (the worker, the tests).
// Keys are the stamp keys: article:<id>, hl:<id>, coll:<id>, note:<id>.
//
//   readMany(keys)   → Map(key → { fields, unknown } | null)   null = no data here (never a deletion)
//   applyMany(items) → writes merged records [{ key, merged }] in as few storage writes as possible; merged.deleted removes the data
//
// A removal here is the plain data removal. It never creates a tombstone: the merged stamp (already adopted) is the tombstone.
import { SK, articleRecKey, collRecKey, noteRecKey } from './storageKeys.js';
import { withLock } from './articleLock.js';
import { syncFields, unknownFields } from './syncStamps.js';
import { applyFields } from './syncApply.js';

const get = (storage, keys) => Promise.resolve(storage.get(keys));
const set = (storage, obj) => Promise.resolve(storage.set(obj));
const rm = (storage, keys) => new Promise((res) => { const r = storage.remove(keys, res); if (r && r.then) r.then(res, res); });
const list = (v) => (Array.isArray(v) ? v : []);
export const typeOf = (key) => key.slice(0, key.indexOf(':'));
export const idOf = (key) => key.slice(key.indexOf(':') + 1);
const lean = (r) => ({ id: r.id, kind: r.kind, created: r.created, updated: r.updated, ...(r.highlightId ? { hl: r.highlightId } : {}) });

export function createDataAdapter({ storage, hooks = {} } = {}) {
    async function readMany(keys) {
        const out = new Map();
        const by = { article: [], hl: [], coll: [], note: [] };
        for (const k of keys) (by[typeOf(k)] || []).push(idOf(k));
        if (by.article.length) {
            const index = new Map(list((await get(storage, { [SK.articlesIndex]: [] }))[SK.articlesIndex]).map((e) => [e.id, e]));
            for (let i = 0; i < by.article.length; i += 50) {
                const part = by.article.slice(i, i + 50);
                const recs = await get(storage, part.map(articleRecKey));
                for (const id of part) {
                    const entry = index.get(id); if (!entry) { out.set('article:' + id, null); continue; }
                    const rec = recs[articleRecKey(id)] || null;
                    out.set('article:' + id, { fields: syncFields('article', entry, rec), unknown: unknownFields('article', entry, rec) });
                }
            }
        }
        if (by.hl.length) {
            const all = new Map(list((await get(storage, { [SK.annotations]: [] }))[SK.annotations]).map((h) => [h.id, h]));
            for (const id of by.hl) out.set('hl:' + id, all.has(id) ? { fields: syncFields('highlight', all.get(id)), unknown: [] } : null);
        }
        for (const [type, idsList, keyFn, ft] of [['coll', by.coll, collRecKey, 'collection'], ['note', by.note, noteRecKey, 'note']]) {
            for (let i = 0; i < idsList.length; i += 50) {
                const part = idsList.slice(i, i + 50), recs = await get(storage, part.map(keyFn));
                for (const id of part) { const r = recs[keyFn(id)]; out.set(type + ':' + id, r ? { fields: syncFields(ft, r), unknown: [] } : null); }
            }
        }
        return out;
    }

    async function applyMany(items) {
        const by = { article: [], hl: [], coll: [], note: [] };
        for (const it of items) (by[typeOf(it.key)] || []).push(it);
        if (by.article.length) await withLock('aish-articles', async () => {
            const index = list((await get(storage, { [SK.articlesIndex]: [] }))[SK.articlesIndex]).slice();
            const recs = await get(storage, by.article.map((it) => articleRecKey(idOf(it.key))));
            const writes = {}, drops = [];
            for (const { key, merged } of by.article) {
                const id = idOf(key), at = index.findIndex((e) => e.id === id), rk = articleRecKey(id);
                if (merged.deleted) { if (at >= 0) index.splice(at, 1); drops.push(rk); continue; }
                const res = applyFields('article', { entry: at >= 0 ? index[at] : null, rec: recs[rk] || null }, merged, { ...hooks, id });
                if (at >= 0) index[at] = res.entry; else index.push(res.entry);
                if (res.rec) writes[rk] = res.rec;
            }
            const keys = Object.keys(writes);
            for (let i = 0; i < keys.length; i += 25) await set(storage, Object.fromEntries(keys.slice(i, i + 25).map((k) => [k, writes[k]])));
            await set(storage, { [SK.articlesIndex]: index });
            if (drops.length) await rm(storage, drops);
        });
        if (by.hl.length) {
            // page scripts write this array without our lock: read it right before writing, and write once
            const all = list((await get(storage, { [SK.annotations]: [] }))[SK.annotations]).slice();
            for (const { key, merged } of by.hl) {
                const id = idOf(key), at = all.findIndex((h) => h.id === id);
                if (merged.deleted) { if (at >= 0) all.splice(at, 1); continue; }
                const res = applyFields('highlight', at >= 0 ? all[at] : null, merged, { id });
                if (at >= 0) all[at] = res; else all.push(res);
            }
            await set(storage, { [SK.annotations]: all });
        }
        if (by.coll.length) await withLock('aish-collections', async () => {
            let idx = list((await get(storage, { [SK.collIndex]: [] }))[SK.collIndex]).slice();
            const recs = await get(storage, by.coll.map((it) => collRecKey(idOf(it.key)))), writes = {}, drops = [];
            for (const { key, merged } of by.coll) {
                const id = idOf(key), rk = collRecKey(id); idx = idx.filter((e) => e.id !== id);
                if (merged.deleted) { drops.push(rk); continue; }
                const res = applyFields('collection', recs[rk] || { id, sources: [] }, merged, { id });
                if (!Array.isArray(res.sources)) res.sources = [];
                writes[rk] = res; idx.push({ id, name: res.name, question: res.question, n: res.sources.length, updated: res.updated });
            }
            await set(storage, { ...writes, [SK.collIndex]: idx });
            if (drops.length) await rm(storage, drops);
        });
        if (by.note.length) await withLock('aish-notes', async () => {
            let idx = list((await get(storage, { [SK.notesIndex]: [] }))[SK.notesIndex]).slice();
            const recs = await get(storage, by.note.map((it) => noteRecKey(idOf(it.key)))), writes = {}, drops = [];
            for (const { key, merged } of by.note) {
                const id = idOf(key), rk = noteRecKey(id); idx = idx.filter((e) => e.id !== id);
                if (merged.deleted) { drops.push(rk); continue; }
                const res = applyFields('note', recs[rk] || null, merged, { id });
                if (!Array.isArray(res.tags)) res.tags = [];
                writes[rk] = res; idx.push(lean(res));
            }
            await set(storage, { ...writes, [SK.notesIndex]: idx });
            if (drops.length) await rm(storage, drops);
        });
    }
    return { readMany, applyMany };
}
