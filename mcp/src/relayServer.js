// mcp/src/relayServer.js — the WebSocket side the AISH extension connects OUTWARD to.
//
// This relay never reaches out to the extension: Chrome extensions can't accept inbound
// connections, so the extension's background worker opens this socket. The relay stores no
// library data and logs nothing of what it forwards (PRD §4.4) — just timestamp/tool/ok/duration.
//
// One port, one owner. MCP apps often start several copies of aish-mcp (Claude Desktop starts
// one per chat surface), so the first copy owns the port and the others join it as PEERS
// (follower.js) and forward their calls through it, instead of failing with EADDRINUSE.
import { WebSocketServer } from 'ws';
import { tokensMatch, createRateGuard } from './pairing.js';

export const PROTOCOL_VERSION = 1;
export const NOT_RUNNING = 'AISH is not running. Open your browser with AISH, then try again.';
const CALL_TIMEOUT_MS = 15000;
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
const EXTENSION_ORIGINS = [/^chrome-extension:\/\//, /^moz-extension:\/\//];

/**
 * @param {object} opts
 *  - getToken: () => string|null  current pairing token (re-read live so `aish-mcp reset` takes effect without a restart)
 *  - port: number
 *  - log: (line) => void
 *  - onDefs: (defs) => void       called when the extension declares (new) tools/resources/prompts
 */
export function createRelay({ getToken, port = 47615, log = () => {}, onDefs = () => {} }) {
    let wss = null;
    let conn = null;                 // the one connected extension socket
    let defs = null;                 // { tools, resources, prompts, brand } from the extension's last hello
    const peers = new Set();         // other aish-mcp copies sharing this relay
    const pending = new Map();       // call id -> { resolve, reject, timer, tool, started, ws }
    const rateGuard = createRateGuard();
    let nextId = 1;

    const isExtensionConnected = () => !!(conn && conn.readyState === 1);
    const sendTo = (ws, obj) => { try { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (_) { /* closing */ } };
    const broadcastStatus = () => { for (const p of peers) sendTo(p, { type: 'status', connected: isExtensionConnected(), defs }); };
    const closeWithCode = (ws, code, reason) => { try { ws.close(code, reason); } catch (_) { /* already closing */ } };

    function checkToken(ws, token) {
        if (rateGuard.tripped()) { closeWithCode(ws, 4003, 'too-many-attempts'); return false; }
        const expected = getToken();
        if (!expected || !tokensMatch(token, expected)) { rateGuard.recordFailure(); closeWithCode(ws, 4004, 'bad-token'); return false; }
        return true;
    }

    function attach(ws, req) {
        const origin = req.headers.origin;
        const fromExtension = typeof origin === 'string' && EXTENSION_ORIGINS.some((re) => re.test(origin));
        let role = null;   // 'extension' | 'peer'
        const handshakeTimer = setTimeout(() => { if (!role) closeWithCode(ws, 4002, 'handshake-timeout'); }, 5000);

        ws.on('message', (raw) => {
            if (raw.length > MAX_MESSAGE_BYTES) return closeWithCode(ws, 1009, 'message-too-large');
            let msg;
            try { msg = JSON.parse(raw.toString('utf8')); } catch (_) { return; }

            if (!role) {
                if (msg.v !== PROTOCOL_VERSION) return closeWithCode(ws, 4000, 'bad-hello');
                if (msg.type === 'hello' && fromExtension) {
                    if (!checkToken(ws, msg.token)) return;
                    if (isExtensionConnected() && conn !== ws) return closeWithCode(ws, 4001, 'already-connected');
                    role = 'extension'; clearTimeout(handshakeTimer);
                    conn = ws;
                    defs = { tools: msg.tools || [], resources: msg.resources || [], prompts: msg.prompts || [], brand: msg.brand || null };
                    log(`${new Date().toISOString()} extension connected (v${msg.extVersion || '?'}, ${defs.tools.length} tools)`);
                    onDefs(defs);
                    broadcastStatus();
                    return;
                }
                // Peers are local processes, never browser pages: a page's WebSocket always carries its Origin.
                if (msg.type === 'peer-hello' && !origin) {
                    if (!checkToken(ws, msg.token)) return;
                    role = 'peer'; clearTimeout(handshakeTimer);
                    peers.add(ws);
                    sendTo(ws, { type: 'status', connected: isExtensionConnected(), defs });
                    return;
                }
                return closeWithCode(ws, 4000, 'bad-hello');
            }

            if (msg.type === 'ping') return sendTo(ws, { type: 'pong' });
            if (msg.type === 'pong') return;

            if (role === 'extension' && msg.type === 'result' && pending.has(msg.id)) {
                const p = pending.get(msg.id);
                pending.delete(msg.id);
                clearTimeout(p.timer);
                log(`${new Date().toISOString()} ${p.tool} ${msg.ok ? 'ok' : 'error'} ${Date.now() - p.started}ms`);
                if (msg.ok) p.resolve(msg.data);
                else p.reject(Object.assign(new Error((msg.error && msg.error.message) || 'Tool call failed'), { code: msg.error && msg.error.code }));
                return;
            }

            if (role === 'peer' && msg.type === 'call') {
                call(msg.tool, msg.args)
                    .then((data) => sendTo(ws, { type: 'result', id: msg.id, ok: true, data }))
                    .catch((e) => sendTo(ws, { type: 'result', id: msg.id, ok: false, error: { code: e.code || 'error', message: e.message } }));
            }
        });

        ws.on('close', () => {
            clearTimeout(handshakeTimer);
            peers.delete(ws);
            if (conn === ws) {
                conn = null;
                log(`${new Date().toISOString()} extension disconnected`);
                for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(new Error(NOT_RUNNING)); pending.delete(id); }
                broadcastStatus();
            }
        });
        ws.on('error', () => { try { ws.terminate(); } catch (_) { /* already gone */ } });
    }

    function start() {
        return new Promise((resolve, reject) => {
            const server = new WebSocketServer({
                host: '127.0.0.1', // S1: never 0.0.0.0 — no LAN exposure
                port,
                maxPayload: MAX_MESSAGE_BYTES,
                // S2: a browser page always sends its Origin, so only the extension's own origin (or a local process
                // with no Origin at all, i.e. another aish-mcp) may even upgrade. The token is checked on the first message.
                verifyClient: (info, cb) => {
                    const o = info.origin;
                    cb(!o || EXTENSION_ORIGINS.some((re) => re.test(o)));
                },
            });
            const onError = (e) => { server.removeListener('listening', onListening); try { server.close(); } catch (_) { /* never opened */ } reject(e); };
            const onListening = () => {
                server.removeListener('error', onError);
                server.on('error', (e) => log(`relay error: ${e && e.message}`));
                server.on('connection', attach);
                wss = server;
                resolve();
            };
            server.once('error', onError);
            server.once('listening', onListening);
        });
    }

    function stop() {
        for (const [, p] of pending) clearTimeout(p.timer);
        pending.clear();
        if (wss) { for (const client of wss.clients) { try { client.terminate(); } catch (_) { /* gone */ } } wss.close(); wss = null; }
        conn = null;
        peers.clear();
    }

    /** Forwards one tool call to the extension. Rejects immediately if it isn't connected. */
    function call(tool, args) {
        if (!isExtensionConnected()) return Promise.reject(new Error(NOT_RUNNING));
        const id = String(nextId++);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`Tool "${tool}" timed out after ${CALL_TIMEOUT_MS / 1000}s`));
            }, CALL_TIMEOUT_MS);
            pending.set(id, { resolve, reject, timer, tool, started: Date.now() });
            sendTo(conn, { id, type: 'call', tool, args: args || {} });
        });
    }

    return { role: 'owner', start, stop, call, isExtensionConnected, defs: () => defs };
}
