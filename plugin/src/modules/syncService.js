// modules/syncService.js
// What the settings screen and the background worker call: servers, places, test, run. Storage, stores and the clock are
// injected, so the same code runs in the worker, the popup and the tests.
//
// A server ("connection", sync:connections, no secrets):  { id, name, service: 'webdav', url, username, allowInsecureLan? }
//   its login lives apart in sync:secrets[connectionId] = { password }
// A place (sync:places) is one folder on a server:
//   { id, name, connectionId, root, mode: 'readable', direction: 'publish', scope: 'tag' | 'except' | 'all',
//     filter: { tag } | { excludeTag } | {}, include: { highlights, qa }, viewer (also publish index.html), enabled, created }
// One server can hold several places, for example `public/` (a readable list for a website) next to `backup/`.
// Encrypted places and two-way sync are not built yet and are refused.
import { SK, syncLedgerKey } from './storageKeys.js';
import { pushPlace } from './syncPush.js';
import { placeMatches, INCLUDE_DEFAULT } from './syncReadable.js';
import { TargetError } from './targets/targetError.js';

export const SERVICES = ['webdav'];
export const SCOPES = ['tag', 'except', 'all'];
const get = (storage, keys) => Promise.resolve(storage.get(keys));
const rid = (prefix) => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

/** A server, from what the form sent. Throws an Error with a message the screen can show. */
export function cleanConnection(input, { id } = {}) {
    const p = input || {};
    if (!SERVICES.includes(p.service || 'webdav')) throw new Error('This kind of place is not available yet.');
    let url;
    try { url = new URL(clip(p.url, 2048)); } catch (_) { throw new Error('Enter the full address, starting with https://'); }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && p.allowInsecureLan)) throw new Error('The address must start with https://');
    return {
        id: id || p.id || rid('cn_'),
        name: clip(p.name, 60) || url.host,
        service: p.service || 'webdav',
        url: url.href,
        username: clip(p.username, 200),
        ...(p.allowInsecureLan ? { allowInsecureLan: true } : {}),
    };
}

/** A place (a folder on a server), from what the form sent. */
export function cleanPlace(input, { id } = {}) {
    const p = input || {};
    if (p.mode && p.mode !== 'readable') throw new Error('Encrypted places are not available yet.');
    if (p.direction && p.direction !== 'publish') throw new Error('Two-way sync is not available yet.');
    if (!p.connectionId) throw new Error('Choose a server.');
    // which articles go out: 'tag' (only those with a tag), 'except' (all but those with a tag) or 'all' (a deliberate choice)
    const scope = SCOPES.includes(p.scope) ? p.scope : (p.filter && p.filter.tag ? 'tag' : p.filter && p.filter.excludeTag ? 'except' : '');
    if (!scope) throw new Error('Choose which articles to publish.');
    const filter = {};
    if (scope === 'tag') { filter.tag = clip(p.filter && p.filter.tag, 40); if (!filter.tag) throw new Error('Enter the tag of the articles to publish.'); }
    if (scope === 'except') { filter.excludeTag = clip(p.filter && p.filter.excludeTag, 40); if (!filter.excludeTag) throw new Error('Enter the tag of the articles to leave out.'); }
    const include = { ...INCLUDE_DEFAULT, ...(p.include || {}) };
    const root = clip(p.root, 120).replace(/^\/+|\/+$/g, '') || 'aish-sync';
    return {
        id: id || p.id || rid('pl_'),
        name: clip(p.name, 60) || root,
        connectionId: p.connectionId,
        root,
        mode: 'readable', direction: 'publish', scope,
        include: { highlights: !!include.highlights, qa: !!include.qa, notes: !!include.notes, reminders: !!include.reminders, fulltext: !!include.fulltext },
        viewer: !!p.viewer,
        filter,
        enabled: p.enabled !== false,
        created: p.created || new Date().toISOString(),
    };
}

/**
 * Places made before servers were split out carry their own url and username. Each becomes a server of its own, and its login
 * moves with it. Returns { places, connections, secrets, changed }.
 */
export function migrateLegacy(places, connections, secrets) {
    let changed = false;
    const conns = [...connections], sec = { ...secrets };
    const out = places.map((p) => {
        if (!p || p.connectionId || !p.url) return p;
        changed = true;
        const id = 'cn_' + String(p.id).replace(/^pl_/, '');
        conns.push({ id, name: p.name || new URL(p.url).host, service: p.service || 'webdav', url: p.url, username: p.username || '', ...(p.allowInsecureLan ? { allowInsecureLan: true } : {}) });
        if (sec[p.id] && !sec[id]) { sec[id] = sec[p.id]; delete sec[p.id]; }
        const { url, username, service, allowInsecureLan, ...rest } = p; void url; void username; void service; void allowInsecureLan;
        return { ...rest, connectionId: id };
    });
    return { places: out, connections: conns, secrets: sec, changed };
}

