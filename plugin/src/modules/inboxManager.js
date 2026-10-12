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
import { newInboxSecrets, newVaultSecrets, tokenHash, pairingPayload, decryptMessage, encryptArticle, encryptVault, decryptVault, toB64u } from './inboxCrypto.js';
import { localEntries, mergeEntries, planChanges, sameEntries, cleanEntries } from './feedSync.js';

// The first segment after the project is the collection name in the byPhil database: aish_inboxes (its items: aish_inbox_items).
export const INBOX_API = 'https://api.byphil.eu/v1/projects/ai_summary_helper/aish_inboxes';
export const VAULT_API = 'https://api.byphil.eu/v1/projects/ai_summary_helper/aish_vaults';
export const PAGE_SIZE = 50;
export const MAX_PAGES = 4;        // per poll; the rest is collected on the next one
export const SEEN_MAX = 500;       // handled item ids remembered
export const PENDING_MAX = 200;    // links waiting for the user; when full, polling pauses and the server keeps the rest

// cursor: where the next fetch continues. toDelete: items the user dealt with (or that were unusable) whose delete on the
// server has not gone through yet; they are retried on every poll. ackedCursor is unused (kept so old state still loads).
const EMPTY_STATE = () => ({ cursor: '', ackedCursor: '', seen: [], toDelete: [], lastPollAt: 0, lastError: '' });
export const TODELETE_MAX = 500;

