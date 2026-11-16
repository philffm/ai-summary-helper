// bg/checkoutClaim.js — the Support Pass thank-you page (AISH-037 B). Classic script, loaded by background.js
// (importScripts on Chrome/Android, listed in the Firefox/iOS manifests). The loader on our own site sends the Stripe
// session id from /thanks?session_id=…; this asks POST /v1/auth/claim-checkout and applies the answer:
//   signed_in      → store the new login (token + record), like a code sign-in
//   active         → refresh the stored record (the pass is on the signed-in account)
//   confirm        → nothing stored; the page asks “add it to the signed-in account, or switch?”
//   code_required  → ask for the e-mail code for that address, so the popup opens at the code step
//   pending        → Stripe is still confirming; the loader asks again
// The session id and tokens are never logged.
/* global SK */
/* exported claimCheckout, CHECKOUT_SESSION_RE */

const CHECKOUT_SESSION_RE = /^cs_(live|test)_[A-Za-z0-9]{10,250}$/;

function checkoutTokenExpired(token, now) {
    try {
        let b64 = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        if (b64.length % 4) b64 += '='.repeat(4 - (b64.length % 4));
        const exp = JSON.parse(atob(b64)).exp;
        return typeof exp === 'number' && exp * 1000 <= now;
    } catch (_) { return false; }
}

/**
 * @param {{ sessionId: string, confirm?: 'signed_in'|'switch', local?: object, sync?: object, fetchFn?: Function,
 *           apiBase?: string, now?: () => number }} o
 * @returns {Promise<{ state: string, email?: string, account?: string, code?: string }>}
 */
async function claimCheckout({ sessionId, confirm = null, local, sync, fetchFn, apiBase = 'https://api.byphil.eu', now = Date.now }) {
    local = local || chrome.storage.local;
    sync = sync || chrome.storage.sync;
    fetchFn = fetchFn || ((...a) => fetch(...a));
    if (!CHECKOUT_SESSION_RE.test(String(sessionId || ''))) return { state: 'error', code: 'bad_session' };
    if (confirm !== null && confirm !== 'signed_in' && confirm !== 'switch') return { state: 'error', code: 'bad_confirm' };

    const stored = await local.get([SK.token]);
    let token = stored && stored[SK.token];
    if (token && checkoutTokenExpired(token, now())) token = null;
    const headers = { 'Content-Type': 'application/json' };
    if (token && confirm !== 'switch') headers.Authorization = `Bearer ${token}`;

    let res, body = {};
    try {
        res = await fetchFn(`${apiBase}/v1/auth/claim-checkout`, { method: 'POST', headers, body: JSON.stringify({ session_id: sessionId, ...(confirm ? { confirm } : {}) }) });
        body = await res.json().catch(() => ({}));
    } catch (_) { return { state: 'error', code: 'network' }; }
    if (!res.ok || !body.success) return { state: body.code === 'not_paid' ? 'pending' : 'error', code: body.code || `http_${res.status}` };

    const record = body.record && typeof body.record === 'object' ? body.record : null;
    const license = record && typeof record.license_key === 'string' && record.license_key ? { [SK.licenseKey]: record.license_key } : {};

    if (body.state === 'signed_in' && typeof body.token === 'string' && record) {
        await local.set({ [SK.token]: body.token, [SK.user]: record, ...license, [SK.otpId]: null, [SK.otpEmail]: null, [SK.otpExpiresAt]: null, [SK.otpRequestedAt]: null });
        // Signed in: the byPhil cloud is the default, unless an own API already works (same rule as a code sign-in).
        try {
            const s = await sync.get(['connectionMode', 'activeService']);
            const l = await local.get([SK.servicesConfig]);
            const cfg = ((l && l[SK.servicesConfig]) || {})[s.activeService] || {};
            const ownApi = s.connectionMode === 'local' && !!(cfg.apiKey || s.activeService === 'ollama' || (s.activeService === 'custom' && cfg.endpoint));
            if (!ownApi && s.connectionMode !== 'cloud') await sync.set({ connectionMode: 'cloud' });
        } catch (_) { /* the default applies anyway */ }
        return { state: 'signed_in', email: record.email };
    }
    if (body.state === 'active' && record) {
        await local.set({ [SK.user]: record, ...license });
        return { state: 'active', email: record.email };
    }
    if (body.state === 'confirm') return { state: 'confirm', email: body.paid_email, account: body.account_email };
    if (body.state === 'code_required' && typeof body.email === 'string') {
        // The pass is already on that account; one e-mail code signs this browser in (switching accounts signs out first).
        if (confirm === 'switch') await local.set({ [SK.token]: null, [SK.user]: null });
        const requestedAt = now();
        try {
            const r = await fetchFn(`${apiBase}/v1/auth/request-otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: body.email }) });
            const o = await r.json().catch(() => ({}));
            if (r.ok && o.otpId) {
                const exp = Date.parse(o.otpExpiresAt);
                await local.set({ [SK.otpId]: o.otpId, [SK.otpEmail]: body.email,
                    [SK.otpExpiresAt]: new Date(Number.isFinite(exp) ? exp : requestedAt + 5 * 60e3).toISOString(),
                    [SK.otpRequestedAt]: new Date(requestedAt).toISOString() });
                return { state: 'code_required', email: body.email };
            }
        } catch (_) { /* fall through: the popup asks for the e-mail itself */ }
        return { state: 'code_required', email: body.email, code: 'code_not_sent' };
    }
    return { state: 'error', code: 'unexpected' };
}
