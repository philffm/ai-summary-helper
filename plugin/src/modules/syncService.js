// modules/syncService.js
// What the settings screen and the background worker call: add, test, remove and run sync places. Storage, stores and the
// clock are injected, so the same code runs in the worker, the popup and the tests.
//
// A place (sync:places, no secrets):
//   { id, name, service: 'webdav', url, root, username, mode: 'readable', direction: 'publish', include: { highlights, qa },
//     filter: { tag } | { excludeTag }, enabled, allowInsecureLan?, created }
// Its login lives apart in sync:secrets[id] = { password }. Encrypted places and two-way sync are not built yet and are refused.
import { SK, syncLedgerKey } from './storageKeys.js';
import { pushPlace } from './syncPush.js';
import { placeMatches, INCLUDE_DEFAULT } from './syncReadable.js';
import { TargetError } from './targets/targetError.js';

export const SERVICES = ['webdav'];
const get = (storage, keys) => Promise.resolve(storage.get(keys));
const newId = () => 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

/** Turns what the form sent into a stored place, or throws an Error with a message the screen can show. */
export function cleanPlace(input, { id } = {}) {
    const p = input || {};
    if (!SERVICES.includes(p.service)) throw new Error('This kind of place is not available yet.');
    if (p.mode && p.mode !== 'readable') throw new Error('Encrypted places are not available yet.');
    if (p.direction && p.direction !== 'publish') throw new Error('Two-way sync is not available yet.');
    let url;
    try { url = new URL(clip(p.url, 2048)); } catch (_) { throw new Error('Enter the full address, starting with https://'); }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && p.allowInsecureLan)) throw new Error('The address must start with https://');
    const filter = {};
    if (clip(p.filter && p.filter.tag, 40)) filter.tag = clip(p.filter.tag, 40);
    else if (clip(p.filter && p.filter.excludeTag, 40)) filter.excludeTag = clip(p.filter.excludeTag, 40);
    if (!filter.tag && !filter.excludeTag && !p.allowEverything) throw new Error('Choose which articles to publish: enter a tag.');
    const include = { ...INCLUDE_DEFAULT, ...(p.include || {}) };
    return {
        id: id || p.id || newId(),
        name: clip(p.name, 60) || url.host,
        service: p.service,
        url: url.href,
        root: clip(p.root, 120).replace(/^\/+|\/+$/g, '') || 'aish-sync',
        username: clip(p.username, 200),
        mode: 'readable', direction: 'publish',
        include: { highlights: !!include.highlights, qa: !!include.qa },
        filter,
        enabled: p.enabled !== false,
        ...(p.allowInsecureLan ? { allowInsecureLan: true } : {}),
        created: p.created || new Date().toISOString(),
    };
}

