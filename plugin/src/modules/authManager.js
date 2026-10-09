import { SK } from './storageKeys.js';
import { escapeHtml } from './textUtils.js';
// authManager.js - Handles Authentication flow via api.byphil.eu proxy
//
// This is the SINGLE reusable login module for the extension. Historically
// the Settings screen and the main-screen "onboarding" mask each had their
// own, slightly different, email/OTP login implementation. They're merged
// here: all the actual logic (requesting a code, verifying it, token
// expiry checks, OTP expiry countdown, logout, ...) lives in one place —
// modeled on the more complete Settings-screen version — and each UI
// surface just registers the DOM elements it has via `registerAuthView`.
// Every registered view is kept in sync whenever auth state changes, so the
// Settings panel and the onboarding mask never drift apart.
import StorageManager from './storageManager.js';
import { T } from './feedI18n.js';

let activeOtpId = null;
let otpExpiryTimeoutId = null;
let uiManagerRef = null;
const OTP_FALLBACK_LIFETIME_MS = 5 * 60 * 1000;

// All registered UI surfaces (Settings panel, onboarding mask, ...).
const views = [];

function $(id) {
    return id ? document.getElementById(id) : null;
}

// Builds a view descriptor from an id map. Every field is optional except
// emailStage/codeStage/emailInput/codeInput/requestBtn/verifyBtn — a view
// needs at least those to be able to log a user in.
function buildView(ids = {}) {
    const codeStage = $(ids.codeStage);
    return {
        emailStage: $(ids.emailStage),
        codeStage,
        loggedInStage: $(ids.loggedInStage),
        emailInput: $(ids.emailInput),
        codeInput: $(ids.codeInput),
        requestBtn: $(ids.requestBtn),
        verifyBtn: $(ids.verifyBtn),
        backBtn: $(ids.backBtn),
        logoutBtn: $(ids.logoutBtn),
        userEmailLabel: $(ids.userEmailLabel),
        avatarEl: $(ids.avatarEl),
        titleEl: $(ids.titleEl),
        leadEl: $(ids.leadEl),
        licenseToggleBtn: $(ids.licenseToggleBtn),
        authStatusLabel: $(ids.authStatusLabel),
        messageEl: $(ids.messageEl),
        codeCaption: codeStage ? codeStage.querySelector('.input-caption') : null,
        onAuthed: typeof ids.onAuthed === 'function' ? ids.onAuthed : null,
        heroTitle: typeof ids.heroTitle === 'function' ? ids.heroTitle : null,   // optional per-view wording (the onboarding card says "Free cloud models")
        heroLead: typeof ids.heroLead === 'function' ? ids.heroLead : null,
    };
}

function isViewUsable(view) {
    return !!(view.emailStage && view.codeStage && view.emailInput && view.codeInput && view.requestBtn && view.verifyBtn);
}

// ── Shared UI helpers (operate across every registered view) ───────────
function notify(view, message) {
    if (view.messageEl) {
        view.messageEl.textContent = message;
        return;
    }
    if (uiManagerRef) uiManagerRef.showToast(message);
    else alert(message);
}

function setLoading(btn, loadingText) {
    if (!btn) return;
    if (btn.dataset.idleLabel === undefined) btn.dataset.idleLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = loadingText;
}

function clearLoading(btn) {
    if (!btn) return;
    btn.disabled = false;
    if (btn.dataset.idleLabel !== undefined) btn.textContent = btn.dataset.idleLabel;
}

function setCodeCaption(view, email) {
    if (view.codeCaption && email) {
        view.codeCaption.innerHTML = escapeHtml(T('4 digits, sent to {email}', { email }));
    }
}

// ── OTP expiry bookkeeping (shared across every view) ──────────────────
const clearOtpExpiryTimeout = () => {
    if (otpExpiryTimeoutId !== null) {
        clearTimeout(otpExpiryTimeoutId);
        otpExpiryTimeoutId = null;
    }
};

const clearPendingOtpState = async () => {
    clearOtpExpiryTimeout();
    activeOtpId = null;
    const patch = {
        [SK.otpId]: null,
        [SK.otpEmail]: null,
        [SK.otpExpiresAt]: null,
        [SK.otpRequestedAt]: null
    };
    await StorageManager.set(patch);
    return patch;
};

const parseOtpExpiry = (value) => {
    if (!value) return null;
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? null : timestamp;
};

