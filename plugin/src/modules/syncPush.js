// modules/syncPush.js
// Publishes the library to a readable, publish-only place (see .briefs/prd-library-sync.md): one JSON file per matching
// article plus library.json for websites. Idempotent: an unchanged article is never uploaded twice (content hash in the place's
// ledger), and the run can stop at any point (time budget, network) and continue next time.
//
// Ledger (sync:ledger:<placeId>): { cfg, items: { [articleId]: { hash, t, etag } }, lib: 1 }
//   cfg   configHash of the place when the files were written; a change re-checks everything
//   t     the newest stamp time (article, its highlights) behind the file: a cheap prefilter, so a run does not rebuild
//         every article. Without a stamp the article is always rebuilt.
//
// Removal rules: only articles that left the place (filter changed, deleted) lose their file, and a run that would remove
// a large share of what is published stops and asks (a restore of a smaller library must not empty a website).
import { SK, articleRecKey, syncLedgerKey } from './storageKeys.js';
import { pageKeyForUrl } from './pageKey.js';
import { hashValue } from './syncStamps.js';
import { articlePath, LIBRARY_PATH, placeMatches, configHash, buildArticleFile, libraryEntry, toJson } from './syncReadable.js';
import { TargetError } from './targets/targetError.js';

const MAX_REMOVE_SHARE = 0.5, MIN_REMOVE_GUARD = 10;
const get = (storage, keys) => Promise.resolve(storage.get(keys));

/**
 * @param {{ place, storage, store, stamps?, now?, budgetMs?, confirmRemovals?, chunk?, onProgress?: ({ phase, done, total }) => void }} o
 *   onProgress phases: 'checking' (reading the library), 'removing', 'uploading', 'list' (library.json)
 * @returns {Promise<{ pushed, unchanged, removed, errors, more, needsConfirm, libraryWritten }>}
 */
