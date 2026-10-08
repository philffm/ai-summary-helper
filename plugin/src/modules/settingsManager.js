import { applyA11y, clampScale, systemTheme, systemReducesMotion } from './a11y.js';
import { SK, renameKeys } from './storageKeys.js';
// settingsManager.js
// Settings screen initialization — UI is in popup.html (static accordion),
// this file handles logic, auto-save, and wiring event listeners.

import { confirmDestructive } from './confirmDialog.js';
import StorageManager from './storageManager.js';
import { initPromptSettings } from './promptSettings.js';
import { updateModelIdentifierUI } from './modelManager.js';
import { initAuthManager } from './authManager.js';
import { buildCanonicalTagMap, applyCanonicalTags } from './tagIntelligence.js';
import { escapeHtml } from './textUtils.js';
import { T, TN } from './feedI18n.js';

export async function initSettingsManager(ui) {
    const storageData = await StorageManager.getAll();

    // Initialize distinct sections independently (DOM is already in popup.html)
    initModelSettings(storageData);
    initGeneralSettings(storageData);
    initLocalSendSettings(storageData);
    initDangerZone();
    initBackupRestore();
    initLocalIntelligence();
    initSummaryLengthSlider();
    initBookmarkletGenerator();

    // Initialize Auth Manager (drives both the Settings panel and the
    // main-screen onboarding mask — see authManager.js)
    initAuthManager(ui);

    // Initialize prompt manager with the static DOM elements
    initPromptSettings(document.getElementById('promptSettingsRoot'));

    // Prevent form submission page reloads AND persist model settings
    // (API key, endpoint, active service) when the user clicks Save.
    const settingsForm = document.getElementById('settingsForm');
    if (settingsForm) {
        settingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const modelSelect = document.getElementById('model');
            const apiKeyInput = document.getElementById('apiKey');
            const endpointInput = document.getElementById('customEndpoint');

            const activeService = modelSelect ? modelSelect.value : 'openai';
            const storageData = await StorageManager.getAll();
            const servicesConfig = storageData[SK.servicesConfig] || {};
            const prevCfg = servicesConfig[activeService] || {};

            // Persist the current field values for the active service.
            // This guarantees the API key / endpoint are saved even if the
            // user clicks Save without first blurring the input field.
            servicesConfig[activeService] = {
                ...prevCfg,
                apiKey: apiKeyInput ? apiKeyInput.value : (prevCfg.apiKey || ''),
                endpoint: endpointInput ? endpointInput.value : (prevCfg.endpoint || '')
            };

            await StorageManager.set({ activeService });
            await StorageManager.set({ [SK.servicesConfig]: servicesConfig });

            flashSaveIndicator();
        });
    }
}

// ── UI Helper: Visual Auto-Save Indicator ──────────────────────────
function flashSaveIndicator() {
    const saveButton = document.querySelector('button[form="settingsForm"]');
    if (!saveButton) return;
    const origText = saveButton.dataset.origText || saveButton.textContent;
    saveButton.dataset.origText = origText;
    clearTimeout(saveButton._flashTimer);
    saveButton.textContent = T('Saved! ✓');
    saveButton.classList.add('is-saved');   // green + green glow, see .settings-save-fab.is-saved
    saveButton.disabled = true;
    saveButton._flashTimer = setTimeout(() => {
        saveButton.textContent = origText;
        saveButton.classList.remove('is-saved');
        saveButton.disabled = false;
    }, 1500);
}

const autoSave = async (key, value) => {
    await StorageManager.set({ [key]: value });
    flashSaveIndicator();
};

// ── Ollama per-platform setup tutorial ─────────────────────────────────────
// Shows only when the Ollama provider is selected. Modern Ollama rejects
// cross-origin requests from web pages / extensions unless OLLAMA_ORIGINS
// is configured — this walks the user through fixing that on their platform.
const ollamaTutorials = () => ({
    macos: {
        title: T('Set up Ollama on macOS'),
        steps: [
            { title: T('Quit Ollama'), body: T('Click the Ollama icon in the menu bar (top-right) and choose <b>Quit Ollama</b>.') },
            { title: T('Open Terminal'), body: T('Open the <b>Terminal</b> app on your Mac.') },
            { title: T('Allow all origins (app)'), body: T('Run this command so Ollama stays configured after restarting the Mac app:'),
              code: 'launchctl setenv OLLAMA_ORIGINS "*"' },
            { title: T('Restart Ollama'), body: T('Launch Ollama again from your Applications folder or Spotlight.') },
            { title: T('Quick test (terminal)'), body: T('Prefer the terminal? Run Ollama directly in a foreground window:'),
              code: 'OLLAMA_ORIGINS="*" ollama serve' }
        ],
        note: T('Once Ollama restarts, the 403 Forbidden error from this extension is resolved.')
    },
    windows: {
        title: T('Set up Ollama on Windows'),
        steps: [
            { title: T('Quit Ollama'), body: T('Right-click the Ollama tray icon (bottom-right) and choose <b>Quit</b>.') },
            { title: T('Open Command Prompt'), body: T('Press <b>Win + R</b>, type <code>cmd</code> and press Enter.') },
            { title: T('Allow all origins'), body: T('Run this so the running server accepts requests from any origin:'),
              code: 'set OLLAMA_ORIGINS=*' },
            { title: T('Start Ollama'), body: T('Run Ollama as a foreground server from the same window:'),
              code: 'ollama serve' },
            { title: T('Persist (optional)'), body: T('For a permanent fix, set <code>OLLAMA_ORIGINS=*</code> as a system environment variable under <i>System Properties → Environment Variables</i> and restart Ollama.') }
        ],
        note: T('Once Ollama restarts, the 403 Forbidden error from your extension is fixed.')
    },
    linux: {
        title: T('Set up Ollama on Linux'),
        steps: [
            { title: T('Stop Ollama'), body: T('If running as a systemd service, stop it with <code>sudo systemctl stop ollama</code>.') },
            { title: T('Allow all origins'), body: T('Start Ollama with the global wildcard so any origin can connect:'),
              code: 'OLLAMA_ORIGINS="*" ollama serve' },
            { title: T('Persist (optional)'), body: T('For a permanent config via systemd, add <code>Environment="OLLAMA_ORIGINS=*"</code> under the service unit (e.g. <code>/etc/systemd/system/ollama.service</code>), then <code>systemctl daemon-reload</code> and restart.') }
        ],
        note: T('Once Ollama restarts, the 403 Forbidden error from your extension is fixed.')
    }
});