const resolveOtpExpiry = (expiresAt, requestedAt = Date.now()) => {
    const parsedExpiry = parseOtpExpiry(expiresAt);
    if (parsedExpiry) {
        return new Date(parsedExpiry).toISOString();
    }
    return new Date(requestedAt + OTP_FALLBACK_LIFETIME_MS).toISOString();
};

const scheduleOtpExpiry = (expiresAt) => {
    clearOtpExpiryTimeout();
    const expiryTime = parseOtpExpiry(expiresAt);
    if (!expiryTime) return;

    const msRemaining = expiryTime - Date.now();
    if (msRemaining <= 0) return;

    otpExpiryTimeoutId = setTimeout(async () => {
        const currentState = await StorageManager.getAll();
        if (currentState[SK.otpId]) {
            const patch = await clearPendingOtpState();
            await refreshAuthState({ ...currentState, ...patch });
        }
    }, msRemaining);
};

const ensureInstallId = async () => StorageManager.getInstallId();

// Fetches plan/usage for the signed-in account and resolves the "Checking..." badge.
// The optional usage readout (#analyticsStatus & co) is not in the current Settings layout, so every
// write to it is guarded — the badge must be resolved either way (it used to stay on "Checking...").
const refreshUsageAnalytics = async (view, token) => {
    const out = {
        status: document.getElementById('analyticsStatus'),
        trial: document.getElementById('analyticsTrialRemaining'),
        done: document.getElementById('analyticsCompletedRequests'),
        model: document.getElementById('analyticsLastModel'),
    };
    const show = (o) => { for (const k of Object.keys(out)) if (out[k] && k in o) out[k].textContent = o[k]; };
    show({ status: T('Loading...') });

    try {
        const installId = await ensureInstallId();
        const headers = {
            'Content-Type': 'application/json',
            'X-Install-ID': installId,
        };
        if (token) headers.Authorization = `Bearer ${token}`;

        const response = await fetch(`${StorageManager.getApiBase()}/v1/projects/ai_summary_helper/usage`, {
            method: 'GET',
            headers,
            // Don't let a hung request leave the UI stuck on 'Checking...'
            signal: AbortSignal.timeout(10000),
        });

        const result = await response.json();
        if (!response.ok || !result?.success) {
            throw new Error(result?.error || `HTTP ${response.status}`);
        }

        show({
            trial: String(result?.trial?.remaining ?? '-'),
            done: String(result?.account?.completed_requests ?? 0),
            model: result?.account?.last_model || '-',
            status: result?.account?.logged_in ? T('Account') : T('Free Tier'),
        });

        const isPro = result?.account?.subscription_status === 'active';
        setStatusBadge(view.authStatusLabel, isPro);
    } catch (error) {
        show({ trial: '-', done: '-', model: '-', status: T('Unavailable') });
        setStatusBadge(view.authStatusLabel, false);
        console.error('Usage analytics refresh failed:', error.message);
    }
};

// Four digit boxes drawn over the real (transparent) input: keeps paste, autofill (one-time-code) and keyboards working.
function renderOtpBoxes(input) {
    const boxes = input && input.parentElement ? input.parentElement.querySelectorAll('.otp-box') : [];
    const v = input ? input.value : '';
    boxes.forEach((b, i) => {
        b.textContent = v[i] || '';
        b.classList.toggle('active', i === Math.min(v.length, boxes.length - 1));
    });
}
function bindOtpBoxes(input) {
    if (!input || input._otpBound) return;
    input._otpBound = true;
    input.addEventListener('input', () => { input.value = input.value.replace(/\s+/g, ''); renderOtpBoxes(input); });
    input.addEventListener('focus', () => renderOtpBoxes(input));
    renderOtpBoxes(input);
}

function setStatusBadge(label, isPro) {
    if (!label) return;
    label.hidden = false;
    label.textContent = isPro ? T('Pro Active ✓') : T('Free Tier');
    label.classList.toggle('signed-in', !!isPro);
}

function setLoggedInOnlySectionsVisible(isLoggedIn) {
    // Settings-only extras (legacy license key). Harmless no-op for views that don't have them (onboarding).
    // Pro key field: signed out → hidden; signed in → hidden until "Pro License Key" is pressed (unless a key is already stored).
    const legacyLicenseGroup = document.getElementById('legacyLicenseGroup');
    if (!legacyLicenseGroup) return;
    if (!isLoggedIn) { legacyLicenseGroup.style.display = 'none'; legacyLicenseGroup.dataset.open = ''; return; }
    const keyInput = document.getElementById('licenseKey');
    const open = legacyLicenseGroup.dataset.open === '1' || !!(keyInput && keyInput.value);
    legacyLicenseGroup.style.display = open ? 'block' : 'none';
}

