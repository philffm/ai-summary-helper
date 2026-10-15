// Login-token helpers for the summarize paths.
// The account token is a JWT that expires. An expired token sent to the API is treated as "not signed in", so a Pro user
// would see the free-tier "daily limit / upgrade" message or a bare 401. These helpers let callers spot the expiry
// before the request and tell the user what to do: sign in again. refreshSession() renews a token that is about to expire.

import { SK } from './storageKeys.js';

export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Please sign in again under Settings › Account.';
export const SIGN_IN_HINT = ' Already a Pro user? Sign in again under Settings › Account.';

/** Expiry of a readable JWT in ms since the epoch, or null when the token has no readable `exp`. */
export function tokenExpiresAt(token) {
    if (!token || typeof token !== 'string') return null;
    try {
        let b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        if (b64.length % 4) b64 += '='.repeat(4 - (b64.length % 4));
        const payload = JSON.parse(decodeURIComponent(atob(b64).split('').map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')));
        return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
    } catch (_) { return null; }
}

/** True only when the token is a readable JWT whose `exp` is in the past. Unreadable tokens are not reported as expired. */
export function isTokenExpired(token, now = Date.now()) {
    const exp = tokenExpiresAt(token);
    return exp !== null && exp <= now;
}

export const REFRESH_WINDOW_MS = 7 * 24 * 3600e3;   // swap the token when it has less than this left
const RETRY_AFTER_MS = 10 * 60e3;                    // after a failed try, do not ask again for a while

/** Still valid, but close to its end: the moment to swap it for a fresh one. */
export function needsRefresh(token, now = Date.now(), windowMs = REFRESH_WINDOW_MS) {
    const exp = tokenExpiresAt(token);
    return exp !== null && exp > now && exp - now < windowMs;
}

let inflight = null, lastFail = 0;

/**
 * Silent sign-in renewal: when the stored login token is close to expiry, POST /v1/auth/refresh and store the new token (and the
 * user record) so the person is not sent through the e-mail code again. Never throws and never signs anyone out: on any failure the
 * old token stays and the normal "session expired" path applies once it really runs out.
 * @returns {Promise<'refreshed'|'skipped'|'rejected'|'error'>}
 */
export function refreshSession({ apiBase, storage = globalThis.chrome && chrome.storage && chrome.storage.local, fetchFn = globalThis.fetch, now = Date.now } = {}) {
    if (inflight) return inflight;
    const run = (async () => {
        try {
            if (!apiBase || !storage || typeof fetchFn !== 'function') return 'skipped';
            if (now() - lastFail < RETRY_AFTER_MS) return 'skipped';
            const stored = await storage.get([SK.token]);
            const token = stored && stored[SK.token];
            if (!needsRefresh(token, now())) return 'skipped';
            const res = await fetchFn(`${apiBase}/v1/auth/refresh`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
            if (res.status === 401 || res.status === 403) { lastFail = now(); return 'rejected'; }
            if (!res.ok) { lastFail = now(); return 'error'; }
            const body = await res.json();
            if (!body || !body.success || typeof body.token !== 'string' || !body.token) { lastFail = now(); return 'error'; }
            const write = { [SK.token]: body.token };
            if (body.record && typeof body.record === 'object' && body.record.id) write[SK.user] = body.record;
            if (body.record && body.record.license_key) write[SK.licenseKey] = body.record.license_key;
            await storage.set(write);
            return 'refreshed';
        } catch (_) {
            lastFail = now();
            return 'error';
        }
    })();
    // cleared from outside: an early return would otherwise run before `inflight` is assigned and leave a settled promise behind
    inflight = run;
    run.then(() => { if (inflight === run) inflight = null; });
    return run;
}

/** Test hook: forget the failure back-off. */
export function _resetRefreshState() { inflight = null; lastFail = 0; }