function detectOS() {
    const ua = navigator.userAgent.toLowerCase();
    if (/mac os|macintosh|iphone|ipad|ipod/.test(ua)) return 'macos';
    if (/windows|win64|win32/.test(ua)) return 'windows';
    return 'linux';
}

function renderOllamaTutorial(serviceId) {
    const container = document.getElementById('ollamaTutorialContainer');
    if (!container) return;
    const isOllama = (serviceId || '').toLowerCase() === 'ollama';
    container.style.display = isOllama ? 'block' : 'none';
    container.innerHTML = '';

    if (!isOllama) return;

    const platform = detectOS();
    const t = ollamaTutorials()[platform] || ollamaTutorials().macos;

    const stepsHtml = t.steps.map((step, i) => `
        <div class="ollama-step">
            <span class="ollama-step-num">${i + 1}</span>
            <div class="ollama-step-body">
                <div class="ollama-step-title">${step.title}</div>
                ${step.body ? `<div class="ollama-step-desc">${step.body}</div>` : ''}
                ${step.code ? `
                <div class="ollama-code-wrap">
                    <pre class="ollama-code">${escapeHtml(step.code)}</pre>
                    <button type="button" class="button-secondary ollama-copy-btn" data-copy="${escapeHtml(step.code)}">📋 ${T('Copy')}</button>
                </div>` : ''}
            </div>
        </div>
    `).join('');

    container.innerHTML = `
        <div class="ollama-tutorial-header">🦙 ${t.title}</div>
        ${stepsHtml}
        <div class="ollama-tutorial-note">💡 ${t.note}</div>
    `;

    container.querySelectorAll('.ollama-copy-btn').forEach(copyBtn => {
        copyBtn.addEventListener('click', () => {
            const command = copyBtn.dataset.copy;
            navigator.clipboard.writeText(command).then(() => {
                copyBtn.textContent = T('Copied! ✓');
                setTimeout(() => { copyBtn.textContent = '📋 ' + T('Copy'); }, 1500);
            }).catch(() => {});
        });
    });
}