// ── Core: render current auth/OTP state into every registered view ─────
async function refreshAuthState(forceData = null) {
    const data = forceData || await StorageManager.getAll();
    const user = data[SK.user];
    const token = data[SK.token];
    const pendingOtpId = data[SK.otpId];
    const pendingOtpExpiresAt = resolveOtpExpiry(data[SK.otpExpiresAt], parseOtpExpiry(data[SK.otpRequestedAt]) || Date.now());
    const pendingOtpExpiryTime = parseOtpExpiry(pendingOtpExpiresAt);
    const isPendingOtpExpired = pendingOtpId && (!pendingOtpExpiryTime || pendingOtpExpiryTime <= Date.now());

    // Simple token expiration check with safe Base64Url decoding and padding
    let isExpired = true;
    if (token) {
        try {
            const base64Url = token.split('.')[1];
            let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');

            // CRITICAL FIX: Add missing padding so atob() doesn't throw a DOMException
            const pad = base64.length % 4;
            if (pad) base64 += '='.repeat(4 - pad);

            // Safely decode UTF-8 payload
            const jsonPayload = decodeURIComponent(atob(base64).split('').map((c) =>
                '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
            ).join(''));

            const payload = JSON.parse(jsonPayload);
            isExpired = (payload.exp * 1000) < Date.now();
        } catch (e) {
            console.error('[Auth] Token parsing failed:', e.message);
            isExpired = true;
        }
    }

    let stateName;
    if (!isExpired && user) stateName = 'loggedIn';
    else if (isPendingOtpExpired) stateName = 'otpExpired';
    else if (pendingOtpId) stateName = 'otpPending';
    else stateName = 'signedOut';

    if (stateName === 'otpExpired') await clearPendingOtpState();
    // Stale/invalid token or user with no active session — clear it.
    if (stateName === 'signedOut' && (token || user)) {
        await StorageManager.set({ [SK.token]: null, [SK.user]: null });
    }

    if (stateName === 'loggedIn') {
        clearOtpExpiryTimeout();
        activeOtpId = null;
    } else if (stateName === 'otpPending') {
        activeOtpId = pendingOtpId;
        scheduleOtpExpiry(pendingOtpExpiresAt);
    } else {
        clearOtpExpiryTimeout();
    }

    setLoggedInOnlySectionsVisible(stateName === 'loggedIn');

    for (const view of views) {
        applyStateToView(view, stateName, data, user);
        if (stateName === 'loggedIn') {
            await refreshUsageAnalytics(view, !isExpired ? token : null);
            if (view.onAuthed) view.onAuthed(user);
        }
    }

    // Let other modules (e.g. the main-screen onboarding mask) react to
    // auth-state changes without polling — used to swap from the login
    // mask to the summary feed once sign-in succeeds.
    document.dispatchEvent(new CustomEvent('aish:authStateChanged', { detail: { stateName } }));
}

function applyHero(view, stateName) {
    if (view.titleEl) view.titleEl.textContent = stateName === 'otpPending' ? T('Enter your code') : (view.heroTitle ? view.heroTitle() : T('Sign in to AI Summary Helper'));
    if (view.leadEl) {
        view.leadEl.textContent = view.heroLead ? view.heroLead() : T('Free cloud models and your summaries on every device. Or skip this and use your own API key.');
        view.leadEl.style.display = stateName === 'otpPending' ? 'none' : '';
    }
}

function applyStateToView(view, stateName, data, user) {
    applyHero(view, stateName);
    const show = (el, visible) => { if (el) el.style.display = visible ? '' : 'none'; };   // '' keeps the stylesheet's flex layout

    if (stateName === 'loggedIn') {
        show(view.emailStage, false);
        show(view.codeStage, false);
        show(view.loggedInStage, true);
        if (view.userEmailLabel) view.userEmailLabel.textContent = user.email;
        if (view.avatarEl) view.avatarEl.textContent = (user.email || '?').trim().charAt(0).toUpperCase();
        if (view.authStatusLabel) {
            view.authStatusLabel.hidden = false;
            view.authStatusLabel.textContent = T('Checking...');
            view.authStatusLabel.classList.remove('signed-in');
        }
    } else if (stateName === 'otpPending') {
        show(view.emailStage, false);
        show(view.codeStage, true);
        show(view.loggedInStage, false);
        setCodeCaption(view, data[SK.otpEmail]);
    } else {
        // 'otpExpired' and 'signedOut' render the same way: back to the
        // email entry stage.
        show(view.emailStage, true);
        show(view.codeStage, false);
        show(view.loggedInStage, false);
        if (view.authStatusLabel) {
            view.authStatusLabel.hidden = true;   // signed out: the form says it all
        }
    }
}

