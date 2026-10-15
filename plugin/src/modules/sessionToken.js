// Login-token helpers for the summarize paths.
// The account token is a JWT that expires. An expired token sent to the API is treated as "not signed in", so a Pro user
// would see the free-tier "daily limit / upgrade" message or a bare 401. These helpers let callers spot the expiry
// before the request and tell the user what to do: sign in again.

export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Please sign in again under Settings › Account.';
export const SIGN_IN_HINT = ' Already a Pro user? Sign in again under Settings › Account.';

/** True only when the token is a readable JWT whose `exp` is in the past. Unreadable tokens are not reported as expired. */
export function isTokenExpired(token, now = Date.now()) {
    if (!token || typeof token !== 'string') return false;
    try {
        let b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        if (b64.length % 4) b64 += '='.repeat(4 - (b64.length % 4));
        const payload = JSON.parse(decodeURIComponent(atob(b64).split('').map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')));
        return typeof payload.exp === 'number' && payload.exp * 1000 <= now;
    } catch (_) { return false; }
}
