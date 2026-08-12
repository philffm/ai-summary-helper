// authManager.js - Handles Authentication flow via api.byphil.eu proxy
import StorageManager from './storageManager.js';

let activeOtpId = null; 
let otpExpiryTimeoutId = null;
let uiManagerRef = null;
let refreshAuthStateFn = null;
const OTP_FALLBACK_LIFETIME_MS = 5 * 60 * 1000;

export async function initAuthManager(uiManager) {
    uiManagerRef = uiManager;
    const authSection = document.getElementById('authSection');
    const emailStage = document.getElementById('otpEmailStage');
    const codeStage = document.getElementById('otpCodeStage');
    const loggedInStage = document.getElementById('loggedInStage');
    
    const emailInput = document.getElementById('otpEmail');
    const codeInput = document.getElementById('otpCode');
    const userEmailLabel = document.getElementById('userEmailLabel');
    const authStatusLabel = document.getElementById('authStatusLabel');
    const analyticsStatus = document.getElementById('analyticsStatus');
    const analyticsTrialRemaining = document.getElementById('analyticsTrialRemaining');
    const analyticsCompletedRequests = document.getElementById('analyticsCompletedRequests');
    const analyticsLastModel = document.getElementById('analyticsLastModel');
    const analyticsSection = document.getElementById('analyticsSection');
    const legacyLicenseGroup = document.getElementById('legacyLicenseGroup');
    const cloudModelGroup = document.getElementById('cloudModelGroup');
    const cloudModelTeaser = document.getElementById('cloudModelTeaser');
    
    const requestBtn = document.getElementById('otpRequestBtn');
    const verifyBtn = document.getElementById('otpVerifyBtn');
    const backBtn = document.getElementById('otpBackBtn');
    const logoutBtn = document.getElementById('logoutBtn');

    if (!authSection || !requestBtn || !verifyBtn) return;

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

    const ensureInstallId = async () => {
        return StorageManager.getInstallId();
    };

    const refreshUsageAnalytics = async (token) => {
        if (!analyticsStatus || !analyticsTrialRemaining || !analyticsCompletedRequests || !analyticsLastModel) return;

        analyticsStatus.textContent = 'Loading...';

        try {
            const installId = await ensureInstallId();
            const headers = {
                'Content-Type': 'application/json',
                'X-Install-ID': installId,
            };

            if (token) {
                headers.Authorization = `Bearer ${token}`;
            }

            const response = await fetch(`${StorageManager.getApiBase()}/v1/projects/ai_summary_helper/usage`, {
                method: 'GET',
                headers,
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
            if (authStatusLabel) {
                authStatusLabel.textContent = isPro ? 'Pro Active ✓' : 'Free Tier';
                authStatusLabel.style.background = isPro ? 'var(--success, #2ecc40)' : 'rgba(0,0,0,0.2)';
                authStatusLabel.style.color = isPro ? '#fff' : 'var(--text-muted, #889999)';
            }
        } catch (error) {
            analyticsStatus.textContent = 'Unavailable';
            analyticsTrialRemaining.textContent = '-';
            analyticsCompletedRequests.textContent = '-';
            analyticsLastModel.textContent = '-';
            console.error('Usage analytics refresh failed:', error.message);
        }
    };

    const setLoggedInOnlySectionsVisible = (isLoggedIn) => {
        const displayValue = isLoggedIn ? 'block' : 'none';
        if (analyticsSection) analyticsSection.style.display = displayValue;
        if (legacyLicenseGroup) legacyLicenseGroup.style.display = displayValue;

        if (cloudModelGroup) cloudModelGroup.style.display = displayValue;
        if (cloudModelTeaser) cloudModelTeaser.style.display = isLoggedIn ? 'none' : 'block';
    };

    // ── Helper: Refresh UI State ───────────────────────────────────
    const refreshAuthState = async (forceData = null) => {
        refreshAuthStateFn = refreshAuthState; 
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
                if (pad) {
                    base64 += '='.repeat(4 - pad);
                }
                
                // Safely decode UTF-8 payload
                const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
                    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
                }).join(''));
                
                const payload = JSON.parse(jsonPayload);
                isExpired = (payload.exp * 1000) < Date.now();
            } catch (e) {
                console.error("[Auth] Token parsing failed:", e.message);
                isExpired = true;
            }
        }

        if (!isExpired && user) {
            clearOtpExpiryTimeout();
            activeOtpId = null; 
            
            setLoggedInOnlySectionsVisible(true);
            emailStage.style.display = 'none';
            codeStage.style.display = 'none';
            loggedInStage.style.display = 'block';
            userEmailLabel.textContent = `Logged in as: ${user.email}`;
            
            authStatusLabel.textContent = 'Checking...';
            authStatusLabel.style.background = 'rgba(0,0,0,0.2)';
            authStatusLabel.style.color = 'var(--text-muted, #889999)';
        } else if (isPendingOtpExpired) {
            const patch = await clearPendingOtpState();
            setLoggedInOnlySectionsVisible(false);

            emailStage.style.display = 'block';
            codeStage.style.display = 'none';
            loggedInStage.style.display = 'none';
            
            authStatusLabel.textContent = 'Not logged in';
            authStatusLabel.style.background = 'rgba(0,0,0,0.2)';
            authStatusLabel.style.color = 'var(--text-muted, #889999)';
        } else if (pendingOtpId) {
            activeOtpId = pendingOtpId;
            scheduleOtpExpiry(pendingOtpExpiresAt);
            setLoggedInOnlySectionsVisible(false);
            emailStage.style.display = 'none';
            codeStage.style.display = 'block';
            loggedInStage.style.display = 'none';

            const emailCaption = codeStage.querySelector('.input-caption');
            if (emailCaption && data.pending_email) {
                emailCaption.innerHTML = `Enter the code sent to:<br/><strong>${data.pending_email}</strong>`;
            }
        } else {
            clearOtpExpiryTimeout();
            setLoggedInOnlySectionsVisible(false);
            if (token || user) {
                await StorageManager.set({ pb_token: null, pb_user: null });
            }

            emailStage.style.display = 'block';
            codeStage.style.display = 'none';
            loggedInStage.style.display = 'none';
            authStatusLabel.textContent = 'Not logged in';
            authStatusLabel.style.background = 'rgba(0,0,0,0.2)';
            authStatusLabel.style.color = 'var(--text-muted, #889999)';
        }

        await refreshUsageAnalytics(!isExpired ? token : null);
    };

    await refreshAuthState();

    // ── Keyboard Support ──────────────────────────────────────────
    emailInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            requestBtn.click();
        }
    });

    codeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation(); 
            if (!verifyBtn.disabled) {
                verifyBtn.click();
            }
        }
    });

    // ── STEP A: Requesting the Code ──────────────────────────────────
    requestBtn.addEventListener('click', async () => {
        if (requestBtn.disabled) return;
        
        const email = emailInput.value.trim();
        if (!email) {
            if (uiManagerRef) uiManagerRef.showToast('Please enter a valid email.');
            else alert('Please enter a valid email.');
            return;
        }

        requestBtn.disabled = true;
        requestBtn.textContent = 'Sending...';

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

            emailStage.style.display = 'none';
            codeStage.style.display = 'block';
            codeInput.focus();

            const emailCaption = codeStage.querySelector('.input-caption');
            if (emailCaption) {
                emailCaption.innerHTML = `Enter the code sent to:<br/><strong>${email}</strong>`;
            }
            if (uiManagerRef) uiManagerRef.showToast('Magic code sent! ✨');
        } catch (err) {
            console.error('OTP request error:', err);
            if (uiManagerRef) uiManagerRef.showToast(`Error: ${err.message}`);
            else alert(`Authentication Error: ${err.message}`);
        } finally {
            requestBtn.disabled = false;
            requestBtn.textContent = 'Send Magic Code';
        }
    });

    // ── STEP B: Verifying the Code ───────────────────────────────────
    verifyBtn.addEventListener('click', async () => {
        if (verifyBtn.disabled) return;
        
        const code = codeInput.value.replace(/\s+/g, '').trim();
        if (!code) {
            if (uiManagerRef) uiManagerRef.showToast('Please enter the verification code.');
            else alert('Please enter the verification code.');
            return;
        }
        
        const stored = await StorageManager.getAll();
        const effectiveOtpId = activeOtpId || stored.pending_otp_id;
        const pendingOtpExpiryTime = parseOtpExpiry(stored.pending_otp_expires_at);
        
        if (!effectiveOtpId) {
            if (uiManagerRef) uiManagerRef.showToast('Session lost. Please request a new code.');
            else alert('Session lost. Please request a new code.');
            return;
        }
        if (!pendingOtpExpiryTime || pendingOtpExpiryTime <= Date.now()) {
            const patch = await clearPendingOtpState();
            const currentState = await StorageManager.getAll();
            await refreshAuthState({ ...currentState, ...patch });
            if (uiManagerRef) uiManagerRef.showToast('Code expired. Please request a new one.');
            else alert('Code expired. Please request a new one.');
            return;
        }

        verifyBtn.disabled = true;
        verifyBtn.textContent = 'Verifying...';

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
            clearOtpExpiryTimeout();
            activeOtpId = null;

            if (uiManagerRef) uiManagerRef.showToast('Successfully connected! 🧙');
            else alert('Successfully connected to your account!');
            
            if (codeInput) codeInput.value = '';

            const currentState = await StorageManager.getAll();
            await refreshAuthState({ ...currentState, ...authData });
        } catch (err) {
            console.error('Validation failure:', err);
            if (uiManagerRef) uiManagerRef.showToast(err.message || 'Invalid code or expired session.');
            else alert(err.message || 'Invalid code or expired session.');
        } finally {
            verifyBtn.disabled = false;
            verifyBtn.textContent = 'Verify & Log In';
        }
    });

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
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
        });
    }

    if (backBtn) {
        backBtn.addEventListener('click', async () => {
            if (!confirm('This will invalidate the current code. Continue?')) return;
            await clearPendingOtpState();
            codeStage.style.display = 'none';
            emailStage.style.display = 'block';
        });
    }
}

export async function refreshAuthStateFromSettings() {
    if (refreshAuthStateFn) {
        const data = await StorageManager.getAll();
        await refreshAuthStateFn(data);
    }
    const { pb_token } = await StorageManager.getAll();
    if (!pb_token) return;
    try {
        const response = await fetch(`${StorageManager.getApiBase()}/v1/projects/ai_summary_helper/usage`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${pb_token}`,
            },
        });
        const result = await response.json();
        if (response.ok && result?.success) {
            const isPro = result?.account?.subscription_status === 'active';
            const authStatusLabel = document.getElementById('authStatusLabel');
            if (authStatusLabel) {
                authStatusLabel.textContent = isPro ? 'Pro Active ✓' : 'Free Tier';
                authStatusLabel.style.background = isPro ? 'var(--success, #2ecc40)' : 'rgba(0,0,0,0.2)';
                authStatusLabel.style.color = isPro ? '#fff' : 'var(--text-muted, #889999)';
            }
        }
    } catch (err) {
        console.error('[Auth] Live status refresh failed:', err.message);
    }
}