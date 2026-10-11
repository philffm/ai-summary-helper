// modules/inboxManager.js
// The extension's side of the phone inbox: pair a phone, collect the links it shared, hand them to the user, unpair.
//
// The phone encrypts each link and appends it to a small inbox on the byPhil server; this module collects, decrypts and
// de-duplicates them. It never opens a page itself: links wait in `inbox:pending` until the user taps Summarize or Dismiss.
//
// Nothing here touches chrome.* directly: fetch and storage are injected (defaults are the real ones), so the same code runs
// in the popup, in the background worker (bundled as a classic script) and in the Node tests against the reference server
// in plugin/inbox-api/.
//
// Order inside a poll (a crash can repeat an item, never lose one; the repeat is dropped by the handled-id list):
//   fetch after the stored cursor → decrypt → drop handled/duplicate links → save pending + cursor → acknowledge on the server.

import { SK } from './storageKeys.js';
import { newInboxSecrets, tokenHash, pairingPayload, decryptMessage } from './inboxCrypto.js';

// The first segment after the project is the collection name in the byPhil database: aish_inboxes (its items: aish_inbox_items).
export const INBOX_API = 'https://api.byphil.eu/v1/projects/ai_summary_helper/aish_inboxes';
export const PAGE_SIZE = 50;
export const MAX_PAGES = 4;        // per poll; the rest is collected on the next one
export const SEEN_MAX = 500;       // handled item ids remembered
export const PENDING_MAX = 200;    // links waiting for the user; when full, polling pauses and the server keeps the rest

// cursor: where the next fetch continues. toDelete: items the user dealt with (or that were unusable) whose delete on the
// server has not gone through yet; they are retried on every poll. ackedCursor is unused (kept so old state still loads).
const EMPTY_STATE = () => ({ cursor: '', ackedCursor: '', seen: [], toDelete: [], lastPollAt: 0, lastError: '' });
export const TODELETE_MAX = 500;

/** HTTP status → short reason code the UI can translate. */
export function classify(status) {
    if (status === 0 || status >= 500) return 'unreachable';
    if (status === 429) return 'rate-limited';
    if (status === 401 || status === 403 || status === 404) return 'pairing-invalid';
    return 'error';
}