const pageKey = (u) => { try { const x = new URL(u); return x.origin + x.pathname; } catch (_) { return String(u).split('#')[0].split('?')[0]; } };
const clipText = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * A page that is open in a tab and also waits in the inbox reports its own title and description (loader.js). Applies it
 * to the waiting link(s) for that same page; a page may only describe itself (`meta.url` must be the tab's own URL).
 * Mutates `list`; returns true when something changed.
 */
export function applyLinkMeta(list, tabUrl, meta) {
    if (!Array.isArray(list) || !meta || typeof meta.url !== 'string' || typeof tabUrl !== 'string') return false;
    const here = pageKey(meta.url);
    if (pageKey(tabUrl) !== here) return false;
    const title = clipText(meta.title, 200), description = clipText(meta.description, 300);
    if (!title && !description) return false;
    let changed = false;
    for (const e of list) {
        if (!e || typeof e.url !== 'string' || pageKey(e.url) !== here) continue;
        if (title && e.title !== title) { e.title = title; changed = true; }
        if (description && e.description !== description) { e.description = description; changed = true; }
    }
    return changed;
}

/**
 * The idle toolbar badge: unread Feeds items plus links waiting from the phone. The phone links are not cleared by opening
 * the popup (only by summarizing, saving or dismissing them); violet marks that some of the number is the phone.
 */
export function badgeFor(feedPending, inboxCount) {
    const feed = Math.max(0, Number(feedPending) || 0), inbox = Math.max(0, Number(inboxCount) || 0);
    const total = feed + inbox;
    if (total <= 0) return { text: '', color: '', inbox: 0 };
    return { text: total > 99 ? '99+' : String(total), color: inbox > 0 ? '#7c3aed' : '#2563eb', inbox };
}

/** HTTP status → short reason code the UI can translate. */
export function classify(status) {
    if (status === 0 || status >= 500) return 'unreachable';
    if (status === 429) return 'rate-limited';
    if (status === 401 || status === 403 || status === 404) return 'pairing-invalid';
    return 'error';
}

export const SYNC_RETRIES = 5;    // lost races against another device before a feed sync gives up

export function createInboxManager({ fetchFn, storage, api = INBOX_API, vaultApi = api.replace(/aish_inboxes$/, 'aish_vaults'), now = () => Date.now(), timeoutMs = 15000 } = {}) {
    const store = () => storage || chrome.storage.local;
    const doFetch = (...args) => (fetchFn || globalThis.fetch)(...args);

    async function read(...keys) { return store().get(keys); }
    async function getConfig() { const c = (await read(SK.inboxConfig))[SK.inboxConfig]; return c && c.inboxId && c.readToken ? c : null; }
    async function getState() { return { ...EMPTY_STATE(), ...((await read(SK.inboxState))[SK.inboxState] || {}) }; }
    async function getPending() { const p = (await read(SK.inboxPending))[SK.inboxPending]; return Array.isArray(p) ? p : []; }

    /** One HTTP call; never throws. { status: 0 } means the network failed or timed out. */
    async function call(method, url, body, token, extra) {
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
        try {
            const headers = {};
            if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';
            if (token) headers.Authorization = 'Bearer ' + token;
            if (extra) Object.assign(headers, extra);
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

    const randomB64u = (n) => toB64u(globalThis.crypto.getRandomValues(new Uint8Array(n)));
    /** Creates the second inbox (extension → phone: articles to read on the go). The extension holds both of its tokens; the phone gets the read token. */
    async function createToPhone() {
        const t = { inboxId: randomB64u(16), writeToken: randomB64u(32), readToken: randomB64u(32) };
        const res = await call('POST', api, { id: t.inboxId, writeHash: await tokenHash(t.writeToken), readHash: await tokenHash(t.readToken) });
        return res.status === 201 ? { ok: true, toPhone: t } : { ok: false, error: classify(res.status) };
    }

    /** Creates the feed-URL vault (one encrypted document the devices share). */
    async function createVault() {
        const v = newVaultSecrets();
        const res = await call('POST', vaultApi, { id: v.id, tokenHash: await tokenHash(v.token) });
        return res.status === 201 ? { ok: true, vault: v } : { ok: false, error: classify(res.status) };
    }

    /** Creates the inboxes on the server and returns the text for the QR code. Already paired: returns the same code again. */
    async function pair() {
        const existing = await getConfig();
        if (existing) return { ok: true, existing: true, payload: pairingPayload(existing) };
        const secrets = newInboxSecrets();
        const res = await call('POST', api, { id: secrets.inboxId, writeHash: await tokenHash(secrets.writeToken), readHash: await tokenHash(secrets.readToken) });
        if (res.status !== 201) return { ok: false, error: classify(res.status) };
        const second = await createToPhone();   // best effort: without it the phone→extension direction still works, and "Send to phone" can be switched on later
        const vault = await createVault();      // best effort as well: "Sync feeds" can be switched on later
        const cfg = { ...secrets, createdAt: now(), v: 1, ...(second.ok ? { toPhone: second.toPhone } : {}), ...(vault.ok ? { vault: vault.vault } : {}) };
        await store().set({ [SK.inboxConfig]: cfg, [SK.inboxState]: EMPTY_STATE() });
        return { ok: true, existing: false, payload: pairingPayload(cfg) };
    }

    /** Switches on "Send to phone" for an existing pairing. The QR code changes, so the phone has to scan it once more. */
    async function enableToPhone() {
        const cfg = await getConfig();
        if (!cfg) return { ok: false, error: 'not-paired' };
        if (cfg.toPhone) return { ok: true, existing: true, payload: pairingPayload(cfg) };
        const second = await createToPhone();
        if (!second.ok) return second;
        const next = { ...cfg, toPhone: second.toPhone };
        await store().set({ [SK.inboxConfig]: next });
        return { ok: true, existing: false, payload: pairingPayload(next) };
    }

    /** Switches on feed sync for an existing pairing. The QR code changes, so the phone has to scan it once more. */
    async function enableVault() {
        const cfg = await getConfig();
        if (!cfg) return { ok: false, error: 'not-paired' };
        if (cfg.vault) return { ok: true, existing: true, payload: pairingPayload(cfg) };
        const made = await createVault();
        if (!made.ok) return made;
        const next = { ...cfg, vault: made.vault };
        await store().set({ [SK.inboxConfig]: next });
        return { ok: true, existing: false, payload: pairingPayload(next) };
    }

    /**
     * Syncs the feed list (URL, title, tags; never items) through the vault.
     *   getSubs()    → the live feeds [{url,title,tags}]
     *   applyPlan(p) → makes this device match: p = { add:[{url,title,tags}], update:[…], remove:[url] }
     * Resolves { ok, added, updated, removed, uploaded } or { ok: false, error }: not-paired, not-enabled, unreadable,
     * too-large, conflict (lost the race too often), rate-limited, pairing-invalid, unreachable, error.
     */
    async function syncFeeds({ getSubs, applyPlan }) {
        const cfg = await getConfig();
        if (!cfg) return { ok: false, error: 'not-paired' };
        if (!cfg.vault) return { ok: false, error: 'not-enabled' };
        const sec = { vaultId: cfg.vault.id, encKey: cfg.encKey };
        const url = `${vaultApi}/${encodeURIComponent(cfg.vault.id)}`;
        const st = (await read(SK.feedSync))[SK.feedSync] || {};
        const subs = await getSubs();
        const local = localEntries(subs, st.base || [], now());
        const open = async (doc) => {
            if (!doc || doc.data == null) return [];
            return cleanEntries(await decryptVault(sec, { v: doc.v, data: doc.data }));
        };

        let doc;
        const first = await call('GET', url, null, cfg.vault.token);
        if (first.status !== 200 || !first.json) return { ok: false, error: classify(first.status) };
        doc = first.json;
        let merged, uploaded = false;
        for (let attempt = 0; attempt < SYNC_RETRIES; attempt++) {
            let remote;
            try { remote = await open(doc); } catch (_) { return { ok: false, error: 'unreadable' }; }
            merged = mergeEntries(local, remote, now());
            if (sameEntries(merged, remote)) break;
            let body;
            try { body = await encryptVault(sec, merged); } catch (_) { return { ok: false, error: 'too-large' }; }
            const put = await call('PUT', url, body, cfg.vault.token, { 'If-Match': String(doc.rev) });
            if (put.status === 200 && put.json) { doc = { rev: put.json.rev }; uploaded = true; break; }
            if (put.status === 409 && put.json) { doc = put.json; if (attempt === SYNC_RETRIES - 1) return { ok: false, error: 'conflict' }; continue; }
            if (put.status === 413) return { ok: false, error: 'too-large' };
            if (put.status === 429) return { ok: false, error: 'rate-limited' };
            return { ok: false, error: classify(put.status) };
        }
        const plan = planChanges(subs, merged);
        await applyPlan(plan);
        await store().set({ [SK.feedSync]: { rev: doc.rev, base: merged, lastSyncAt: now() } });
        return { ok: true, added: plan.add.length, updated: plan.update.length, removed: plan.remove.length, uploaded };
    }

    /** The QR text for an existing pairing (to show it again or to pair a second phone). Null when not paired. */
    async function pairingCode() { const c = await getConfig(); return c ? pairingPayload(c) : null; }

    /**
     * Sends one article (see articleBlocks.articleForPhone) to the phone, encrypted. Resolves { ok, blocks, truncated } or
     * { ok: false, error } with: not-paired, not-enabled (no extension→phone inbox yet), too-large, rate-limited, inbox-full,
     * pairing-invalid, unreachable, error. The article waits on the server (7 days) until the phone has saved it.
     */
    async function sendArticle(article) {
        const cfg = await getConfig();
        if (!cfg) return { ok: false, error: 'not-paired' };
        if (!cfg.toPhone) return { ok: false, error: 'not-enabled' };
        let sealed;
        try { sealed = await encryptArticle({ inboxId: cfg.toPhone.inboxId, encKey: cfg.encKey }, article); }
        catch (e) { return { ok: false, error: /too large/i.test(String(e && e.message)) ? 'too-large' : 'unreadable' }; }
        const res = await call('POST', `${api}/${encodeURIComponent(cfg.toPhone.inboxId)}/items`, sealed.envelope, cfg.toPhone.writeToken);
        if (res.status === 202) return { ok: true, blocks: sealed.blocks, truncated: sealed.truncated };
        if (res.status === 413) return { ok: false, error: 'too-large' };
        if (res.status === 429) return { ok: false, error: res.json && res.json.error === 'inbox-full' ? 'inbox-full' : 'rate-limited' };
        return { ok: false, error: classify(res.status) };
    }

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
        const sync = (await read(SK.feedSync))[SK.feedSync] || {};
        return { paired: !!cfg, toPhone: !!(cfg && cfg.toPhone), vault: !!(cfg && cfg.vault), lastSyncAt: sync.lastSyncAt || 0, createdAt: cfg ? cfg.createdAt : 0, lastPollAt: state.lastPollAt, lastError: state.lastError, pending: (await getPending()).length };
    }

    /** Deletes the inbox on the server (best effort) and every local trace of the pairing, including waiting links. */
    async function unpair() {
        const cfg = await getConfig();
        let serverDeleted = false;
        if (cfg) {
            const res = await call('DELETE', `${api}/${encodeURIComponent(cfg.inboxId)}`, null, cfg.readToken);
            serverDeleted = res.status >= 200 && res.status < 300;
            if (cfg.toPhone) await call('DELETE', `${api}/${encodeURIComponent(cfg.toPhone.inboxId)}`, null, cfg.toPhone.readToken);
            if (cfg.vault) await call('DELETE', `${vaultApi}/${encodeURIComponent(cfg.vault.id)}`, null, cfg.vault.token);
        }
        await store().remove([SK.inboxConfig, SK.inboxPending, SK.inboxState, SK.feedSync]);
        return { ok: true, serverDeleted };
    }

    return { pair, enableToPhone, enableVault, syncFeeds, sendArticle, pairingCode, poll, listPending, resolve, flushDeletes, status, unpair };
}