export function createSyncService({ storage, makeStore, stampStore, now = () => Date.now(), log = () => {}, scheduleSoon = () => {} }) {
    const placesNow = async () => { const d = await get(storage, { [SK.syncPlaces]: [] }); return Array.isArray(d[SK.syncPlaces]) ? d[SK.syncPlaces] : []; };
    const secretsNow = async () => { const d = await get(storage, { [SK.syncSecrets]: {} }); return d[SK.syncSecrets] && typeof d[SK.syncSecrets] === 'object' ? d[SK.syncSecrets] : {}; };
    const statusNow = async () => { const d = await get(storage, { [SK.syncStatus]: {} }); return d[SK.syncStatus] && typeof d[SK.syncStatus] === 'object' ? d[SK.syncStatus] : {}; };
    const setStatus = async (id, s) => storage.set({ [SK.syncStatus]: { ...(await statusNow()), [id]: s } });
    // the last finished result stays; `running` rides on top of it while a run is going (and goes with it)
    const setRunning = async (id, running) => { const all = await statusNow(); storage.set({ [SK.syncStatus]: { ...all, [id]: { ...(all[id] || {}), running } } }); };
    const storeOf = (place, secret) => makeStore(place, secret || {});

    async function matchingCount(place) {
        const idx = (await get(storage, { [SK.articlesIndex]: [] }))[SK.articlesIndex];
        return (Array.isArray(idx) ? idx : []).filter((e) => placeMatches(e, place)).length;
    }

    return {
        placesNow, statusNow,

        /** How many articles a place with this filter would publish (no network). */
        async preview(input) { return { count: await matchingCount(cleanPlace(input, { id: 'preview' })) }; },

        /** Checks the address and login. Returns { ok, count } or { ok:false, error }. Nothing is saved. */
        async test(input, secret) {
            let place;
            try { place = cleanPlace(input, { id: 'test' }); } catch (e) { return { ok: false, error: { kind: 'input', message: e.message } }; }
            try { await storeOf(place, secret).ping(); return { ok: true, count: await matchingCount(place) }; }
            catch (e) { return { ok: false, error: describe(e) }; }
        },

        /** Saves a place and its login after the connection checked out, and stamps the existing library. */
        async add(input, secret) {
            const place = cleanPlace(input);
            const t = await this.test(place, secret);
            if (!t.ok) { const err = new Error(t.error.message); err.kind = t.error.kind; throw err; }
            await storage.set({ [SK.syncPlaces]: [...(await placesNow()), place], [SK.syncSecrets]: { ...(await secretsNow()), [place.id]: { password: String((secret && secret.password) || '') } } });
            if (stampStore) await stampStore.scan({ full: true });
            scheduleSoon(1);
            return place;
        },

        /** Changes a place's settings (and, if given, its login). A new filter or include list republishes on the next run. */
        async update(id, input, secret) {
            const all = await placesNow();
            const old = all.find((p) => p.id === id);
            if (!old) throw new Error('This place no longer exists.');
            const place = cleanPlace({ ...old, ...input }, { id });
            place.created = old.created;
            const secrets = await secretsNow();
            await storage.set({ [SK.syncPlaces]: all.map((p) => (p.id === id ? place : p)), ...(secret && secret.password ? { [SK.syncSecrets]: { ...secrets, [id]: { password: String(secret.password) } } } : {}) });
            scheduleSoon(1);
            return place;
        },

        /** Forgets a place. The files it published stay where they are (the screen says so). */
        async remove(id) {
            const secrets = await secretsNow(); delete secrets[id];
            const status = await statusNow(); delete status[id];
            await storage.set({ [SK.syncPlaces]: (await placesNow()).filter((p) => p.id !== id), [SK.syncSecrets]: secrets, [SK.syncStatus]: status });
            await storage.remove(syncLedgerKey(id));
        },

        /** Runs one place or all of them. Never throws: the outcome of each is stored as its status. */
        async syncNow(id, { confirmRemovals = false } = {}) {
            const places = (await placesNow()).filter((p) => p.enabled !== false && (!id || p.id === id));
            if (!places.length) return {};
            const secrets = await secretsNow();
            if (stampStore) await stampStore.scan();
            const stamps = stampStore ? await stampStore.all() : {};
            const results = {};
            for (const place of places) {
                const at = new Date(now()).toISOString();
                const since = now();
                let lastWrite = 0, lastPhase = '';
                let writing = Promise.resolve();
                const onProgress = (p) => {
                    const t = now();
                    if (p.phase === lastPhase && t - lastWrite < 500 && p.done < p.total) return;   // about twice a second, always on a phase change and at the end
                    lastPhase = p.phase; lastWrite = t;
                    writing = writing.then(() => setRunning(place.id, { ...p, since, at: t }));
                };
                await setRunning(place.id, { phase: 'starting', done: 0, total: 0, since, at: since });
                try {
                    const r = await pushPlace({ place, storage, store: storeOf(place, secrets[place.id]), stamps, now, confirmRemovals, onProgress });
                    await writing;
                    results[place.id] = r;
                    await setStatus(place.id, { at, ok: true, pushed: r.pushed, removed: r.removed, unchanged: r.unchanged, errors: r.errors.length, more: r.more, needsConfirm: r.needsConfirm });   // no `running`: the run is over
                    if (r.more) scheduleSoon(1);
                } catch (e) {
                    log('[sync]', place.id, e && e.message);
                    await writing;
                    results[place.id] = { error: describe(e) };
                    await setStatus(place.id, { at, ok: false, error: describe(e) });
                }
            }
            return results;
        },
    };
}

function describe(e) {
    if (e instanceof TargetError) return { kind: e.kind, message: e.kind === 'auth' ? 'The server did not accept the username and password.' : e.status === 404 && !/Check the address/.test(e.message) ? 'The address was not found on the server.' : e.message, status: e.status };
    return { kind: 'permanent', message: String((e && e.message) || e) };
}
