// Reference implementation of the AISH phone-inbox API (see openapi.yaml).
// Zero dependencies, in-memory storage: for development, tests and as a spec to port to api.byphil.eu. Not shipped in the extension.
//
//   node inbox-api/reference-server.mjs [port]      (default 8787)
//
// The server only ever sees: an inbox id, SHA-256 hashes of two tokens, and opaque encrypted envelopes. It never logs bodies or links.

import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const LIMITS = {
    maxBody: 4096,               // create requests
    maxItemBody: 200000,         // posted items (an article for the phone: gzipped, encrypted, about 140 KB at most)
    maxItemData: 190000,         // characters of base64url ciphertext per item
    maxWaitingBytes: 8000000,    // per inbox, total characters of waiting ciphertext
    maxWaiting: 200,             // unclaimed items per inbox
    postsPerHour: 60,            // per inbox
    createsPerHourPerIp: 20,
    itemTtlMs: 30 * 24 * 3600e3, // items nobody summarized or dismissed are purged (they stay until the user deals with them)
    idleTtlMs: 30 * 24 * 3600e3, // inboxes nobody touched are purged
    maxPageSize: 100,
    maxVaultBody: 100000,        // feed-URL vault: PUT body
    maxVaultData: 80000,         // characters of base64url ciphertext per vault document
    putsPerHourPerVault: 120,
    vaultIdleTtlMs: 365 * 24 * 3600e3,
};
// Collection names in the byPhil database. The first path segment is the collection (`aish_inboxes`); the items live in
// `aish_inbox_items` and are reached through /{id}/items.
const COLLECTIONS = { inboxes: 'aish_inboxes', items: 'aish_inbox_items' };
const BASE = `/v1/projects/ai_summary_helper/${COLLECTIONS.inboxes}`;
const VAULT_BASE = '/v1/projects/ai_summary_helper/aish_vaults';
const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const B64U_RE = /^[A-Za-z0-9_-]+$/;