// ── Core actions — shared by every view's buttons ───────────────────────
async function requestOtp(view) {
    if (view.requestBtn.disabled) return;

    const email = view.emailInput.value.trim();
    if (!email) {
        notify(view, T('Please enter a valid email.'));
        return;
    }

    setLoading(view.requestBtn, T('Sending...'));

    try {
        const requestedAt = Date.now();
        const response = await fetch(`${StorageManager.getApiBase()}/v1/auth/request-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            throw new Error(`Server returned non-JSON response: ${text.substring(0, 50)}`);
        }

        const result = await response.json();
        if (!response.ok) throw new Error(result.error || T('Failed to send code'));

        activeOtpId = result.otpId;
        const otpExpiresAt = resolveOtpExpiry(result.otpExpiresAt, requestedAt);
        scheduleOtpExpiry(otpExpiresAt);

        await StorageManager.set({
            [SK.otpId]: activeOtpId,
            [SK.otpEmail]: email,
            [SK.otpExpiresAt]: otpExpiresAt,
            [SK.otpRequestedAt]: new Date(requestedAt).toISOString()
        });

        await refreshAuthState();
        if (view.codeInput) { view.codeInput.focus(); renderOtpBoxes(view.codeInput); }
        notify(view, T('Magic code sent! ✨ Check your inbox.'));
    } catch (err) {
        console.error('OTP request error:', err);
        notify(view, T('Error: {message}', { message: err.message }));
    } finally {
        clearLoading(view.requestBtn);
    }
}

async function verifyOtp(view) {
    if (view.verifyBtn.disabled) return;

    const code = view.codeInput.value.replace(/\s+/g, '').trim();
    if (!code) {
        notify(view, T('Please enter the verification code.'));
        return;
    }

    const stored = await StorageManager.getAll();
    const effectiveOtpId = activeOtpId || stored[SK.otpId];
    const pendingOtpExpiryTime = parseOtpExpiry(stored[SK.otpExpiresAt]);

    if (!effectiveOtpId) {
        notify(view, T('Session lost. Please request a new code.'));
        return;
    }
    if (!pendingOtpExpiryTime || pendingOtpExpiryTime <= Date.now()) {
        const patch = await clearPendingOtpState();
        const currentState = await StorageManager.getAll();
        await refreshAuthState({ ...currentState, ...patch });
        notify(view, T('Code expired. Please request a new one.'));
        return;
    }

    setLoading(view.verifyBtn, T('Verifying...'));

    try {
        const response = await fetch(`${StorageManager.getApiBase()}/v1/auth/verify-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ otpId: effectiveOtpId, code })
        });

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            throw new Error(`Server returned non-JSON response: ${text.substring(0, 50)}`);
        }

        const result = await response.json();
        if (!response.ok) throw new Error(result.error || T('Invalid code'));

        let userRecord = result.record;
        const token = result.token;

        // ── auto-initialize missing app_data ──
        let appData = userRecord.app_data;
        if (typeof appData === 'string') {
            try { appData = JSON.parse(appData); } catch (e) { appData = {}; }
        }
        if (!appData || typeof appData !== 'object') appData = {};

        if (!appData.ai_summary_helper) {
            appData.ai_summary_helper = {
                completed_requests: 0,
                trial_requests_used: 0,
                preferences: {
                    theme: 'dark',
                    summaryMode: 'extension'
                }
            };
            userRecord.app_data = appData;

            // Best-effort push to backend. Fails gracefully if PB REST API isn't exposed via the proxy.
            try {
                await fetch(`${StorageManager.getApiBase()}/api/collections/users/records/${userRecord.id}`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ app_data: appData })
                });
            } catch (e) {
                console.warn('[Auth] Initial app_data synced locally but remote sync failed.', e);
            }
        }
        // ──────────────────────────────────────────────

        const authData = {
            [SK.token]: token,
            [SK.user]: userRecord,
            [SK.otpId]: null,
            [SK.otpEmail]: null,
            [SK.otpExpiresAt]: null,
            [SK.otpRequestedAt]: null
        };

        await StorageManager.set(authData);

        // Signed in: the byPhil cloud model is the default. Only a working own API (key set, or a keyless local model) keeps the app in "local".
        try {
            const sync = await chrome.storage.sync.get(['connectionMode', 'activeService', 'preferredCloudModel']);
            const loc = await chrome.storage.local.get([SK.servicesConfig]);
            const cfg = ((loc[SK.servicesConfig] || {})[sync.activeService]) || {};
            const ownApi = sync.connectionMode === 'local' && !!(cfg.apiKey || sync.activeService === 'ollama');
            const upd = {};
            if (!ownApi && sync.connectionMode !== 'cloud') upd.connectionMode = 'cloud';
            if (!sync.preferredCloudModel) upd.preferredCloudModel = 'google/gemini-3.8-flash';
            if (Object.keys(upd).length) await chrome.storage.sync.set(upd);
        } catch (_) { /* defaults apply anyway */ }

        // Sync the server-side license key (users.license_key) into local
        // storage so the "Pro License Key" field reflects the account's
        // actual license, not just whatever was manually entered before.
        if (userRecord?.license_key) {
            await StorageManager.set({ [SK.licenseKey]: userRecord.license_key });
        }

        clearOtpExpiryTimeout();
        activeOtpId = null;

        notify(view, T('Successfully connected! 🧙'));
        if (view.codeInput) { view.codeInput.value = ''; renderOtpBoxes(view.codeInput); }

        const currentState = await StorageManager.getAll();
        await refreshAuthState({ ...currentState, ...authData });
    } catch (err) {
        console.error('Validation failure:', err);
        notify(view, err.message || T('Invalid code or expired session.'));
    } finally {
        clearLoading(view.verifyBtn);
    }
}

