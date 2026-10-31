// modules/notesStore.js
// Your own notes, and the comments on highlights. Runs in extension pages and the worker only (they share one Web Lock);
// content scripts send a message instead of writing here.
//
//   notes:rec:<id>   { id, kind: 'note' | 'comment', text, tags[], url?, title?, quote?, highlightId?, created, updated }
//   notes:index      [{ id, kind, created, updated, hl? }]   lean list, so nothing reads every record to list them
//
// A comment belongs to a highlight by its id and is its own record (id `c_<highlightId>`): the highlight array is rewritten
// by page scripts from a fixed field list, so a field added there would be erased by the next highlight anywhere.
import { SK, noteRecKey } from './storageKeys.js';
import { withLock } from './articleLock.js';
import { markDeleted } from './syncStampClient.js';

export const MAX_TEXT = 20000, MAX_TAGS = 12;
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const cleanTags = (tags) => {
    const seen = new Set(), out = [];
    for (const t of Array.isArray(tags) ? tags : []) {
        const v = clip(String(t).replace(/^#/, ''), 40);
        if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); }
        if (out.length >= MAX_TAGS) break;
    }
    return out;
};
const newId = () => 'n_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const lean = (r) => ({ id: r.id, kind: r.kind, created: r.created, updated: r.updated, ...(r.highlightId ? { hl: r.highlightId } : {}) });

export function createNotesStore({ storage = chrome.storage.local, now = () => new Date().toISOString(), mark = markDeleted } = {}) {
    const get = (keys) => Promise.resolve(storage.get(keys));
    const set = (obj) => Promise.resolve(storage.set(obj));
    const run = (fn) => withLock('aish-notes', fn);
    const indexNow = async () => { const i = (await get({ [SK.notesIndex]: [] }))[SK.notesIndex]; return Array.isArray(i) ? i : []; };
    const recOf = async (id) => (await get([noteRecKey(id)]))[noteRecKey(id)] || null;
    async function save(rec) {
        const idx = (await indexNow()).filter((e) => e.id !== rec.id);
        idx.push(lean(rec));
        await set({ [noteRecKey(rec.id)]: rec, [SK.notesIndex]: idx });
        return rec;
    }

    return {
        /** A free note. `url`/`quote` link it to an article and a passage. → the record, or null for empty text. */
        add: ({ text, tags, url, title, quote } = {}) => run(async () => {
            const t = clip(text, MAX_TEXT); if (!t) return null;
            const at = now();
            return save({ id: newId(), kind: 'note', text: t, tags: cleanTags(tags), ...(url ? { url: clip(url, 2048) } : {}), ...(title ? { title: clip(title, 300) } : {}), ...(quote ? { quote: clip(quote, 2000) } : {}), created: at, updated: at });
        }),

        /** Edits text, tags or the article link of a note or comment. */
        update: (id, patch = {}) => run(async () => {
            const rec = await recOf(id); if (!rec) return null;
            const next = { ...rec, updated: now() };
            if (patch.text !== undefined) { next.text = clip(patch.text, MAX_TEXT); if (!next.text && rec.kind === 'note') return rec; }
            if (patch.tags !== undefined) next.tags = cleanTags(patch.tags);
            if (patch.url !== undefined) { if (patch.url) next.url = clip(patch.url, 2048); else delete next.url; }
            return save(next);
        }),

        /** Deletes a note or comment (and leaves the stamp for sync). → true when it existed. */
        remove: (id) => run(async () => {
            const rec = await recOf(id); if (!rec) return false;
            await set({ [SK.notesIndex]: (await indexNow()).filter((e) => e.id !== id) });
            await new Promise((r) => storage.remove(noteRecKey(id), r));
            await mark('note', [id]);
            return true;
        }),

        /** The comment on a highlight: created, changed, or removed when both text and tags are empty. → the record or null */
        setComment: (highlightId, { text, tags, url } = {}) => run(async () => {
            if (!highlightId) return null;
            const id = 'c_' + highlightId, rec = await recOf(id), t = clip(text, MAX_TEXT), tg = cleanTags(tags);
            if (!t && !tg.length) {
                if (!rec) return null;
                await set({ [SK.notesIndex]: (await indexNow()).filter((e) => e.id !== id) });
                await new Promise((r) => storage.remove(noteRecKey(id), r));
                await mark('note', [id]);
                return null;
            }
            const at = now();
            return save({ ...(rec || { id, kind: 'comment', highlightId, created: at }), text: t, tags: tg, ...(url ? { url: clip(url, 2048) } : {}), updated: at });
        }),

        /** Everything: { notes: [records, newest first], comments: { [highlightId]: record } } */
        async list() {
            const idx = await indexNow(), recs = [];
            for (let i = 0; i < idx.length; i += 50) {
                const part = idx.slice(i, i + 50), got = await get(part.map((e) => noteRecKey(e.id)));
                for (const e of part) { const r = got[noteRecKey(e.id)]; if (r) recs.push(r); }
            }
            const notes = recs.filter((r) => r.kind === 'note').sort((a, b) => String(b.created).localeCompare(String(a.created)));
            const comments = {}; for (const r of recs) if (r.kind === 'comment' && r.highlightId) comments[r.highlightId] = r;
            return { notes, comments };
        },
        get: recOf,
        count: async () => (await indexNow()).length,
    };
}