// ── Section: Model Configuration (Refactored for Hybrid Subscription Model) ──
async function initModelSettings(storageData) {
    const services = await StorageManager.getServices();
    
    // UI Mode Containers
    const cloudModeContainer = document.getElementById('cloudModeContainer');
    const developerModeContainer = document.getElementById('developerModeContainer');
    
    // High-Level Connection Mode Toggles
    const modeCloudRadio = document.getElementById('modeCloud');
    const modeLocalRadio = document.getElementById('modeLocal');
    
    // Cloud Mode Elements
    const cloudModelSelect = document.getElementById('cloudModelSelect');
    const licenseKeyInput = document.getElementById('licenseKey');
    const verifyLicenseBtn = document.getElementById('verifyLicenseButton');
    const licenseStatusLabel = document.getElementById('licenseStatusLabel');
    
    // Developer Mode Elements (Existing)
    const modelSelect = document.getElementById('model');
    const apiKeyInput = document.getElementById('apiKey');
    const endpointInput = document.getElementById('customEndpoint');

    if (!modelSelect || !cloudModeContainer || !developerModeContainer) return;

    // ── 1. Restore & Bind Connection Mode Toggles ───────────────────
    const currentMode = storageData.connectionMode || 'cloud';
    if (currentMode === 'cloud' && modeCloudRadio) modeCloudRadio.checked = true;
    if (currentMode === 'local' && modeLocalRadio) modeLocalRadio.checked = true;

    const toggleConnectionContainers = (mode) => {
        if (mode === 'cloud') {
            cloudModeContainer.style.display = 'block';
            developerModeContainer.style.display = 'none';
        } else {
            cloudModeContainer.style.display = 'none';
            developerModeContainer.style.display = 'block';
        }
    };
    toggleConnectionContainers(currentMode);

    const handleModeChange = async (e) => {
        const targetMode = e.target.value;
        await autoSave('connectionMode', targetMode);
        toggleConnectionContainers(targetMode);

        // When entering BYOK (local) mode, restore and reflect the last-set
        // provider from storage so the developer panel doesn't fall back to
        // a stale default selection.
        if (targetMode === 'local') {
            const latest = await StorageManager.getAll();
            let saved = latest.activeService || modelSelect?.value || 'openai';
            if (modelSelect && Array.from(modelSelect.options).some(o => o.value === saved)) {
                modelSelect.value = saved;
            }
            await updateFields(saved);
        }
    };

    if (modeCloudRadio) modeCloudRadio.addEventListener('change', handleModeChange);
    if (modeLocalRadio) modeLocalRadio.addEventListener('change', handleModeChange);

    // ── 2. Initialize Cloud Settings State ──────────────────────────
    if (cloudModelSelect) {
        // Fetch filtered cheap models from your backend proxy
        fetch(`${StorageManager.getApiBase()}/v1/projects/ai_summary_helper/models`)
            .then(res => res.json())
            .then(data => {
                if (data.success && data.models.length > 0) {
                    // Clear the loading indicator option
                    cloudModelSelect.innerHTML = '';
                    
                    // Populate options dynamically
                    data.models.forEach(model => {
                        const option = document.createElement('option');
                        option.value = model.id;
                        // Example output: "Gemini 3.8 Flash (Context: 1M)"
                        option.textContent = `${model.name} (${T('Context: {n}k', { n: Math.round(model.context / 1000) })})`;
                        cloudModelSelect.appendChild(option);
                    });

                    // Restore user's previous selection or default to the first cheap model
                    cloudModelSelect.value = storageData.preferredCloudModel || data.models[0].id;
                } else {
                    throw new Error("Empty model array received");
                }
            })
            .catch(err => {
                console.error("Failed to populate dynamic openrouter roster:", err);
                cloudModelSelect.innerHTML = '<option value="google/gemini-3.8-flash">Gemini 3.8 Flash (' + escapeHtml(T('Fallback')) + ')</option>';
            });

        // Retain auto-save trigger on user selection change
        cloudModelSelect.addEventListener('change', () => {
            autoSave('preferredCloudModel', cloudModelSelect.value);
        });
    }

    if (licenseKeyInput) {
        licenseKeyInput.value = storageData[SK.licenseKey] || '';
    }

    const refreshLicenseUIStatus = (status, isValid = false) => {
        if (!licenseStatusLabel) return;
        licenseStatusLabel.textContent = status;
        if (isValid) {
            licenseStatusLabel.style.color = '#fff';
            licenseStatusLabel.style.background = 'var(--success, #2ecc40)';
        } else {
            licenseStatusLabel.style.color = 'var(--text-muted, #889999)';
            licenseStatusLabel.style.background = 'rgba(0,0,0,0.2)';
        }
    };

    // Initialize display state of active token if it exists
    if (storageData[SK.licenseKey]) {
        refreshLicenseUIStatus(T('Pro Active ✓'), true);
    } else {
        refreshLicenseUIStatus(T('Free Trial Mode'));
    }

    // Handshake execution with api.byphil.eu
    if (verifyLicenseBtn && licenseKeyInput) {
        verifyLicenseBtn.addEventListener('click', async () => {
            const inputKey = licenseKeyInput.value.trim();
            if (!inputKey) {
                alert(T('Please enter a license key.'));
                return;
            }

            verifyLicenseBtn.disabled = true;
            verifyLicenseBtn.textContent = T('Verifying...');

            try {
                const response = await fetch(`${StorageManager.getApiBase()}/v1/projects/ai_summary_helper/license/verify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ license_key: inputKey })
                });

                const resData = await response.json();

                if (response.ok && resData.valid && resData.status === 'active') {
                    await StorageManager.set({ [SK.licenseKey]: inputKey });
                    refreshLicenseUIStatus(T('Pro Active ✓'), true);
                    flashSaveIndicator();
                } else {
                    alert(T('Invalid or deactivated license key. Check your subscription parameters.'));
                    refreshLicenseUIStatus(T('Invalid Key'));
                }
            } catch (err) {
                console.error('License authorization handshake broke down:', err);
                alert(T('Infrastructural link execution failed. Ensure network connection to gateway.'));
            } finally {
                verifyLicenseBtn.disabled = false;
                verifyLicenseBtn.textContent = T('Activate');
            }
        });
    }

    // ── 3. Initialize Developer Mode Settings (Legacy Elements) ─────
    modelSelect.innerHTML = '';
    services.forEach(service => {
        const option = document.createElement('option');
        option.value = service.id;
        option.textContent = service.name;
        modelSelect.appendChild(option);
    });

    let activeService = storageData.activeService || 'openai';
    if (!services.some(s => s.id === activeService)) {
        activeService = services[0]?.id;
        if (activeService) await StorageManager.set({ activeService });
    }
    modelSelect.value = activeService;

    const updateFields = async (serviceId) => {
        const service = services.find(s => s.id === serviceId);
        const latest = await StorageManager.getAll();
        const cfg = latest[SK.servicesConfig]?.[serviceId] || {};

        const apiKeyLink = document.getElementById('apiKeyLink');
        if (apiKeyLink) {
            apiKeyLink.innerHTML = service?.apiKeyDocumentationUrl
                ? `(<a href="${service.apiKeyDocumentationUrl}" target="_blank">${escapeHtml(T('Get Key'))}</a>)`
                : '';
        }

        // Keyless providers (Ollama): no API key field at all.
        const apiKeyContainer = document.getElementById('apiKeyContainer');
        if (apiKeyContainer) apiKeyContainer.style.display = service?.apiKeyOptional ? 'none' : '';

        const customEndpointContainer = document.getElementById('customEndpointContainer');
        if (customEndpointContainer) {
            customEndpointContainer.style.display = service?.allowCustomEndpoint ? 'block' : 'none';
        }

        renderOllamaTutorial(serviceId);

        if (apiKeyInput) apiKeyInput.value = cfg.apiKey || '';
        if (endpointInput) endpointInput.value = cfg.endpoint || service?.endpointUrl || '';

        updateModelIdentifierUI(serviceId, services, latest);
    };

    modelSelect.addEventListener('change', async () => {
        const selectedId = modelSelect.value;
        await autoSave('activeService', selectedId);
        await updateFields(selectedId);
    });

    if (apiKeyInput) {
        apiKeyInput.addEventListener('change', () => {
            StorageManager.updateService(modelSelect.value, { apiKey: apiKeyInput.value });
        });
    }

    if (endpointInput) {
        endpointInput.addEventListener('change', () => {
            StorageManager.updateService(modelSelect.value, { endpoint: endpointInput.value });
        });
    }

    await updateFields(activeService);
}

// ── Section: General Settings ────────────────────────────────────────
function initGeneralSettings(storageData) {
    // ── Theme + display & reading preferences (profiles + customize) ──
    const A11Y_KEYS = ['theme', 'textScale', 'lineSpacing', 'readableFont', 'reduceMotion'];
    const a11yState = { theme: storageData.theme || 'system', textScale: clampScale(storageData.textScale || 100), lineSpacing: storageData.lineSpacing === 'compact' || storageData.lineSpacing === 'relaxed' ? storageData.lineSpacing : 'normal', readableFont: !!storageData.readableFont, reduceMotion: !!storageData.reduceMotion };
    // Every profile states all the values it controls, so switching profiles never keeps a leftover
    // (e.g. High contrast theme or Reduce motion from the previous profile).
    const leaveContrast = () => (a11yState.theme === 'contrast' ? 'system' : a11yState.theme);
    const PROFILES = {
        default: () => ({ theme: leaveContrast(), textScale: 100, lineSpacing: 'normal', readableFont: false, reduceMotion: false }),
        large: () => ({ theme: leaveContrast(), textScale: 125, lineSpacing: 'relaxed', reduceMotion: false }),
        contrast: () => ({ theme: 'contrast', textScale: 100, lineSpacing: 'normal', reduceMotion: false }),
        calm: () => ({ theme: leaveContrast(), textScale: 100, lineSpacing: 'normal', reduceMotion: true })
    };
    const activeProfile = () => {
        const s = a11yState;
        if (s.theme === 'contrast') return 'contrast';
        if (s.textScale >= 125 && s.lineSpacing === 'relaxed') return 'large';
        if (s.reduceMotion && s.textScale === 100 && s.lineSpacing === 'normal' && !s.readableFont) return 'calm';
        if (s.textScale === 100 && s.lineSpacing === 'normal' && !s.readableFont && !s.reduceMotion) return 'default';
        return '';
    };
    const $id = (id) => document.getElementById(id);
    const sysMotion = systemReducesMotion();
    const themeName = () => ({ light: T('Light Mode'), dark: T('Dark Mode'), contrast: T('High contrast') }[a11yState.theme] || (systemTheme() === 'dark' ? T('Dark Mode') : T('Light Mode')));
    const paintSeg = (id, v) => { const el = $id(id); if (!el) return; el.querySelectorAll('[role=radio]').forEach(b => { const on = b.dataset.value === v; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }); };
    const syncUi = () => {
        paintSeg('themeSeg', a11yState.theme); paintSeg('lineSeg', a11yState.lineSpacing);
        const th = $id('themeHint'); if (th) th.textContent = a11yState.theme === 'system' ? T('Currently following your system: {theme}').replace('{theme}', themeName()) : '';
        const sr = $id('textScaleRange'); if (sr) sr.value = String(a11yState.textScale);
        const sv = $id('textScaleValue'); if (sv) sv.textContent = a11yState.textScale + '%';
        if (sr) sr.style.setProperty('--range-progress', ((a11yState.textScale - 85) / (150 - 85) * 100) + '%');
        const ft = $id('readableFontToggle'); if (ft) ft.checked = a11yState.readableFont;
        const mt = $id('reduceMotionToggle'); if (mt) mt.checked = a11yState.reduceMotion || sysMotion;
        const mh = $id('motionHint'); if (mh) mh.textContent = sysMotion ? T('Your system already asks for reduced motion — it is always respected.') : T('Currently following your system: off');
        const cur = activeProfile();
        document.querySelectorAll('#profileList [role=radio]').forEach(b => { const on = b.dataset.profile === cur; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
        const st = $id('a11yStatus');
        if (st) {
            const sum = [themeName(), (a11yState.reduceMotion || sysMotion) ? T('Motion reduced') : T('Motion on'), a11yState.textScale + '%'].join(' · ');
            st.textContent = '✓ ' + (cur === 'default' && a11yState.theme === 'system' ? T('Following your system: {summary}') : T('Your settings: {summary}')).replace('{summary}', sum);
        }
        applyA11y({ ...a11yState, theme: a11yState.theme === 'system' ? '' : a11yState.theme });
    };
    const setA11y = (patch, persist = true) => {
        const changed = A11Y_KEYS.filter(k => k in patch && patch[k] !== a11yState[k]);
        Object.assign(a11yState, patch);
        syncUi();
        if (persist) changed.forEach(k => autoSave(k, a11yState[k]));
    };
    // Segmented controls (radiogroups) with arrow-key support
    const seg = (id, onPick) => {
        const el = $id(id); if (!el) return;
        const btns = [...el.querySelectorAll('[role=radio]')];
        btns.forEach((b, i) => {
            b.addEventListener('click', () => onPick(b.dataset.value));
            b.addEventListener('keydown', (e) => {
                const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
                if (!d) return;
                e.preventDefault(); const n = btns[(i + d + btns.length) % btns.length]; n.focus(); n.click();
            });
        });
    };
    seg('themeSeg', (v) => setA11y({ theme: v }));
    seg('lineSeg', (v) => setA11y({ lineSpacing: v }));
    document.querySelectorAll('#profileList [role=radio]').forEach(b => b.addEventListener('click', () => setA11y((PROFILES[b.dataset.profile] || (() => ({})))())));
    const scaleRange = $id('textScaleRange');
    if (scaleRange) {
        scaleRange.addEventListener('input', () => setA11y({ textScale: clampScale(scaleRange.value) }, false));
        scaleRange.addEventListener('change', () => autoSave('textScale', a11yState.textScale));
    }
    const fontToggle = $id('readableFontToggle');
    if (fontToggle) fontToggle.addEventListener('change', () => setA11y({ readableFont: fontToggle.checked }));
    const motionToggle = $id('reduceMotionToggle');
    if (motionToggle) motionToggle.addEventListener('change', () => setA11y({ reduceMotion: motionToggle.checked }));
    syncUi();
    // Customize opens by itself when the current values are not one of the profiles
    const customEl = $id('a11yCustom');
    if (customEl && !activeProfile()) customEl.open = true;

    // ── UI Language ────────────────────────────────────────────────
    const uiLangSelect = document.getElementById('uiLangSelect');
    if (uiLangSelect) {
        const savedUiLang = storageData.uiLanguage || '';
        if (savedUiLang && ![...uiLangSelect.options].some(o => o.value === savedUiLang)) {
            // Language no longer offered (not actively maintained): keep it
            // visible for people who already picked it, so the control isn't blank.
            const legacy = document.createElement('option');
            legacy.value = savedUiLang;
            legacy.textContent = ({ ar: 'العربية', it: 'Italiano', ru: 'Русский', bn: 'বাংলা' }[savedUiLang] || savedUiLang) + ' (' + T('no longer updated') + ')';
            uiLangSelect.appendChild(legacy);
        }
        uiLangSelect.value = savedUiLang;
        uiLangSelect.addEventListener('change', async () => {
            const val = uiLangSelect.value;
            await autoSave('uiLanguage', val);
            try {
                const { applyTranslations } = await import('./i18n.js');
                applyTranslations(val);
            } catch (e) {
                console.error('Translation failed', e);
            }
        });
    }

    // ── Native Side Panel ──────────────────────────────────────────
    const nativeToggle = document.getElementById('nativeSidePanelToggle');
    if (nativeToggle) {
        nativeToggle.checked = !!storageData.useNativeSidePanel;
        nativeToggle.addEventListener('change', () => {
            autoSave('useNativeSidePanel', nativeToggle.checked);
        });
    }

    // ── Highlighting Toggles (separate features) ───────────────────
    const highlightToggle = document.getElementById('highlightingToggle');
    const aiHighlightToggle = document.getElementById('aiHighlightingToggle');
    const legacyHighlighting = storageData.highlightingEnabled !== false;

    const getUserHighlightValue = () => {
        if (highlightToggle) return !!highlightToggle.checked;
        return storageData.userHighlightingEnabled !== undefined
            ? storageData.userHighlightingEnabled !== false
            : legacyHighlighting;
    };

    const getAiHighlightValue = () => {
        if (aiHighlightToggle) return !!aiHighlightToggle.checked;
        return storageData.aiHighlightingEnabled !== undefined
            ? storageData.aiHighlightingEnabled !== false
            : legacyHighlighting;
    };

    const persistHighlightingSettings = async (key, value) => {
        const payload = {
            [key]: value,
            // Backward compatibility key for older builds.
            highlightingEnabled: getUserHighlightValue() && getAiHighlightValue()
        };
        await StorageManager.set(payload);
        flashSaveIndicator();
    };

    if (highlightToggle) {
        highlightToggle.checked = storageData.userHighlightingEnabled !== undefined
            ? storageData.userHighlightingEnabled !== false
            : legacyHighlighting;
        highlightToggle.addEventListener('change', () => {
            persistHighlightingSettings('userHighlightingEnabled', highlightToggle.checked);
        });
    }

    if (aiHighlightToggle) {
        aiHighlightToggle.checked = storageData.aiHighlightingEnabled !== undefined
            ? storageData.aiHighlightingEnabled !== false
            : legacyHighlighting;
        aiHighlightToggle.addEventListener('change', () => {
            persistHighlightingSettings('aiHighlightingEnabled', aiHighlightToggle.checked);
        });
    }

    // ── AI Ghost Highlight Amount ────────────────────────────────
    const ghostHighlightAmount = document.getElementById('ghostHighlightAmount');
    if (ghostHighlightAmount) {
        ghostHighlightAmount.value = storageData.ghostHighlightAmount || 'regular';
        ghostHighlightAmount.addEventListener('change', () => {
            autoSave('ghostHighlightAmount', ghostHighlightAmount.value);
        });
    }

    // ── Sites where the on-page highlights panel stays hidden ─────
    const excludedSites = document.getElementById('highlightExcludedSites');
    if (excludedSites) {
        const list = Array.isArray(storageData.highlightExcludedSites) ? storageData.highlightExcludedSites : [];
        excludedSites.value = list.join('\n');
        excludedSites.addEventListener('change', () => {
            const hosts = excludedSites.value.split(/[\s,]+/)
                .map(h => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))
                .filter(Boolean);
            autoSave('highlightExcludedSites', [...new Set(hosts)]);
        });
    }
}

// ── Section: Bookmarklet Generator ───────────────────────────────────
// Generates a self-contained bookmarklet that embeds the user's byphil
// Cloud token. Bookmarklets run in the page context and cannot access
// chrome.storage, so the token must be baked into the JS string at
// generation time.
function initBookmarkletGenerator() {
    const generateBtn = document.getElementById('generateBookmarkletBtn');
    const resultContainer = document.getElementById('bookmarkletResultContainer');
    const dragLink = document.getElementById('bookmarkletDragLink');

    if (!generateBtn || !resultContainer || !dragLink) return;

    generateBtn.addEventListener('click', async () => {
        const data = await StorageManager.getAll();
        const token = data[SK.token];

        if (!token) {
            alert(T('⚠️ You must be logged into byphil Cloud first to generate a bookmarklet.'));
            return;
        }

        // Minified payload with the token injected. The token is embedded
        // directly so the bookmarklet can authenticate without storage access.
        const js = (str) => JSON.stringify(String(str)).replace(/</g, '\\u003c');
        const rawJs = `
            (async function(){
                const t='${token}';
                const d=document;
                const ui=d.createElement('div');
                ui.style.cssText='position:fixed;top:20px;right:20px;width:350px;max-height:80vh;overflow-y:auto;background:#fff;color:#171717;z-index:999999;padding:16px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,0.2);font-family:sans-serif;font-size:14px;line-height:1.5;';
                ui.innerHTML='<b>✨ AI Summary Helper</b><br><span id="as-st">'+${js(escapeHtml(T('Reading page...')))}+'</span><br><button id="as-cl" style="margin-top:10px;padding:4px 8px;border:none;background:#eee;border-radius:4px;cursor:pointer;">'+${js(escapeHtml(T('Close')))}+'</button>';
                d.body.appendChild(ui);
                d.getElementById('as-cl').onclick=()=>ui.remove();
                try{
                    const text=d.body.innerText.substring(0,15000);
                    d.getElementById('as-st').innerText=${js(T('Summarizing...'))};
                    const r=await fetch('https://api.byphil.eu/v1/projects/ai_summary_helper/chat',{
                        method:'POST',
                        headers:{'Content-Type':'application/json','Authorization':'Bearer '+t},
                        body:JSON.stringify({
                            model:'google/gemini-3.8-flash',
                            messages:[
                                {role:'system',content:'You are a summarizer returning concise, useful summaries.'},
                                {role:'user',content:'- brief summary\\n- key takeaways\\n\\nContent: '+text}
                            ]
                        })
                    });
                    if(!r.ok) throw new Error(r.status===401?${js(T('Session expired. Generate a new bookmarklet.'))}:${js(T('API Error:'))}+' '+r.status);
                    const j=await r.json();
                    const s=j.result?.choices?.[0]?.message?.content||j.choices?.[0]?.message?.content||j.summary||${js(T('No summary returned.'))};
                    const html=s.replace(/\\*\\*(.*?)\\*\\*/g,'<b>$1</b>').replace(/\\n/g,'<br>');
                    d.getElementById('as-st').innerHTML='<div style="margin-top:8px;padding-top:8px;border-top:1px solid #eee;">'+html+'</div>';
                }catch(e){
                    d.getElementById('as-st').innerText='❌ '+${js(T('Error:'))}+' '+e.message;
                }
            })();
        `;

        // Build the final bookmarklet URL (URL-encoded so special chars don't break it)
        const bookmarkletUrl = 'javascript:' + encodeURIComponent(rawJs.replace(/\s+/g, ' ').trim());

        dragLink.href = bookmarkletUrl;
        resultContainer.style.display = 'block';
    });
}

// ── Section: Summary Length Slider ───────────────────────────────────
function initSummaryLengthSlider() {
    const slider = document.getElementById('summaryLength');
    const valueDisplay = document.getElementById('summaryLengthValue');
    const chipLabel = document.getElementById('chipLengthLabel');
    if (!slider || !valueDisplay) return;

    chrome.storage.local.get([SK.summaryLength], (data) => {
        const length = data[SK.summaryLength] || 200;
        slider.value = length;
        valueDisplay.textContent = length;
        slider.dispatchEvent(new Event('input'));
    });

    slider.addEventListener('input', () => {
        const newLength = slider.value;
        valueDisplay.textContent = newLength;
        if (chipLabel) chipLabel.textContent = newLength + 'w';
        chrome.storage.local.set({ [SK.summaryLength]: Number(newLength) });
    });
}

// ── Section: Send-target devices (Kindle emails, LocalSend receivers) ──
// Each device is {id, label, type: 'kindle'|'localsend', addresses: [...]}
// — a single generic shape shared by both delivery methods (see
// StorageManager.migrateDeviceSettings / getActiveDevice). Multiple devices
// per type can be configured; the ★'d one is the active send target,
// updated automatically to whichever device a send last used.
function initLocalSendSettings(storageData) {
    const scanBtn = document.getElementById('scanLocalSendButton');
    const statusLabel = document.getElementById('localSendStatus');
    const deliveryPreferenceSelect = document.getElementById('deliveryPreference');
    const kindleConfigBlock = document.getElementById('kindleDeliveryConfig');
    const localSendConfigBlock = document.getElementById('localSendDeliveryConfig');
    const kindleDeviceList = document.getElementById('kindleDeviceList');
    const localSendDeviceList = document.getElementById('localSendDeviceList');
    const newKindleLabel = document.getElementById('newKindleLabel');
    const newKindleEmail = document.getElementById('newKindleEmail');
    const addKindleDeviceButton = document.getElementById('addKindleDeviceButton');
    const newLocalSendLabel = document.getElementById('newLocalSendLabel');
    const newLocalSendIp = document.getElementById('newLocalSendIp');
    const addLocalSendDeviceButton = document.getElementById('addLocalSendDeviceButton');

    if (!localSendDeviceList) return;

    // devices is mutated in place and persisted after every add/remove/
    // activate, then re-rendered from that same in-memory copy — avoids a
    // re-fetch from storage after each change.
    let devices = Array.isArray(storageData[SK.devices]) ? [...storageData[SK.devices]] : [];
    let activeDeviceIds = { ...(storageData[SK.activeDevices] || {}) };

    const persistDevices = () => autoSave(SK.devices, devices);
    const persistActiveIds = () => autoSave(SK.activeDevices, activeDeviceIds);

    const addressLabel = (device) => {
        const addr = device.addresses?.[0] || '';
        return device.type === 'kindle' ? addr.replace(/^mailto:/i, '') : addr.replace(/^https?:\/\//i, '');
    };

    const renderDeviceList = (type, container) => {
        const list = devices.filter(d => d.type === type);
        if (list.length === 0) {
            container.innerHTML = `<div style="font-size:11px;color:var(--text-muted);">${T('No devices added yet.')}</div>`;
            return;
        }
        container.innerHTML = list.map(d => {
            const isActive = activeDeviceIds[type] === d.id || (!activeDeviceIds[type] && list[0].id === d.id);
            return `
                <div class="device-row" data-id="${d.id}" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--outline);border-radius:6px;background:var(--glass-input);">
                    <button type="button" class="device-active-btn" data-type="${type}" title="${escapeHtml(isActive ? T('Active send target') : T('Set as active send target'))}" style="background:none;border:none;cursor:pointer;font-size:14px;padding:0;line-height:1;color:${isActive ? '#f5b301' : 'var(--text-muted)'};">${isActive ? '★' : '☆'}</button>
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${d.label || (type === 'kindle' ? 'Kindle' : T('Device'))}</div>
                        <div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${addressLabel(d)}</div>
                    </div>
                    <button type="button" class="device-delete-btn" title="${escapeHtml(T('Remove device'))}" style="background:none;border:none;cursor:pointer;font-size:13px;opacity:0.6;padding:0;line-height:1;">🗑</button>
                </div>`;
        }).join('');

        container.querySelectorAll('.device-active-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                activeDeviceIds[type] = btn.closest('.device-row').dataset.id;
                persistActiveIds();
                renderDeviceList(type, container);
            });
        });
        container.querySelectorAll('.device-delete-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.closest('.device-row').dataset.id;
                devices = devices.filter(d => d.id !== id);
                if (activeDeviceIds[type] === id) delete activeDeviceIds[type];
                persistDevices();
                persistActiveIds();
                renderDeviceList(type, container);
            });
        });
    };

    const addDevice = (type, label, address) => {
        const id = `device_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        devices.push({ id, label: label || (type === 'kindle' ? 'Kindle' : T('Device')), type, addresses: [address] });
        // First device of its type becomes active automatically.
        if (!activeDeviceIds[type]) activeDeviceIds[type] = id;
        persistDevices();
        persistActiveIds();
        renderDeviceList(type, type === 'kindle' ? kindleDeviceList : localSendDeviceList);
    };

    renderDeviceList('kindle', kindleDeviceList);
    renderDeviceList('localsend', localSendDeviceList);

    if (addKindleDeviceButton) {
        addKindleDeviceButton.addEventListener('click', () => {
            const email = (newKindleEmail?.value || '').trim();
            if (!email) return;
            addDevice('kindle', (newKindleLabel?.value || '').trim(), `mailto:${email}`);
            if (newKindleLabel) newKindleLabel.value = '';
            if (newKindleEmail) newKindleEmail.value = '';
        });
    }

    const applyDeliveryModeVisibility = (mode) => {
        if (kindleConfigBlock) {
            kindleConfigBlock.style.display = mode === 'kindle' ? 'block' : 'none';
        }
        if (localSendConfigBlock) {
            localSendConfigBlock.style.display = mode === 'localsend' ? 'block' : 'none';
        }
    };

    if (deliveryPreferenceSelect) {
        const currentMode = storageData.deliveryPreference === 'localsend' ? 'localsend' : 'kindle';
        deliveryPreferenceSelect.value = currentMode;
        applyDeliveryModeVisibility(currentMode);

        // Migrate old value 'both' to exclusive default 'kindle'.
        if (storageData.deliveryPreference === 'both') {
            autoSave('deliveryPreference', 'kindle');
        }

        deliveryPreferenceSelect.addEventListener('change', () => {
            const selected = deliveryPreferenceSelect.value === 'localsend' ? 'localsend' : 'kindle';
            applyDeliveryModeVisibility(selected);
            autoSave('deliveryPreference', selected);
        });
    } else {
        applyDeliveryModeVisibility('kindle');
    }

    if (addLocalSendDeviceButton) {
        addLocalSendDeviceButton.addEventListener('click', () => {
            const raw = (newLocalSendIp?.value || '').trim();
            if (!raw) return;
            const address = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
            addDevice('localsend', (newLocalSendLabel?.value || '').trim(), address);
            if (newLocalSendLabel) newLocalSendLabel.value = '';
            if (newLocalSendIp) newLocalSendIp.value = '';
            if (statusLabel) statusLabel.textContent = '';
        });
    }

    if (scanBtn) {
        scanBtn.addEventListener('click', async () => {
            scanBtn.disabled = true;
            scanBtn.textContent = T('Scanning...');

            if (statusLabel) {
                statusLabel.textContent = T('Searching LAN for LocalSend receiver...');
                statusLabel.style.color = 'var(--text-muted)';
            }

            try {
                const foundIp = await discoverLocalSendDevice();
                if (foundIp) {
                    if (newLocalSendIp) newLocalSendIp.value = foundIp;
                    if (statusLabel) {
                        statusLabel.textContent = T('Found device at {ip} — click Add to save it ✓', { ip: foundIp });
                        statusLabel.style.color = '#2ecc40';
                    }
                } else if (statusLabel) {
                    statusLabel.textContent = T('No active receiver found.');
                    statusLabel.style.color = 'var(--text-muted)';
                }
            } catch (err) {
                console.error('LocalSend scan failed:', err);
                if (statusLabel) {
                    statusLabel.textContent = T('Scan failed. Enter IP manually.');
                    statusLabel.style.color = 'var(--danger, #dc2626)';
                }
            } finally {
                scanBtn.disabled = false;
                scanBtn.textContent = T('Auto-Detect');
            }
        });
    }
}

async function discoverLocalSendDevice() {
    const localIp = await getLocalSubnetIp();
    if (!localIp) return null;

    const PORT = 53317;
    const prefix = localIp.substring(0, localIp.lastIndexOf('.'));
    const candidates = [];
    for (let i = 1; i < 255; i++) candidates.push(`${prefix}.${i}`);

    const batchSize = 24;
    for (let start = 0; start < candidates.length; start += batchSize) {
        const batch = candidates.slice(start, start + batchSize);
        const results = await Promise.all(batch.map(ip => probeLocalSendInfo(ip, PORT)));
        const found = results.find(Boolean);
        if (found) return found;
    }

    return null;
}

function probeLocalSendInfo(targetIp, port) {
    return new Promise((resolve) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => {
            controller.abort();
            resolve(null);
        }, 1100);

        // Probe KOReader-compatible HTTP first, then HTTPS; check both v2 and v1 routes.
        const probeInfo = async () => {
            const protocols = ['http', 'https'];
            const versions = ['v2', 'v1'];

            for (const protocol of protocols) {
                for (const version of versions) {
                    const data = await fetch(`${protocol}://${targetIp}:${port}/api/localsend/${version}/info`, {
                        method: 'GET',
                        signal: controller.signal
                    }).then(res => (res.ok ? res.json() : null)).catch(() => null);

                    if (data) {
                        return { data, protocol };
                    }
                }
            }

            return null;
        };

        probeInfo()
            .then(result => {
                clearTimeout(timeout);
                if (result?.data && (result.data.alias || result.data.deviceModel || result.data.version)) {
                    resolve(`${result.protocol}://${targetIp}`);
                } else {
                    resolve(null);
                }
            })
            .catch(() => {
                clearTimeout(timeout);
                resolve(null);
            });
    });
}

function getLocalSubnetIp() {
    return new Promise((resolve) => {
        try {
            const pc = new RTCPeerConnection({ iceServers: [] });
            pc.createDataChannel('');

            const timeout = setTimeout(() => {
                try { pc.close(); } catch (_) {}
                resolve('192.168.1.1');
            }, 1200);

            pc.onicecandidate = (ice) => {
                const cand = ice?.candidate?.candidate;
                if (!cand) return;
                const match = /([0-9]{1,3}(?:\.[0-9]{1,3}){3})/.exec(cand);
                const myIp = match?.[1];
                if (myIp && (myIp.startsWith('192.168.') || myIp.startsWith('10.') || myIp.startsWith('172.'))) {
                    clearTimeout(timeout);
                    try { pc.close(); } catch (_) {}
                    resolve(myIp);
                }
            };

            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .catch(() => {
                    clearTimeout(timeout);
                    try { pc.close(); } catch (_) {}
                    resolve('192.168.1.1');
                });
        } catch (_) {
            resolve('192.168.1.1');
        }
    });
}

// ── Section: On-Device Intelligence (tag cleanup) ────────────────────
// The per-save tag normalization in content.js only handles known
// alias->canonical mapping. Merging near-duplicate tags that emerged
// organically across the whole archive (typos, "Podcast" vs "Podcasts",
// "ML" vs "Machine Learning") needs the full tag vocabulary, so it runs
// as an explicit, on-demand maintenance pass rather than on every save.
function initLocalIntelligence() {
    const btn = document.getElementById('cleanupTagsButton');
    const resultEl = document.getElementById('cleanupTagsResult');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        btn.disabled = true;
        const originalLabel = btn.textContent;
        btn.textContent = '🧹 ' + T('Analyzing tags…');
        if (resultEl) resultEl.style.display = 'none';

        try {
            // Tags live entirely in articlesIndex post-migration — this pass
            // never needs to touch per-article content.
            const articles = await StorageManager.getArticlesIndex({ includeArchived: true });

            if (articles.length === 0) {
                if (resultEl) { resultEl.textContent = T('No articles saved yet.'); resultEl.style.display = 'block'; }
                return;
            }

            const canonicalMap = buildCanonicalTagMap(articles);
            let changedArticles = 0;
            let tagsMerged = 0;

            const updated = articles.map(article => {
                const before = article.tags || [];
                const after = applyCanonicalTags(before, canonicalMap);
                const beforeKey = before.map(t => t.toLowerCase()).sort().join('|');
                const afterKey = after.map(t => t.toLowerCase()).sort().join('|');
                if (beforeKey !== afterKey) {
                    changedArticles++;
                    tagsMerged += Math.max(0, before.length - after.length);
                }
                return { ...article, tags: after };
            });

            await StorageManager.setLocal({ [SK.articlesIndex]: updated });

            if (resultEl) {
                resultEl.textContent = changedArticles > 0
                    ? T('✓ Updated {a}, merged {b}.', { a: TN(changedArticles, '{n} article', '{n} articles'), b: TN(tagsMerged, '{n} duplicate tag', '{n} duplicate tags') })
                    : T('✓ Tags already look consistent — nothing to merge.');
                resultEl.style.display = 'block';
            }
        } catch (err) {
            console.error('[AISH] Tag cleanup failed:', err);
            if (resultEl) { resultEl.textContent = T('Something went wrong — please try again.'); resultEl.style.display = 'block'; }
        } finally {
            btn.disabled = false;
            btn.textContent = originalLabel;
        }
    });
}

