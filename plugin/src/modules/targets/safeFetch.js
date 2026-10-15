// safeFetch.js — the only fetch an adapter ever gets. It cannot reach another origin than the connection's baseUrl,
// never sends the browser's cookies, never follows a redirect and bounds time and size.
//
// Logging: host and status only. Never headers, bodies, tokens or full URLs.
import { TargetError, kindOfStatus } from './targetError.js';

export const TIMEOUT_MS = 30000;
export const MAX_BYTES = 5 * 1024 * 1024;

/** 10/8, 172.16/12, 192.168/16, 127/8, localhost, *.local, ::1 */
export function isPrivateHost(host) {
    const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (h === 'localhost' || h === '::1' || h.endsWith('.local')) return true;
    const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function retryAfterMs(headers, now) {
    const v = headers && typeof headers.get === 'function' ? headers.get('retry-after') : '';
    if (!v) return 0;
    if (/^\d+$/.test(v.trim())) return Math.min(Number(v) * 1000, 24 * 3600e3);
    const t = Date.parse(v);
    return isNaN(t) ? 0 : Math.max(0, Math.min(t - now(), 24 * 3600e3));
}

const byteLength = (b) => (b == null ? 0 : typeof b === 'string' ? new TextEncoder().encode(b).length : (b.byteLength !== undefined ? b.byteLength : (b.size || 0)));

/**
 * @param {{ baseUrl:string, allowInsecureLan?:boolean }} connection
 * @param {{ fetchFn?:Function, timeoutMs?:number, maxBytes?:number, now?:()=>number, log?:Function }} [opts]
 * @returns {(url:string, init?:object) => Promise<{status:number, ok:true, headers:Headers, bytes:Uint8Array, text:()=>string, json:()=>any}>}
 *   Resolves for 2xx only; every other outcome throws a TargetError.
 */
export function createSafeFetch(connection, { fetchFn, timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES, now = () => Date.now(), log = () => {} } = {}) {
    let base;
    try { base = new URL(connection && connection.baseUrl); } catch (_) { base = null; }
    return async function safeFetch(url, init = {}) {
        if (!base) throw new TargetError({ kind: 'permanent', message: 'The connection has no valid address.' });
        let u;
        try { u = new URL(url, base); } catch (_) { throw new TargetError({ kind: 'permanent', message: 'Invalid URL.' }); }
        if (u.origin !== base.origin) throw new TargetError({ kind: 'permanent', message: 'Only the connection\'s own server is allowed.' });
        if (u.protocol !== 'https:') {
            const lan = u.protocol === 'http:' && connection.allowInsecureLan === true && isPrivateHost(u.hostname);
            if (!lan) throw new TargetError({ kind: 'permanent', message: 'HTTPS is required (plain HTTP only for a private network address that was allowed).' });
        }
        if (byteLength(init.body) > maxBytes) throw new TargetError({ kind: 'permanent', message: 'The request is larger than the 5 MB limit.' });

        const ctrl = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
        try {
            let res;
            try {
                res = await (fetchFn || globalThis.fetch)(u.href, { ...init, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: ctrl.signal });
            } catch (e) {
                log(`${u.host} ${timedOut ? 'timeout' : 'network error'}`);
                throw new TargetError({ kind: 'retry', message: timedOut ? 'The server did not answer in time.' : 'The server is not reachable.' });
            }
            log(`${u.host} ${res.status}`);
            if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) throw new TargetError({ kind: 'permanent', message: 'The server redirected the request.', status: res.status });
            if (!res.ok) throw new TargetError({ kind: kindOfStatus(res.status), message: `The server answered ${res.status}.`, status: res.status, retryAfterMs: retryAfterMs(res.headers, now) });
            const declared = Number(res.headers && res.headers.get && res.headers.get('content-length'));
            if (declared > maxBytes) throw new TargetError({ kind: 'permanent', message: 'The answer is larger than the 5 MB limit.', status: res.status });
            let bytes;
            try {
                if (res.body && res.body.getReader) {
                    const reader = res.body.getReader(), parts = []; let size = 0;
                    for (;;) {
                        const { value, done } = await reader.read();
                        if (done) break;
                        size += value.byteLength;
                        if (size > maxBytes) { ctrl.abort(); throw new TargetError({ kind: 'permanent', message: 'The answer is larger than the 5 MB limit.', status: res.status }); }
                        parts.push(value);
                    }
                    bytes = new Uint8Array(size); let o = 0; for (const p of parts) { bytes.set(p, o); o += p.byteLength; }
                } else {
                    bytes = new Uint8Array(await res.arrayBuffer());
                    if (bytes.byteLength > maxBytes) throw new TargetError({ kind: 'permanent', message: 'The answer is larger than the 5 MB limit.', status: res.status });
                }
            } catch (e) {
                if (e instanceof TargetError) throw e;
                throw new TargetError({ kind: 'retry', message: timedOut ? 'The server did not answer in time.' : 'The connection broke while reading the answer.' });
            }
            return { status: res.status, ok: true, headers: res.headers, bytes, text: () => new TextDecoder().decode(bytes), json: () => JSON.parse(new TextDecoder().decode(bytes)) };
        } finally {
            clearTimeout(timer);
        }
    };
}