export function createInboxManager({ fetchFn, storage, api = INBOX_API, now = () => Date.now(), timeoutMs = 15000 } = {}) {
    const store = () => storage || chrome.storage.local;
    const doFetch = (...args) => (fetchFn || globalThis.fetch)(...args);

    async function read(...keys) { return store().get(keys); }
    async function getConfig() { const c = (await read(SK.inboxConfig))[SK.inboxConfig]; return c && c.inboxId && c.readToken ? c : null; }
    async function getState() { return { ...EMPTY_STATE(), ...((await read(SK.inboxState))[SK.inboxState] || {}) }; }
    async function getPending() { const p = (await read(SK.inboxPending))[SK.inboxPending]; return Array.isArray(p) ? p : []; }

    /** One HTTP call; never throws. { status: 0 } means the network failed or timed out. */
    async function call(method, url, body, token) {
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
        try {
            const headers = {};
            if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';
            if (token) headers.Authorization = 'Bearer ' + token;
            const res = await doFetch(url, { method, headers, body: body === undefined || body === null ? undefined : JSON.stringify(body), signal: ctl ? ctl.signal : undefined });
            let json = null;
            try { json = await res.json(); } catch (_) { /* empty or non-JSON body */ }
            return { status: res.status, json };
        } catch (_) {
            return { status: 0, json: null };
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    /** Creates the inbox on the server and returns the text for the QR code. Already paired: returns the same code again. */
    async function pair() {
        const existing = await getConfig();
        if (existing) return { ok: true, existing: true, payload: pairingPayload(existing) };
        const secrets = newInboxSecrets();
        const res = await call('POST', api, { id: secrets.inboxId, writeHash: await tokenHash(secrets.writeToken), readHash: await tokenHash(secrets.readToken) });
        if (res.status !== 201) return { ok: false, error: classify(res.status) };
        await store().set({ [SK.inboxConfig]: { ...secrets, createdAt: now(), v: 1 }, [SK.inboxState]: EMPTY_STATE() });
        return { ok: true, existing: false, payload: pairingPayload(secrets) };
    }

    /** The QR text for an existing pairing (to show it again or to pair a second phone). Null when not paired. */
    async function pairingCode() { const c = await getConfig(); return c ? pairingPayload(c) : null; }

    let inFlight = null;
    /** Collects waiting links. Safe to call from the alarm and the popup at once: overlapping calls share one run. */
    function poll() {
        if (!inFlight) inFlight = runPoll().finally(() => { inFlight = null; });
        return inFlight;
    }

    /** Read-modify-write of the state record, so polls and resolves running at once do not overwrite each other. */
    async function mutateState(fn) {
        const st = await getState();
        fn(st);
        await store().set({ [SK.inboxState]: st });
        return st;
    }
    /** Adds fetched links to the stored list without dropping what a resolve removed or added meanwhile. */
    async function appendPending(entries) {
        const list = await getPending();
        const ids = new Set(list.map((p) => p.id)), urls = new Set(list.map((p) => p.url));
        for (const e of entries) if (!ids.has(e.id) && !urls.has(e.url)) { list.push(e); ids.add(e.id); urls.add(e.url); }
        await store().set({ [SK.inboxPending]: list });
        return list;
    }

    let flushing = null;
    /**
     * Deletes the queued items on the server (one request each). An item stays on the server until this succeeds, so a
     * link the user has not summarized yet survives a lost browser profile or a second device. 404 = already gone.
     */
    function flushDeletes() {
        if (!flushing) flushing = runFlush().finally(() => { flushing = null; });
        return flushing;
    }
    async function runFlush() {
        const cfg = await getConfig();
        if (!cfg) return { ok: false, error: 'not-paired', deleted: 0 };
        const queue = (await getState()).toDelete || [];
        if (!queue.length) return { ok: true, deleted: 0 };
        const base = `${api}/${encodeURIComponent(cfg.inboxId)}`;
        const gone = [];
        let error = '';
        for (const id of queue) {
            const res = await call('DELETE', `${base}/items/${encodeURIComponent(id)}`, null, cfg.readToken);
            if ((res.status >= 200 && res.status < 300) || res.status === 404) { gone.push(id); continue; }
            error = classify(res.status);
            if (error === 'pairing-invalid' || error === 'unreachable') break;   // nothing else will work either; retry next time
        }
        if (gone.length) await mutateState((st) => { const g = new Set(gone); st.toDelete = (st.toDelete || []).filter((x) => !g.has(x)); });
        return { ok: !error, error, deleted: gone.length };
    }

    async function runPoll() {
        const cfg = await getConfig();
        if (!cfg) return { ok: false, error: 'not-paired' };
        const state = await getState();
        const pending = await getPending();
        const seen = new Set(state.seen);
        const urls = new Set(pending.map((p) => p.url));
        const waitingIds = new Set(pending.map((p) => p.id));
        const out = { ok: true, added: 0, duplicates: 0, rejected: 0, full: false };
        const base = `${api}/${encodeURIComponent(cfg.inboxId)}`;
        let cursor = state.cursor;
        const fail = async (error) => {
            await mutateState((st) => { st.lastPollAt = now(); st.lastError = error; });
            return { ...out, ok: false, error, pending: (await getPending()).length };
        };

        // deletes that did not go through earlier
        const flushed = await flushDeletes();
        if (!flushed.ok && flushed.error === 'pairing-invalid') return fail('pairing-invalid');

        for (let page = 0; page < MAX_PAGES; page++) {
            if (pending.length >= PENDING_MAX) { out.full = true; break; }
            const q = `limit=${PAGE_SIZE}` + (cursor ? `&after=${encodeURIComponent(cursor)}` : '');
            const res = await call('GET', `${base}/items?${q}`, null, cfg.readToken);
            if (res.status !== 200 || !res.json || !Array.isArray(res.json.items)) return fail(classify(res.status));
            const items = res.json.items.filter((it) => it && typeof it.id === 'string' && typeof it.cursor === 'string');
            if (!items.length) break;

            const added = [], drop = [];
            for (const it of items) {
                if (seen.has(it.id)) {   // handled before: still on the server only if its delete is pending or was lost
                    out.duplicates++;
                    if (!waitingIds.has(it.id)) drop.push(it.id);
                    continue;
                }
                seen.add(it.id); state.seen.push(it.id);
                let msg;
                try { msg = await decryptMessage(cfg, { v: it.v, data: it.data }); } catch (_) { out.rejected++; drop.push(it.id); continue; }   // unreadable or hostile: never shown, removed from the server
                if (urls.has(msg.url)) { out.duplicates++; drop.push(it.id); continue; }                                                       // the same link is already waiting
                urls.add(msg.url); waitingIds.add(it.id);
                const entry = { id: it.id, url: msg.url, sentAt: msg.sentAt, platform: msg.platform, receivedAt: now() };
                pending.push(entry); added.push(entry);
                out.added++;
            }
            if (state.seen.length > SEEN_MAX) state.seen.splice(0, state.seen.length - SEEN_MAX);
            cursor = items[items.length - 1].cursor;
            // Items are NOT deleted here: they stay on the server until the user summarizes or dismisses them.
            if (added.length) await appendPending(added);
            await mutateState((st) => {
                st.cursor = cursor; st.seen = state.seen.slice(); st.lastPollAt = now(); st.lastError = '';
                for (const id of drop) if (!st.toDelete.includes(id)) st.toDelete.push(id);
                if (st.toDelete.length > TODELETE_MAX) st.toDelete.splice(0, st.toDelete.length - TODELETE_MAX);
            });
            if (!res.json.hasMore) break;
        }
        await flushDeletes();   // the unusable ones found just now
        await mutateState((st) => { st.lastPollAt = now(); st.lastError = ''; });
        return { ...out, pending: (await getPending()).length };
    }

    /** Links waiting for the user, oldest first. */
    const listPending = getPending;

    /**
     * Takes one link off the list (its summary was started and completed, or the user dismissed it) and queues its delete
     * on the server. Returns the removed entry or null. The server delete is attempted right away without making the
     * caller wait; if it fails it is retried on the next poll.
     */
    async function resolve(id) {
        const pending = await getPending();
        const i = pending.findIndex((p) => p.id === id);
        if (i < 0) return null;
        const [gone] = pending.splice(i, 1);
        await store().set({ [SK.inboxPending]: pending });
        await mutateState((st) => { if (!st.toDelete.includes(id)) st.toDelete.push(id); });
        flushDeletes().catch(() => { /* retried on the next poll */ });
        return gone;
    }

    async function status() {
        const cfg = await getConfig();
        const state = await getState();
        return { paired: !!cfg, createdAt: cfg ? cfg.createdAt : 0, lastPollAt: state.lastPollAt, lastError: state.lastError, pending: (await getPending()).length };
    }

    /** Deletes the inbox on the server (best effort) and every local trace of the pairing, including waiting links. */
    async function unpair() {
        const cfg = await getConfig();
        let serverDeleted = false;
        if (cfg) {
            const res = await call('DELETE', `${api}/${encodeURIComponent(cfg.inboxId)}`, null, cfg.readToken);
            serverDeleted = res.status >= 200 && res.status < 300;
        }
        await store().remove([SK.inboxConfig, SK.inboxPending, SK.inboxState]);
        return { ok: true, serverDeleted };
    }

    return { pair, pairingCode, poll, listPending, resolve, flushDeletes, status, unpair };
}