// ── Section: Danger Zone ─────────────────────────────────────────────
function initDangerZone() {
    const btnSettings = document.getElementById('deleteSettingsButton');
    const btnHistory = document.getElementById('deleteHistoryButton');

    if (btnSettings) {
        btnSettings.addEventListener('click', async () => {
            const yes = await confirmDestructive({
                title: T('Delete all settings?'),
                body: T('This resets every preference, prompt and API key on this device. Your summaries stay. The extension will reload.'),
                confirmLabel: T('Delete settings')
            });
            if (!yes) return;
            await chrome.storage.sync.clear();
            chrome.runtime.reload();
        });
    }

    if (btnHistory) {
        btnHistory.addEventListener('click', async () => {
            const count = (await StorageManager.getArticlesIndex({ includeArchived: true }).catch(() => [])).length;
            const yes = await confirmDestructive({
                title: T('Delete all history?'),
                body: T('This permanently removes {what} and the archive from this device. This cannot be undone.', { what: count ? TN(count, '{n} summary', '{n} summaries') : T('all summaries') }),
                confirmLabel: T('Delete history'),
                extraLabel: T('Export backup first'),
                onExtra: () => { document.getElementById('exportSettingsButton')?.click(); }
            });
            if (!yes) return;
            // Deletes every article:<id> record too, not just the index —
            // a plain articlesIndex reset would leave every record
            // orphaned in storage.
            await StorageManager.clearAllArticles();
            btnHistory.textContent = T('History deleted ✓');
            setTimeout(() => { btnHistory.textContent = T('Delete history…'); }, 2500);
        });
    }
}