export function createSyncService({ storage, makeStore, stampStore, viewerSource, now = () => Date.now(), log = () => {}, scheduleSoon = () => {} }) {
    const active = new Set();   // places with a run going: the alarm, the debounce and "Publish now" must not start a second one on the same place
    const statusNow = async () => { const d = await get(storage, { [SK.syncStatus]: {} }); return d[SK.syncStatus] && typeof d[SK.syncStatus] === 'object' ? d[SK.syncStatus] : {}; };
    const setStatus = async (id, s) => storage.set({ [SK.syncStatus]: { ...(await statusNow()), [id]: s } });
    // the last finished result stays; `running` rides on top of it while a run is going (and goes with it)
    const setRunning = async (id, running) => { const all = await statusNow(); storage.set({ [SK.syncStatus]: { ...all, [id]: { ...(all[id] || {}), running } } }); };

    /** Everything stored, with places from before the server split migrated (and saved). */
    async function load() {
        const d = await get(storage, { [SK.syncPlaces]: [], [SK.syncConnections]: [], [SK.syncSecrets]: {} });
        const m = migrateLegacy(Array.isArray(d[SK.syncPlaces]) ? d[SK.syncPlaces] : [], Array.isArray(d[SK.syncConnections]) ? d[SK.syncConnections] : [], d[SK.syncSecrets] && typeof d[SK.syncSecrets] === 'object' ? d[SK.syncSecrets] : {});
        if (m.changed) await storage.set({ [SK.syncPlaces]: m.places, [SK.syncConnections]: m.connections, [SK.syncSecrets]: m.secrets });
        return m;
    }
    const placesNow = async () => (await load()).places;
    const connectionsNow = async () => (await load()).connections;
    const storeOf = (connection, place, secret) => makeStore(connection, place, secret || {});
    const fail = (e) => { const err = new Error(e.message); err.kind = e.kind; return err; };

    async function matchingCount(place) {
        const idx = (await get(storage, { [SK.articlesIndex]: [] }))[SK.articlesIndex];
        return (Array.isArray(idx) ? idx : []).filter((e) => placeMatches(e, place)).length;
    }
    /** The server for a form: an existing one by id, or a new one described by `conn`. */
    async function resolveConnection(connectionId, conn, secret, st) {
        if (connectionId) {
            const c = st.connections.find((x) => x.id === connectionId);
            if (!c) throw new Error('This server no longer exists.');
            return { connection: c, secret: (secret && secret.password) ? secret : (st.secrets[connectionId] || {}), isNew: false };
        }
        return { connection: cleanConnection(conn, {}), secret: secret || {}, isNew: true };
    }

    return {
        placesNow, connectionsNow, statusNow,

        /** How many articles a place with this scope would publish (no network). */
        async preview(input) { return { count: await matchingCount(cleanPlace({ ...input, connectionId: input.connectionId || 'x' }, { id: 'preview' })) }; },

        /** Checks a server (address and login). Nothing is saved. → { ok } or { ok:false, error } */
        async testServer({ connectionId, connection: conn, secret }) {
            try {
                const st = await load();
                const r = await resolveConnection(connectionId, conn, secret, st);
                await storeOf(r.connection, { root: '' }, r.secret).ping();
                return { ok: true };
            } catch (e) { return { ok: false, error: describe(e) }; }
        },

        /** Checks a server and the folder on it, and counts the articles the place would receive. Nothing is saved. */
        async test({ connectionId, connection: conn, place: input, secret }) {
            try {
                const st = await load();
                const r = await resolveConnection(connectionId, conn, secret, st);
                const place = cleanPlace({ ...input, connectionId: r.connection.id }, { id: 'test' });
                await storeOf(r.connection, place, r.secret).ping();
                return { ok: true, count: await matchingCount(place) };
            } catch (e) { return { ok: false, error: describe(e) }; }
        },

        /** Saves a place (and its server, when new) after the connection checked out, and stamps the existing library. */
        async add({ connectionId, connection: conn, place: input, secret }) {
            const st = await load();
            const r = await resolveConnection(connectionId, conn, secret, st);
            const place = cleanPlace({ ...input, connectionId: r.connection.id }, {});
            const t = await this.test({ connectionId: r.isNew ? '' : r.connection.id, connection: r.isNew ? r.connection : undefined, place, secret: r.secret });
            if (!t.ok) throw fail(t.error);
            await storage.set({
                [SK.syncPlaces]: [...st.places, place],
                ...(r.isNew ? { [SK.syncConnections]: [...st.connections, r.connection], [SK.syncSecrets]: { ...st.secrets, [r.connection.id]: { password: String(r.secret.password || '') } } } : {}),
            });
            if (stampStore) await stampStore.scan({ full: true });
            scheduleSoon(1);
            return place;
        },

        /** Changes a place. A new scope or include list republishes on the next run. */
        async update(id, input) {
            const st = await load();
            const old = st.places.find((p) => p.id === id);
            if (!old) throw new Error('This place no longer exists.');
            if (input && input.connectionId && !st.connections.some((c) => c.id === input.connectionId)) throw new Error('This server no longer exists.');
            const place = cleanPlace({ ...old, ...input }, { id });
            place.created = old.created;
            await storage.set({ [SK.syncPlaces]: st.places.map((p) => (p.id === id ? place : p)) });
            scheduleSoon(1);
            return place;
        },

        /** Changes a server's address, username or login. It applies to every place on it. */
        async updateServer(connectionId, input, secret) {
            const st = await load();
            const old = st.connections.find((c) => c.id === connectionId);
            if (!old) throw new Error('This server no longer exists.');
            const c = cleanConnection({ ...old, ...input }, { id: connectionId });
            await storage.set({ [SK.syncConnections]: st.connections.map((x) => (x.id === connectionId ? c : x)), ...(secret && secret.password ? { [SK.syncSecrets]: { ...st.secrets, [connectionId]: { password: String(secret.password) } } } : {}) });
            scheduleSoon(1);
            return c;
        },

        /** Forgets a place. A server nobody uses any more is forgotten with its login. The files already published stay. */
        async remove(id) {
            const st = await load();
            const place = st.places.find((p) => p.id === id);
            const places = st.places.filter((p) => p.id !== id);
            const status = await statusNow(); delete status[id];
            const keep = place && places.some((p) => p.connectionId === place.connectionId);
            const secrets = { ...st.secrets };
            if (place && !keep) delete secrets[place.connectionId];
            await storage.set({ [SK.syncPlaces]: places, [SK.syncStatus]: status, [SK.syncSecrets]: secrets, [SK.syncConnections]: place && !keep ? st.connections.filter((c) => c.id !== place.connectionId) : st.connections });
            await storage.remove(syncLedgerKey(id));
        },

        /** Runs one place or all of them. Never throws: the outcome of each is stored as its status. */
        async syncNow(id, { confirmRemovals = false } = {}) {
            const st = await load();
            const places = st.places.filter((p) => p.enabled !== false && (!id || p.id === id));
            if (!places.length) return {};
            if (stampStore) await stampStore.scan();
            const stamps = stampStore ? await stampStore.all() : {};
            const results = {};
            for (const place of places) {
                if (active.has(place.id)) { results[place.id] = { skipped: 'running' }; continue; }
                active.add(place.id);
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
                    const connection = st.connections.find((c) => c.id === place.connectionId);
                    if (!connection) throw new Error('The server of this place was removed.');
                    const viewer = place.viewer && viewerSource ? await viewerSource(place) : null;
                    const r = await pushPlace({ place, storage, store: storeOf(connection, place, st.secrets[connection.id]), stamps, now, confirmRemovals, onProgress, viewer, verify: !!id });   // a manual publish looks at the folder first
                    await writing;
                    results[place.id] = r;
                    await setStatus(place.id, { at, ok: true, pushed: r.pushed, removed: r.removed, unchanged: r.unchanged, errors: r.errors.length, more: r.more, remaining: r.remaining, needsConfirm: r.needsConfirm, viewer: r.viewer, repaired: r.repaired, orphans: r.orphans });   // no `running`: the run is over
                    if (r.more) scheduleSoon(1);
                } catch (e) {
                    log('[sync]', place.id, e && e.message);
                    await writing;
                    results[place.id] = { error: describe(e) };
                    await setStatus(place.id, { at, ok: false, error: describe(e) });
                } finally { active.delete(place.id); }
            }
            return results;
        },
    };
}

function describe(e) {
    if (e instanceof TargetError) return { kind: e.kind, message: e.kind === 'auth' ? 'The server did not accept the username and password.' : e.status === 404 && !/Check the address/.test(e.message) ? 'The address was not found on the server.' : e.message, status: e.status };
    return { kind: 'permanent', message: String((e && e.message) || e) };
}
