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
        authStatusLabel: $(ids.authStatusLabel),
        messageEl: $(ids.messageEl),
        codeCaption: codeStage ? codeStage.querySelector('.input-caption') : null,
        onAuthed: typeof ids.onAuthed === 'function' ? ids.onAuthed : null,
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
        view.codeCaption.innerHTML = `Enter the code sent to:<br/><strong>${email}</strong>`;
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
        pending_otp_id: null,
        pending_email: null,
        pending_otp_expires_at: null,
        pending_otp_requested_at: null
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
        if (currentState.pending_otp_id) {
            const patch = await clearPendingOtpState();
            await refreshAuthState({ ...currentState, ...patch });
        }
    }, msRemaining);
};

const ensureInstallId = async () => StorageManager.getInstallId();

// Usage-analytics is a Settings-only concept — only the Settings view will
// ever have these elements, so this is a no-op for every other view.
const refreshUsageAnalytics = async (view, token) => {
    const analyticsStatus = document.getElementById('analyticsStatus');
    const analyticsTrialRemaining = document.getElementById('analyticsTrialRemaining');
    const analyticsCompletedRequests = document.getElementById('analyticsCompletedRequests');
    const analyticsLastModel = document.getElementById('analyticsLastModel');
    if (!analyticsStatus || !analyticsTrialRemaining || !analyticsCompletedRequests || !analyticsLastModel) return;

    analyticsStatus.textContent = 'Loading...';

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

        analyticsTrialRemaining.textContent = String(result?.trial?.remaining ?? '-');
        analyticsCompletedRequests.textContent = String(result?.account?.completed_requests ?? 0);
        analyticsLastModel.textContent = result?.account?.last_model || '-';
        analyticsStatus.textContent = result?.account?.logged_in ? 'Account' : 'Free Tier';

        const isPro = result?.account?.subscription_status === 'active';
        setStatusBadge(view.authStatusLabel, isPro);
    } catch (error) {
        analyticsTrialRemaining.textContent = '-';
        analyticsCompletedRequests.textContent = '-';
        analyticsLastModel.textContent = '-';
        analyticsStatus.textContent = 'Unavailable';
        // CRITICAL FIX: The status label was set to 'Checking...' by
        // refreshAuthState before this call. If the usage fetch fails or
        // hangs, we must resolve it here — otherwise it stays stuck on
        // 'Checking...' forever.
        setStatusBadge(view.authStatusLabel, false);
        console.error('Usage analytics refresh failed:', error.message);
    }
};

function setStatusBadge(label, isPro) {
    if (!label) return;
    label.textContent = isPro ? 'Pro Active ✓' : 'Free Tier';
    label.style.background = isPro ? 'var(--success, #2ecc40)' : 'rgba(0,0,0,0.2)';
    label.style.color = isPro ? '#fff' : 'var(--text-muted, #889999)';
}

function setLoggedInOnlySectionsVisible(isLoggedIn) {
    // Settings-only extras (analytics, legacy license key, cloud-model
    // picker). Harmless no-op for views that don't have them (onboarding).
    const displayValue = isLoggedIn ? 'block' : 'none';
    const analyticsSection = document.getElementById('analyticsSection');
    const legacyLicenseGroup = document.getElementById('legacyLicenseGroup');
    const cloudModelGroup = document.getElementById('cloudModelGroup');
    const cloudModelTeaser = document.getElementById('cloudModelTeaser');
    if (analyticsSection) analyticsSection.style.display = displayValue;
    if (legacyLicenseGroup) legacyLicenseGroup.style.display = displayValue;
    if (cloudModelGroup) cloudModelGroup.style.display = displayValue;
    if (cloudModelTeaser) cloudModelTeaser.style.display = isLoggedIn ? 'none' : 'block';
}

// ── Core: render current auth/OTP state into every registered view ─────
async function refreshAuthState(forceData = null) {
    const data = forceData || await StorageManager.getAll();
    const user = data.pb_user;
    const token = data.pb_token;
    const pendingOtpId = data.pending_otp_id;
    const pendingOtpExpiresAt = resolveOtpExpiry(data.pending_otp_expires_at, parseOtpExpiry(data.pending_otp_requested_at) || Date.now());
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
        await StorageManager.set({ pb_token: null, pb_user: null });
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

function applyStateToView(view, stateName, data, user) {
    const show = (el, visible) => { if (el) el.style.display = visible ? 'block' : 'none'; };

    if (stateName === 'loggedIn') {
        show(view.emailStage, false);
        show(view.codeStage, false);
        show(view.loggedInStage, true);
        if (view.userEmailLabel) view.userEmailLabel.textContent = `Logged in as: ${user.email}`;
        if (view.authStatusLabel) {
            view.authStatusLabel.textContent = 'Checking...';
            view.authStatusLabel.style.background = 'rgba(0,0,0,0.2)';
            view.authStatusLabel.style.color = 'var(--text-muted, #889999)';
        }
    } else if (stateName === 'otpPending') {
        show(view.emailStage, false);
        show(view.codeStage, true);
        show(view.loggedInStage, false);
        setCodeCaption(view, data.pending_email);
    } else {
        // 'otpExpired' and 'signedOut' render the same way: back to the
        // email entry stage.
        show(view.emailStage, true);
        show(view.codeStage, false);
        show(view.loggedInStage, false);
        if (view.authStatusLabel) {
            view.authStatusLabel.textContent = 'Not logged in';
            view.authStatusLabel.style.background = 'rgba(0,0,0,0.2)';
            view.authStatusLabel.style.color = 'var(--text-muted, #889999)';
        }
    }
}

// ── Core actions — shared by every view's buttons ───────────────────────
async function requestOtp(view) {
    if (view.requestBtn.disabled) return;

    const email = view.emailInput.value.trim();
    if (!email) {
        notify(view, 'Please enter a valid email.');
        return;
    }

    setLoading(view.requestBtn, 'Sending...');

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
        if (!response.ok) throw new Error(result.error || 'Failed to send code');

        activeOtpId = result.otpId;
        const otpExpiresAt = resolveOtpExpiry(result.otpExpiresAt, requestedAt);
        scheduleOtpExpiry(otpExpiresAt);

        await StorageManager.set({
            pending_otp_id: activeOtpId,
            pending_email: email,
            pending_otp_expires_at: otpExpiresAt,
            pending_otp_requested_at: new Date(requestedAt).toISOString()
        });

        await refreshAuthState();
        if (view.codeInput) view.codeInput.focus();
        notify(view, 'Magic code sent! ✨ Check your inbox.');
    } catch (err) {
        console.error('OTP request error:', err);
        notify(view, `Error: ${err.message}`);
    } finally {
        clearLoading(view.requestBtn);
    }
}