export async function pushPlace({ place, storage, store, stamps = {}, now = Date.now, budgetMs = 20000, confirmRemovals = false, chunk = 25, onProgress = () => {} }) {
    const started = now();
    const out = { pushed: 0, unchanged: 0, removed: 0, errors: [], more: false, needsConfirm: 0, libraryWritten: false };
    const lk = syncLedgerKey(place.id);
    onProgress({ phase: 'checking', done: 0, total: 0 });
    const d = await get(storage, { [SK.articlesIndex]: [], [SK.annotations]: [], [lk]: {} });
    const index = Array.isArray(d[SK.articlesIndex]) ? d[SK.articlesIndex] : [];
    const annotations = Array.isArray(d[SK.annotations]) ? d[SK.annotations] : [];
    let ledger = d[lk] && typeof d[lk] === 'object' ? d[lk] : {};
    const cfg = configHash(place);
    const force = ledger.cfg !== cfg;
    const items = { ...(ledger.items || {}) };   // a config change only skips the stamp prefilter: unchanged files are still not uploaded again
    const known = new Set(Object.keys(items));
    const save = () => storage.set({ [lk]: { cfg, items, lib: ledger.lib || 0 } });

    const matching = index.filter((e) => placeMatches(e, place));
    const matchIds = new Set(matching.map((e) => e.id));
    const hlByPage = new Map();
    for (const h of annotations) if (h && h.url && !h.dismissed) { const a = hlByPage.get(h.url) || []; a.push(h); hlByPage.set(h.url, a); }
    const hlT = (page) => Math.max(0, ...(hlByPage.get(page) || []).map((h) => (stamps['hl:' + h.id] && stamps['hl:' + h.id].rev && stamps['hl:' + h.id].rev.t) || 0));

    // 1) removals first (articles that left the place), guarded
    const gone = [...known].filter((id) => !matchIds.has(id));
    const published = known.size;
    if (gone.length && !confirmRemovals && gone.length > Math.max(MIN_REMOVE_GUARD, Math.floor(published * MAX_REMOVE_SHARE))) {
        out.needsConfirm = gone.length;
    } else {
        let removing = 0;
        for (const id of gone) {
            onProgress({ phase: 'removing', done: removing++, total: gone.length });
            try { await store.remove(articlePath(id)); delete items[id]; out.removed++; }
            catch (e) { if (e instanceof TargetError && e.kind !== 'permanent') throw e; out.errors.push({ id, error: String(e.message || e) }); }
        }
    }

    // 2) push what changed
    const changedFiles = new Map();   // id → file object (for library.json)
    const todo = matching.filter((e) => {
        const it = items[e.id];
        const st = stamps['article:' + e.id];
        const t = Math.max((st && st.rev && st.rev.t) || 0, hlT(pageKeyForUrl(e.url || '')));
        return force || !it || !st || t > (it.t || 0);
    });
    out.unchanged = matching.length - todo.length;
    let done = 0;
    if (todo.length) onProgress({ phase: 'uploading', done: 0, total: todo.length });
    for (let i = 0; i < todo.length; i += chunk) {
        const part = todo.slice(i, i + chunk);
        const recs = await get(storage, part.map((e) => articleRecKey(e.id)));
        for (const e of part) {
            if (now() - started > budgetMs) { out.more = true; break; }
            const page = pageKeyForUrl(e.url || '');
            const st = stamps['article:' + e.id];
            const file = buildArticleFile({ entry: e, rec: recs[articleRecKey(e.id)] || null, highlights: hlByPage.get(page) || [], place, rev: st && st.rev });
            const text = toJson(file);
            const hash = hashValue(text);
            const t = Math.max((st && st.rev && st.rev.t) || 0, hlT(page));
            const prev = items[e.id];
            try {
                if (!prev || prev.hash !== hash) {
                    const r = await store.put(articlePath(e.id), text, { contentType: 'application/json' });
                    items[e.id] = { hash, t, etag: r.etag };
                    changedFiles.set(e.id, file);
                    out.pushed++;
                } else { items[e.id] = { ...prev, t }; out.unchanged++; }
                done++;
                onProgress({ phase: 'uploading', done, total: todo.length });
            } catch (err) {
                if (err instanceof TargetError && err.kind !== 'permanent') { await save(); throw err; }   // network or login: stop, keep progress
                out.errors.push({ id: e.id, error: String((err && err.message) || err) });
            }
        }
        await save();
        if (out.more) break;
    }
    void done;

    // 3) library.json: patch the published list instead of rebuilding it from every record
    if (!out.more && (out.pushed || out.removed || force || !ledger.lib)) {
        onProgress({ phase: 'list', done: 0, total: 1 });
        let entries = new Map();
        if (!force && ledger.lib) {
            try { const g = await store.get(LIBRARY_PATH); if (g) for (const a of JSON.parse(new TextDecoder().decode(g.bytes)).articles || []) entries.set(a.id, a); } catch (_) { entries = new Map(); }
        }
        const fromRemote = entries.size > 0;
        if (!fromRemote && matching.some((e) => !changedFiles.has(e.id) && items[e.id])) {
            // the list is missing or unreadable: rebuild every entry from the records
            for (const e of matching) {
                if (!items[e.id] || changedFiles.has(e.id)) continue;
                const recs = await get(storage, [articleRecKey(e.id)]);
                changedFiles.set(e.id, buildArticleFile({ entry: e, rec: recs[articleRecKey(e.id)] || null, highlights: hlByPage.get(pageKeyForUrl(e.url || '')) || [], place, rev: (stamps['article:' + e.id] || {}).rev }));
            }
        }
        for (const id of [...entries.keys()]) if (!matchIds.has(id) || !items[id]) entries.delete(id);
        for (const [id, file] of changedFiles) entries.set(id, libraryEntry(file));
        const list = [...entries.values()].sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')) || String(a.id).localeCompare(String(b.id)));
        const lib = { aish: 'library/1', generatedAt: new Date(now()).toISOString(), count: list.length, articles: list };
        try { await store.put(LIBRARY_PATH, toJson(lib), { contentType: 'application/json' }); out.libraryWritten = true; ledger = { ...ledger, lib: 1 }; await save(); }
        catch (err) { if (err instanceof TargetError && err.kind !== 'permanent') throw err; out.errors.push({ id: LIBRARY_PATH, error: String((err && err.message) || err) }); }
    }
    return out;
}