export function createInboxServer({ now = () => Date.now(), limits = {} } = {}) {
    const L = { ...LIMITS, ...limits };
    const inboxes = new Map();   // id → { writeHash, readHash, items:[{id,cursor,receivedAt,v,data}], seq, posts:[ts], touched }
    const creates = new Map();   // ip → [ts]
    const vaults = new Map();    // id → { tokenHash, rev, v, data, puts:[ts], touched }   (feed-URL sync: one opaque document per vault)

    const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
    const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
    const cur = (n) => String(n).padStart(12, '0');
    const recent = (arr, ms) => { const t = now() - ms; while (arr.length && arr[0] < t) arr.shift(); return arr; };

    function purge() {
        const t = now();
        for (const [id, box] of inboxes) {
            if (t - box.touched > L.idleTtlMs) { inboxes.delete(id); continue; }
            box.items = box.items.filter((it) => t - it.receivedAt <= L.itemTtlMs);
        }
        for (const [id, v] of vaults) if (t - v.touched > L.vaultIdleTtlMs) vaults.delete(id);
    }

    function send(res, status, body, headers = {}) {
        const text = body === undefined ? '' : JSON.stringify(body);
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
        res.end(text);
    }

    function readBody(req, max) {
        return new Promise((resolve) => {
            const chunks = []; let size = 0; let over = false;
            req.on('data', (c) => { size += c.length; if (size > max) { over = true; return; } chunks.push(c); });
            req.on('end', () => {
                if (over) return resolve({ tooLarge: true });
                if (!chunks.length) return resolve({ json: null });
                try { resolve({ json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch (_) { resolve({ bad: true }); }
            });
            req.on('error', () => resolve({ bad: true }));
        });
    }

    /** Looks up the inbox and checks the bearer token against the stored hash of the given kind ('write' | 'read'). */
    function auth(req, res, id, kind) {
        const box = ID_RE.test(id) ? inboxes.get(id) : null;
        if (!box) { send(res, 404, { error: 'not-found' }); return null; }
        const m = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
        if (!m) { send(res, 401, { error: 'unauthorized' }); return null; }
        if (!same(sha(m[1]), kind === 'write' ? box.writeHash : box.readHash)) { send(res, 403, { error: 'forbidden' }); return null; }
        box.touched = now();
        return box;
    }


    /** Vault routes. One document per vault; PUT needs If-Match <rev> and answers 409 with the current document on a lost race. */
    async function vaultHandler(req, res, url) {
        const rest = url.pathname.slice(VAULT_BASE.length).split('/').filter(Boolean);
        const method = req.method;
        if (rest.length === 0 && method === 'POST') {
            const ip = req.socket.remoteAddress || '?';
            const list = recent(creates.get(ip) || [], 3600e3); creates.set(ip, list);
            if (list.length >= L.createsPerHourPerIp) return send(res, 429, { error: 'rate-limited' }, { 'Retry-After': '3600' });
            const b = await readBody(req, L.maxBody);
            if (b.tooLarge) return send(res, 413, { error: 'too-large' });
            const j = b.json;
            if (!j || !ID_RE.test(j.id) || !HASH_RE.test(j.tokenHash)) return send(res, 400, { error: 'bad-request' });
            if (vaults.has(j.id)) return send(res, 409, { error: 'exists' });
            list.push(now());
            vaults.set(j.id, { tokenHash: j.tokenHash, rev: 0, v: 1, data: '', puts: [], touched: now() });
            return send(res, 201, { id: j.id, rev: 0 });
        }
        const id = rest[0];
        const vault = ID_RE.test(id || '') ? vaults.get(id) : null;
        if (!vault || rest.length !== 1) return send(res, 404, { error: 'not-found' });
        const m = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
        if (!m) return send(res, 401, { error: 'unauthorized' });
        if (!same(sha(m[1]), vault.tokenHash)) return send(res, 403, { error: 'forbidden' });
        vault.touched = now();
        const doc = () => ({ rev: vault.rev, v: vault.v, data: vault.data || null });
        if (method === 'GET') return send(res, 200, doc());
        if (method === 'DELETE') { vaults.delete(id); return send(res, 204); }
        if (method === 'PUT') {
            const im = /^"?(\d{1,12})"?$/.exec(req.headers['if-match'] || '');
            if (!im) return send(res, 428, { error: 'if-match-required' });
            const b = await readBody(req, L.maxVaultBody);
            if (b.tooLarge) return send(res, 413, { error: 'too-large' });
            const j = b.json;
            if (!j || j.v !== 1 || typeof j.data !== 'string' || !B64U_RE.test(j.data)) return send(res, 400, { error: 'bad-request' });
            if (j.data.length > L.maxVaultData) return send(res, 413, { error: 'too-large' });
            if (recent(vault.puts, 3600e3).length >= L.putsPerHourPerVault) return send(res, 429, { error: 'rate-limited' }, { 'Retry-After': '600' });
            vault.puts.push(now());
            if (Number(im[1]) !== vault.rev) return send(res, 409, { error: 'conflict', ...doc() });
            vault.rev += 1; vault.v = 1; vault.data = j.data;
            return send(res, 200, { rev: vault.rev });
        }
        return send(res, 404, { error: 'not-found' });
    }

    async function handler(req, res) {
        try {
            purge();
            const url = new URL(req.url, 'http://x');
            if (url.pathname === VAULT_BASE || url.pathname.startsWith(VAULT_BASE + '/')) return await vaultHandler(req, res, url);
            if (!url.pathname.startsWith(BASE)) return send(res, 404, { error: 'not-found' });
            const rest = url.pathname.slice(BASE.length).split('/').filter(Boolean);
            const method = req.method;

            // POST /aish_inboxes
            if (rest.length === 0 && method === 'POST') {
                const ip = req.socket.remoteAddress || '?';
                const list = recent(creates.get(ip) || [], 3600e3); creates.set(ip, list);
                if (list.length >= L.createsPerHourPerIp) return send(res, 429, { error: 'rate-limited' }, { 'Retry-After': '3600' });
                const b = await readBody(req, L.maxBody);
                if (b.tooLarge) return send(res, 413, { error: 'too-large' });
                const j = b.json;
                if (!j || !ID_RE.test(j.id) || !HASH_RE.test(j.writeHash) || !HASH_RE.test(j.readHash)) return send(res, 400, { error: 'bad-request' });
                if (inboxes.has(j.id)) return send(res, 409, { error: 'exists' });
                list.push(now());
                inboxes.set(j.id, { writeHash: j.writeHash, readHash: j.readHash, items: [], seq: 0, posts: [], touched: now() });
                return send(res, 201, { id: j.id });
            }

            const id = rest[0];
            // DELETE /aish_inboxes/{id}
            if (rest.length === 1 && method === 'DELETE') {
                if (!auth(req, res, id, 'read')) return;
                inboxes.delete(id);
                return send(res, 204);
            }
            // POST /aish_inboxes/{id}/items   (phone)
            if (rest.length === 2 && rest[1] === 'items' && method === 'POST') {
                const box = auth(req, res, id, 'write'); if (!box) return;
                const b = await readBody(req, L.maxItemBody);
                if (b.tooLarge) return send(res, 413, { error: 'too-large' });
                const j = b.json;
                if (!j || (j.v !== 1 && j.v !== 2) || typeof j.data !== 'string' || !B64U_RE.test(j.data)) return send(res, 400, { error: 'bad-request' });
                if (j.data.length > L.maxItemData) return send(res, 413, { error: 'too-large' });
                if (box.items.length >= L.maxWaiting) return send(res, 429, { error: 'inbox-full' }, { 'Retry-After': '3600' });
                if (box.items.reduce((n, it) => n + it.data.length, 0) + j.data.length > L.maxWaitingBytes) return send(res, 429, { error: 'inbox-full' }, { 'Retry-After': '3600' });
                if (recent(box.posts, 3600e3).length >= L.postsPerHour) return send(res, 429, { error: 'rate-limited' }, { 'Retry-After': '600' });
                box.posts.push(now());
                const item = { id: crypto.randomBytes(8).toString('hex'), cursor: cur(++box.seq), receivedAt: now(), v: j.v, data: j.data };
                box.items.push(item);
                return send(res, 202, { id: item.id });
            }
            // GET /aish_inboxes/{id}/items?after=&limit=   (extension)
            if (rest.length === 2 && rest[1] === 'items' && method === 'GET') {
                const box = auth(req, res, id, 'read'); if (!box) return;
                const after = url.searchParams.get('after') || '';
                const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), L.maxPageSize);
                const all = box.items.filter((it) => it.cursor > after);
                return send(res, 200, { items: all.slice(0, limit), hasMore: all.length > limit });
            }
            // DELETE /aish_inboxes/{id}/items/{itemId}   (extension, once the user summarized or dismissed the link)
            if (rest.length === 3 && rest[1] === 'items' && method === 'DELETE') {
                const box = auth(req, res, id, 'read'); if (!box) return;
                const before = box.items.length;
                box.items = box.items.filter((it) => it.id !== rest[2]);
                return send(res, before === box.items.length ? 404 : 204);
            }
            // POST /aish_inboxes/{id}/ack   (deprecated: the clients delete per item now)
            if (rest.length === 2 && rest[1] === 'ack' && method === 'POST') {
                const box = auth(req, res, id, 'read'); if (!box) return;
                const b = await readBody(req, L.maxBody);
                if (!b.json || typeof b.json.upTo !== 'string') return send(res, 400, { error: 'bad-request' });
                box.items = box.items.filter((it) => it.cursor > b.json.upTo);
                return send(res, 200, { ok: true });
            }
            return send(res, 404, { error: 'not-found' });
        } catch (_) {
            return send(res, 500, { error: 'server-error' });
        }
    }

    const server = http.createServer(handler);
    server.vaults = vaults; server.inboxes = inboxes;   // exposed for tests only
    return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const port = Number(process.argv[2]) || 8787;
    createInboxServer().listen(port, '127.0.0.1', () => console.log(`AISH inbox reference server on http://127.0.0.1:${port}${BASE}`));
}