async function verifyOtp(view) {
    if (view.verifyBtn.disabled) return;

    const code = view.codeInput.value.replace(/\s+/g, '').trim();
    if (!code) {
        notify(view, 'Please enter the verification code.');
        return;
    }

    const stored = await StorageManager.getAll();
    const effectiveOtpId = activeOtpId || stored.pending_otp_id;
    const pendingOtpExpiryTime = parseOtpExpiry(stored.pending_otp_expires_at);

    if (!effectiveOtpId) {
        notify(view, 'Session lost. Please request a new code.');
        return;
    }
    if (!pendingOtpExpiryTime || pendingOtpExpiryTime <= Date.now()) {
        const patch = await clearPendingOtpState();
        const currentState = await StorageManager.getAll();
        await refreshAuthState({ ...currentState, ...patch });
        notify(view, 'Code expired. Please request a new one.');
        return;
    }

    setLoading(view.verifyBtn, 'Verifying...');

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
        if (!response.ok) throw new Error(result.error || 'Invalid code');

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
            pb_token: token,
            pb_user: userRecord,
            pending_otp_id: null,
            pending_email: null,
            pending_otp_expires_at: null,
            pending_otp_requested_at: null
        };

        await StorageManager.set(authData);

        // Sync the server-side license key (users.license_key) into local
        // storage so the "Pro License Key" field reflects the account's
        // actual license, not just whatever was manually entered before.
        if (userRecord?.license_key) {
            await StorageManager.set({ licenseKey: userRecord.license_key });
        }

        clearOtpExpiryTimeout();
        activeOtpId = null;

        notify(view, 'Successfully connected! 🧙');
        if (view.codeInput) view.codeInput.value = '';

        const currentState = await StorageManager.getAll();
        await refreshAuthState({ ...currentState, ...authData });
    } catch (err) {
        console.error('Validation failure:', err);
        notify(view, err.message || 'Invalid code or expired session.');
    } finally {
        clearLoading(view.verifyBtn);
    }
}

async function logout() {
    clearOtpExpiryTimeout();
    const logoutData = {
        pb_token: null,
        pb_user: null,
        pending_otp_id: null,
        pending_email: null,
        pending_otp_expires_at: null,
        pending_otp_requested_at: null
    };
    await StorageManager.set(logoutData);
    activeOtpId = null;

    const currentState = await StorageManager.getAll();
    await refreshAuthState({ ...currentState, ...logoutData });

    if (uiManagerRef) uiManagerRef.showToast('Logged out.');
    else alert('Logged out.');
}

async function goBackToEmail(view) {
    if (!confirm('This will invalidate the current code. Continue?')) return;
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
    });

    if (!views.length) return;
    await refreshAuthState();
}

export async function refreshAuthStateFromSettings() {
    await refreshAuthState();
    const { pb_token } = await StorageManager.getAll();
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
            const { pb_user } = await StorageManager.getAll();
            const serverLicenseKey = pb_user?.license_key;
            if (serverLicenseKey) {
                const { licenseKey } = await StorageManager.getAll();
                if (licenseKey !== serverLicenseKey) {
                    await StorageManager.set({ licenseKey: serverLicenseKey });
                    const licenseKeyInput = document.getElementById('licenseKey');
                    if (licenseKeyInput) licenseKeyInput.value = serverLicenseKey;
                    const licenseStatusLabel = document.getElementById('licenseStatusLabel');
                    if (licenseStatusLabel) {
                        licenseStatusLabel.textContent = 'Pro Active ✓';
                        licenseStatusLabel.style.color = '#fff';
                        licenseStatusLabel.style.background = 'var(--success, #2ecc40)';
                    }
                }
            }
        }
    } catch (err) {
        console.error('[Auth] Live status refresh failed:', err.message);
    }
}
