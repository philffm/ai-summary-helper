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

export const INBOX_API = 'https://api.byphil.eu/v1/projects/ai_summary_helper/inboxes';
export const PAGE_SIZE = 50;
export const MAX_PAGES = 4;        // per poll; the rest is collected on the next one
export const SEEN_MAX = 500;       // handled item ids remembered
export const PENDING_MAX = 200;    // links waiting for the user; when full, polling pauses and the server keeps the rest

const EMPTY_STATE = () => ({ cursor: '', ackedCursor: '', seen: [], lastPollAt: 0, lastError: '' });

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

    async function runPoll() {
        const cfg = await getConfig();
        if (!cfg) return { ok: false, error: 'not-paired' };
        const state = await getState();
        const pending = await getPending();
        const seen = new Set(state.seen);
        const urls = new Set(pending.map((p) => p.url));
        const out = { ok: true, added: 0, duplicates: 0, rejected: 0, full: false };
        const base = `${api}/${encodeURIComponent(cfg.inboxId)}`;
        const fail = async (error) => {
            await store().set({ [SK.inboxState]: { ...state, lastPollAt: now(), lastError: error } });
            return { ...out, ok: false, error, pending: pending.length };
        };

        // an earlier acknowledge may have failed: retry it first (items up to ackedCursor are already stored locally)
        if (state.cursor && state.cursor !== state.ackedCursor) {
            const ack = await call('POST', `${base}/ack`, { upTo: state.cursor }, cfg.readToken);
            if (ack.status >= 200 && ack.status < 300) state.ackedCursor = state.cursor;
            else if (classify(ack.status) === 'pairing-invalid') return fail('pairing-invalid');
        }

        for (let page = 0; page < MAX_PAGES; page++) {
            if (pending.length >= PENDING_MAX) { out.full = true; break; }
            const q = `limit=${PAGE_SIZE}` + (state.cursor ? `&after=${encodeURIComponent(state.cursor)}` : '');
            const res = await call('GET', `${base}/items?${q}`, null, cfg.readToken);
            if (res.status !== 200 || !res.json || !Array.isArray(res.json.items)) return fail(classify(res.status));
            const items = res.json.items.filter((it) => it && typeof it.id === 'string' && typeof it.cursor === 'string');
            if (!items.length) break;

            for (const it of items) {
                if (seen.has(it.id)) { out.duplicates++; continue; }
                seen.add(it.id); state.seen.push(it.id);
                let msg;
                try { msg = await decryptMessage(cfg, { v: it.v, data: it.data }); } catch (_) { out.rejected++; continue; }   // unreadable or hostile: dropped, but acknowledged below so it cannot block the inbox
                if (urls.has(msg.url)) { out.duplicates++; continue; }
                urls.add(msg.url);
                pending.push({ id: it.id, url: msg.url, sentAt: msg.sentAt, platform: msg.platform, receivedAt: now() });
                out.added++;
            }
            if (state.seen.length > SEEN_MAX) state.seen.splice(0, state.seen.length - SEEN_MAX);
            state.cursor = items[items.length - 1].cursor;
            // store first, acknowledge second
            await store().set({ [SK.inboxPending]: pending, [SK.inboxState]: { ...state, lastPollAt: now(), lastError: '' } });
            const ack = await call('POST', `${base}/ack`, { upTo: state.cursor }, cfg.readToken);
            if (ack.status >= 200 && ack.status < 300) state.ackedCursor = state.cursor;
            if (!res.json.hasMore) break;
        }
        await store().set({ [SK.inboxState]: { ...state, lastPollAt: now(), lastError: '' } });
        return { ...out, pending: pending.length };
    }

    /** Links waiting for the user, oldest first. */
    const listPending = getPending;

    /** Removes one waiting link (after Summarize was started, or on Dismiss). Returns the removed entry or null. */
    async function resolve(id) {
        const pending = await getPending();
        const i = pending.findIndex((p) => p.id === id);
        if (i < 0) return null;
        const [gone] = pending.splice(i, 1);
        await store().set({ [SK.inboxPending]: pending });
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

    return { pair, pairingCode, poll, listPending, resolve, status, unpair };
}
