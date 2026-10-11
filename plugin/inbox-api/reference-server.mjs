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
    maxBody: 4096,               // bytes per posted item
    maxWaiting: 200,             // unclaimed items per inbox
    postsPerHour: 60,            // per inbox
    createsPerHourPerIp: 20,
    itemTtlMs: 7 * 24 * 3600e3,  // unclaimed items are purged
    idleTtlMs: 30 * 24 * 3600e3, // inboxes nobody touched are purged
    maxPageSize: 100,
};
const BASE = '/v1/projects/ai_summary_helper/inboxes';
const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const B64U_RE = /^[A-Za-z0-9_-]+$/;

export function createInboxServer({ now = () => Date.now(), limits = {} } = {}) {
    const L = { ...LIMITS, ...limits };
    const inboxes = new Map();   // id → { writeHash, readHash, items:[{id,cursor,receivedAt,v,data}], seq, posts:[ts], touched }
    const creates = new Map();   // ip → [ts]

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

    async function handler(req, res) {
        try {
            purge();
            const url = new URL(req.url, 'http://x');
            if (!url.pathname.startsWith(BASE)) return send(res, 404, { error: 'not-found' });
            const rest = url.pathname.slice(BASE.length).split('/').filter(Boolean);
            const method = req.method;

            // POST /inboxes
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
            // DELETE /inboxes/{id}
            if (rest.length === 1 && method === 'DELETE') {
                if (!auth(req, res, id, 'read')) return;
                inboxes.delete(id);
                return send(res, 204);
            }
            // POST /inboxes/{id}/items   (phone)
            if (rest.length === 2 && rest[1] === 'items' && method === 'POST') {
                const box = auth(req, res, id, 'write'); if (!box) return;
                const b = await readBody(req, L.maxBody);
                if (b.tooLarge) return send(res, 413, { error: 'too-large' });
                const j = b.json;
                if (!j || j.v !== 1 || typeof j.data !== 'string' || !B64U_RE.test(j.data)) return send(res, 400, { error: 'bad-request' });
                if (box.items.length >= L.maxWaiting) return send(res, 429, { error: 'inbox-full' }, { 'Retry-After': '3600' });
                if (recent(box.posts, 3600e3).length >= L.postsPerHour) return send(res, 429, { error: 'rate-limited' }, { 'Retry-After': '600' });
                box.posts.push(now());
                const item = { id: crypto.randomBytes(8).toString('hex'), cursor: cur(++box.seq), receivedAt: now(), v: 1, data: j.data };
                box.items.push(item);
                return send(res, 202, { id: item.id });
            }
            // GET /inboxes/{id}/items?after=&limit=   (extension)
            if (rest.length === 2 && rest[1] === 'items' && method === 'GET') {
                const box = auth(req, res, id, 'read'); if (!box) return;
                const after = url.searchParams.get('after') || '';
                const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), L.maxPageSize);
                const all = box.items.filter((it) => it.cursor > after);
                return send(res, 200, { items: all.slice(0, limit), hasMore: all.length > limit });
            }
            // POST /inboxes/{id}/ack   (extension)
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
    server.inboxes = inboxes;   // exposed for tests only
    return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const port = Number(process.argv[2]) || 8787;
    createInboxServer().listen(port, '127.0.0.1', () => console.log(`AISH inbox reference server on http://127.0.0.1:${port}${BASE}`));
}
