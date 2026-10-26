// mcp/src/follower.js — a copy of aish-mcp that found the port already owned by another copy.
// It joins that copy as a peer and forwards its calls through it (see relayServer.js).
import WebSocket from 'ws';
import { PROTOCOL_VERSION, NOT_RUNNING } from './relayServer.js';

const CALL_TIMEOUT_MS = 20000;

/** opts.onLost: called once when the owner goes away (this copy should then try to take the port over). */
export function createFollower({ getToken, port = 47615, log = () => {}, onDefs = () => {}, onLost = () => {} }) {
    let ws = null;
    let connected = false;       // is the extension connected to the owner?
    let defs = null;
    let lost = false;
    let pingTimer = null;
    const pending = new Map();
    let nextId = 1;

    function fail(reason) {
        if (lost) return;
        lost = true;
        connected = false;
        if (pingTimer) clearInterval(pingTimer);
        for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error(NOT_RUNNING)); }
        pending.clear();
        log(`lost the relay owner (${reason})`);
        onLost();
    }

    function start() {
        return new Promise((resolve, reject) => {
            let ready = false;
            ws = new WebSocket(`ws://127.0.0.1:${port}`);   // no Origin header: identifies us as a local process, not a page
            ws.on('open', () => { ws.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'peer-hello', token: getToken() })); });
            ws.on('message', (raw) => {
                let msg; try { msg = JSON.parse(raw.toString('utf8')); } catch (_) { return; }
                if (msg.type === 'status') {
                    connected = !!msg.connected;
                    if (msg.defs) { defs = msg.defs; onDefs(defs); }
                    if (!ready) {
                        ready = true;
                        pingTimer = setInterval(() => { try { ws.send(JSON.stringify({ type: 'ping' })); } catch (_) { /* closing */ } }, 20000);
                        resolve();
                    }
                    return;
                }
                if (msg.type === 'result' && pending.has(msg.id)) {
                    const p = pending.get(msg.id); pending.delete(msg.id); clearTimeout(p.timer);
                    if (msg.ok) p.resolve(msg.data);
                    else p.reject(Object.assign(new Error((msg.error && msg.error.message) || 'Tool call failed'), { code: msg.error && msg.error.code }));
                }
            });
            ws.on('close', (code, reason) => {
                if (!ready) { reject(new Error(`owner refused the connection (${code} ${reason || ''})`.trim())); return; }
                fail(`closed ${code}`);
            });
            ws.on('error', (e) => { if (!ready) reject(e); });
        });
    }

    function stop() { lost = true; if (pingTimer) clearInterval(pingTimer); try { ws && ws.close(); } catch (_) { /* gone */ } }

    function call(tool, args) {
        if (!ws || ws.readyState !== 1 || lost) return Promise.reject(new Error(NOT_RUNNING));
        if (!connected) return Promise.reject(new Error(NOT_RUNNING));
        const id = String(nextId++);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Tool "${tool}" timed out`)); }, CALL_TIMEOUT_MS);
            pending.set(id, { resolve, reject, timer });
            ws.send(JSON.stringify({ type: 'call', id, tool, args: args || {} }));
        });
    }

    return { role: 'follower', start, stop, call, isExtensionConnected: () => connected && !lost, defs: () => defs };
}