// ── Section: Backup & Restore ────────────────────────────────────────
function initBackupRestore() {
    const btnExport = document.getElementById('exportSettingsButton');
    const btnImport = document.getElementById('importSettingsButton');
    const fileInput = document.getElementById('importSettingsFile');

    // ── Export — settings-only or full backup ──
    if (btnExport) {
        // Build a small choice panel, hidden by default
        const choicePanel = document.createElement('div');
        choicePanel.style.cssText = `
            display:none; flex-direction:column; gap:6px;
            margin-top:8px; padding:10px;
            background:var(--glass-card); border:1px solid var(--glass-border);
            border-radius:var(--radius-md);
        `;
        choicePanel.innerHTML = `
            <p style="font-size:11px;font-weight:600;color:var(--text-secondary);margin:0 0 4px;">${T('What to export?')}</p>
            <button type="button" id="exportSettingsOnly" class="button-secondary" style="font-size:12px;justify-content:flex-start;">⚙️ ${T('Settings only')}</button>
            <button type="button" id="exportFullBackup"   class="button-secondary" style="font-size:12px;justify-content:flex-start;">📚 ${T('Settings + Article History')}</button>
        `;
        btnExport.parentElement.insertAdjacentElement('afterend', choicePanel);

        btnExport.addEventListener('click', () => {
            const isOpen = choicePanel.style.display === 'flex';
            choicePanel.style.display = isOpen ? 'none' : 'flex';
            btnExport.textContent = isOpen ? '📤 ' + T('Export') : '📤 ' + T('Export') + ' ▲';
        });

        const doExport = async (includeContent) => {
            choicePanel.style.display = 'none';
            btnExport.textContent = '📤 ' + T('Export');
            try {
                // Fetch cleanly separated sync and local data
                const [syncData, localData] = await Promise.all([
                    new Promise(resolve => chrome.storage.sync.get(null, resolve)),
                    new Promise(resolve => chrome.storage.local.get(null, resolve))
                ]);

                let backup, filename;
                const date = new Date().toISOString().split('T')[0].replace(/-/g, '');

                if (includeContent) {
                    // articlesIndex is the post-migration shape; the articles
                    // fallback only matters if exporting mid-transition,
                    // before migration has run in this session.
                    const count = (localData[SK.articlesIndex] || localData.articles || []).length;
                    backup = {
                        _backup_version: 3,   // 3 = registry key names (articles:index, feeds:*, account:* …); v2 (old names) still imports
                        _exported_at: new Date().toISOString(),
                        _article_count: count,
                        settings: syncData,
                        local: localData
                    };
                    filename = `aish_backup_${date}_${count}articles.json`;
                } else {
                    backup = {
                        _backup_version: 1,
                        _exported_at: new Date().toISOString(),
                        ...syncData
                    };
                    filename = `aish_settings_${date}.json`;
                }

                const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                const origText = btnExport.textContent;
                btnExport.textContent = includeContent
                    ? T('Exported! ✓ ({n} articles)', { n: backup._article_count })
                    : T('Exported! ✓');
                setTimeout(() => btnExport.textContent = origText, 2500);
            } catch (err) {
                console.error('Export failed:', err);
                alert(T('Failed to export backup.'));
            }
        };

        // Wire up once the panel is injected (next tick)
        setTimeout(() => {
            document.getElementById('exportSettingsOnly')?.addEventListener('click', () => doExport(false));
            document.getElementById('exportFullBackup')?.addEventListener('click',   () => doExport(true));
        }, 0);
    }

    // ── Import (settings + article history) ──
    if (btnImport && fileInput) {
        btnImport.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const importedData = JSON.parse(e.target.result);

                    if (typeof importedData !== 'object' || Array.isArray(importedData)) {
                        throw new Error('Invalid format');
                    }

                    if (importedData._backup_version === 2 || importedData._backup_version === 3) {
                        // FIX: Leverage the new StorageManager routing
                        const settings = importedData.settings;
                        // v2 backups use the pre-registry key names → translate (no-op for v3)
                        const local = importedData.local ? renameKeys(importedData.local) : importedData.local;
                        if (settings) await StorageManager.set(renameKeys(settings));

                        if (local) {
                            if (Array.isArray(local.articles)) {
                                // Old-shape backup (pre-migration) — split it the
                                // same way the startup migration does, don't
                                // write the flat array back verbatim or every
                                // migrated screen will simply never see it again.
                                const { index, records } = StorageManager.splitArticlesArray(local.articles);
                                const { articles: _old, ...rest } = local; // drop the old key from the pass-through write
                                await StorageManager.set({ ...rest, [SK.articlesIndex]: index });

                                // Write per-article records in chunks rather than
                                // one call with hundreds of keys and all their
                                // content at once (same reasoning as the startup
                                // migration's chunked write).
                                const CHUNK_SIZE = 25;
                                const recordKeys = Object.keys(records);
                                for (let i = 0; i < recordKeys.length; i += CHUNK_SIZE) {
                                    const chunk = {};
                                    recordKeys.slice(i, i + CHUNK_SIZE).forEach(k => chunk[k] = records[k]);
                                    await StorageManager.setLocal(chunk);
                                }
                            } else {
                                await StorageManager.set(local); // already new-shape
                            }
                        }

                        const count = (local?.[SK.articlesIndex] || local?.articles || []).length;
                        alert(T('Backup restored successfully!\n{n} articles imported.\n\nThe extension will now reload.', { n: count }));
                    } else {
                        // Legacy v1 backup — settings only
                        // Safe to use StorageManager.set() since it routes automatically
                        await StorageManager.set(renameKeys(importedData));
                        alert(T('Settings imported successfully! The extension will now reload.'));
                    }

                    chrome.runtime.reload();
                } catch (err) {
                    console.error('Import failed:', err);
                    alert(T('Invalid backup file. Please select a valid AI Summary Helper export.'));
                } finally {
                    fileInput.value = '';
                }
            };

            reader.readAsText(file);
        });
    }
}