async function logout() {
    clearOtpExpiryTimeout();
    const logoutData = {
        [SK.token]: null,
        [SK.user]: null,
        [SK.otpId]: null,
        [SK.otpEmail]: null,
        [SK.otpExpiresAt]: null,
        [SK.otpRequestedAt]: null
    };
    await StorageManager.set(logoutData);
    activeOtpId = null;

    const currentState = await StorageManager.getAll();
    await refreshAuthState({ ...currentState, ...logoutData });

    if (uiManagerRef) uiManagerRef.showToast(T('Logged out.'));
    else alert(T('Logged out.'));
}

async function goBackToEmail(view) {
    if (!confirm(T('This will invalidate the current code. Continue?'))) return;
    await clearPendingOtpState();
    if (view.codeStage) view.codeStage.style.display = 'none';
    if (view.emailStage) view.emailStage.style.display = 'block';
}

// ── Public API ───────────────────────────────────────────────────────
// Registers one UI surface (a set of DOM element ids) with the shared auth
// core. Call this once per screen/mask that needs a login UI — Settings
// and the main-screen onboarding mask both do this from initAuthManager().
export function registerAuthView(ids) {
    const view = buildView(ids);
    if (!isViewUsable(view)) return null;
    views.push(view);

    view.emailInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            view.requestBtn.click();
        }
    });
    view.codeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            if (!view.verifyBtn.disabled) view.verifyBtn.click();
        }
    });

    view.requestBtn.addEventListener('click', () => requestOtp(view));
    view.verifyBtn.addEventListener('click', () => verifyOtp(view));
    if (view.backBtn) view.backBtn.addEventListener('click', () => goBackToEmail(view));
    if (view.logoutBtn) view.logoutBtn.addEventListener('click', () => logout());
    if (view.licenseToggleBtn) view.licenseToggleBtn.addEventListener('click', () => {
        const g = document.getElementById('legacyLicenseGroup');
        if (!g) return;
        const open = g.style.display === 'none';
        g.dataset.open = open ? '1' : '';
        g.style.display = open ? 'block' : 'none';
        if (open) { const k = document.getElementById('licenseKey'); if (k) k.focus(); }
    });

    // Shared look & wording for every sign-in form (Variant B): hint under the button, 4 digit boxes, auto-verify, resend.
    view.requestBtn.textContent = T('Send me a code');
    if (!view.requestBtn.nextElementSibling || !view.requestBtn.nextElementSibling.classList.contains('auth-hint')) {
        const hint = document.createElement('p');
        hint.className = 'input-caption auth-hint';
        hint.textContent = T('No password. We email you a short code.');
        view.requestBtn.insertAdjacentElement('afterend', hint);
    }
    bindOtpBoxes(view.codeInput);
    const codeHint = document.createElement('p');
    codeHint.className = 'input-caption auth-hint';
    codeHint.textContent = T('Paste works. It signs you in after the last digit.');
    view.codeInput.parentElement.insertAdjacentElement('afterend', codeHint);
    view.codeInput.addEventListener('input', () => { if (view.codeInput.value.length === 4) verifyOtp(view); });
    if (view.backBtn) {
        const resend = document.createElement('button');
        resend.type = 'button';
        resend.className = 'btn-link auth-resend';
        resend.textContent = T('Resend code');
        resend.addEventListener('click', () => requestOtp(view));
        const row = document.createElement('div');
        row.className = 'auth-link-row';
        view.backBtn.insertAdjacentElement('beforebegin', row);
        row.append(view.backBtn, resend);
    }

    return view;
}

// Initializes the shared login module for the whole popup. Wires up the
// Settings-screen "Account Sync" panel (the preferred, full-featured
// implementation) and the main-screen onboarding mask against the very
// same core logic, then renders the current auth state into both.
export async function initAuthManager(uiManager) {
    uiManagerRef = uiManager || uiManagerRef;

    registerAuthView({
        emailStage: 'otpEmailStage',
        codeStage: 'otpCodeStage',
        loggedInStage: 'loggedInStage',
        emailInput: 'otpEmail',
        codeInput: 'otpCode',
        requestBtn: 'otpRequestBtn',
        verifyBtn: 'otpVerifyBtn',
        backBtn: 'otpBackBtn',
        logoutBtn: 'logoutBtn',
        userEmailLabel: 'userEmailLabel',
        avatarEl: 'accountAvatar',
        licenseToggleBtn: 'licenseToggleBtn',
        authStatusLabel: 'authStatusLabel',
    });

    registerAuthView({
        emailStage: 'onboardingEmailStage',
        codeStage: 'onboardingOtpStep',
        emailInput: 'onboardingEmail',
        codeInput: 'onboardingOtpCode',
        requestBtn: 'onboardingSendCodeBtn',
        verifyBtn: 'onboardingVerifyBtn',
        backBtn: 'onboardingBackBtn',
        messageEl: 'onboardingAuthMessage',
        titleEl: 'onboardingTitle',
        leadEl: 'onboardingLead',
        heroTitle: () => T('☁️ Free cloud models'),
        heroLead: () => T('Sign in with your email, no API key needed. Your summaries follow you to every device.'),
    });

    if (!views.length) return;
    await refreshAuthState();
}

export async function refreshAuthStateFromSettings() {
    await refreshAuthState();
    const { [SK.token]: pb_token } = await StorageManager.getAll();
    if (!pb_token) return;
    try {
        const response = await fetch(`${StorageManager.getApiBase()}/v1/projects/ai_summary_helper/usage`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${pb_token}`,
            },
            signal: AbortSignal.timeout(10000),
        });
        const result = await response.json();
        if (response.ok && result?.success) {
            const isPro = result?.account?.subscription_status === 'active';
            setStatusBadge(document.getElementById('authStatusLabel'), isPro);

            // Sync the server-side license key into local storage so the
            // "Pro License Key" field reflects the account's actual license.
            const { [SK.user]: pb_user } = await StorageManager.getAll();
            const serverLicenseKey = pb_user?.license_key;
            if (serverLicenseKey) {
                const { [SK.licenseKey]: licenseKey } = await StorageManager.getAll();
                if (licenseKey !== serverLicenseKey) {
                    await StorageManager.set({ [SK.licenseKey]: serverLicenseKey });
                    const licenseKeyInput = document.getElementById('licenseKey');
                    if (licenseKeyInput) licenseKeyInput.value = serverLicenseKey;
                    const licenseStatusLabel = document.getElementById('licenseStatusLabel');
                    if (licenseStatusLabel) {
                        licenseStatusLabel.textContent = T('Pro Active ✓');
                        licenseStatusLabel.classList.add('signed-in');
                    }
                }
            }
        }
    } catch (err) {
        console.error('[Auth] Live status refresh failed:', err.message);
    }
}
