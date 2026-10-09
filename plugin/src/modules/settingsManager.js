import { applyA11y, clampScale, systemTheme, systemReducesMotion } from './a11y.js';
import { SK, renameKeys } from './storageKeys.js';
import { supportsNativeSidePanel } from './extensionApi.js';
// settingsManager.js
// Settings screen initialization — UI is in popup.html (static accordion),
// this file handles logic, auto-save, and wiring event listeners.

import { confirmDestructive } from './confirmDialog.js';
import { deleteData, describeData } from './dataReset.js';
import StorageManager from './storageManager.js';
import { initPromptSettings } from './promptSettings.js';
import { updateModelIdentifierUI } from './modelManager.js';
import { initAuthManager } from './authManager.js';
import { buildCanonicalTagMap, applyCanonicalTags } from './tagIntelligence.js';
import { escapeHtml } from './textUtils.js';
import { T, TN } from './feedI18n.js';
import { checkOllama } from './ollamaCheck.js';

export async function initSettingsManager(ui) {
    const storageData = await StorageManager.getAll();

    // Initialize distinct sections independently (DOM is already in popup.html)
    initModelSettings(storageData);
    initGeneralSettings(storageData);
    initLocalSendSettings(storageData);
    initDangerZone();
    initBackupRestore();
    initLocalIntelligence();
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
            { title: T('Allow browser extensions'), body: T('Run this command. It lets extensions, and only extensions, talk to Ollama:'),
              code: 'launchctl setenv OLLAMA_ORIGINS "chrome-extension://*,moz-extension://*,safari-web-extension://*"' },
            { title: T('Restart Ollama'), body: T('Launch Ollama again from your Applications folder or Spotlight.') },
            { title: T('Make it permanent'), body: T('<code>launchctl setenv</code> is forgotten after a restart of your Mac. This login item sets it again every time:'),
              code: 'cat > ~/Library/LaunchAgents/com.ollama.origins.plist <<\'EOF\'\n<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>com.ollama.origins</string>\n<key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string>\n<string>launchctl setenv OLLAMA_ORIGINS "chrome-extension://*,moz-extension://*,safari-web-extension://*"</string></array>\n<key>RunAtLoad</key><true/>\n</dict></plist>\nEOF\nlaunchctl load ~/Library/LaunchAgents/com.ollama.origins.plist' },
            { title: T('Check it'), body: T('You should see <code>200</code>. A <code>403</code> means Ollama has not picked up the setting yet: quit it and start it again.'),
              code: 'curl -s -o /dev/null -w "%{http_code}\\n" http://localhost:11434/api/tags -H "Origin: chrome-extension://test"' },
            { title: T('Quick test (terminal)'), body: T('Only if the Ollama app is quit (otherwise you get “address already in use”; check with <code>lsof -i :11434</code> and stop it with <code>pkill -x ollama</code>). Runs Ollama in a foreground window:'),
              code: 'OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*,safari-web-extension://*" ollama serve' }
        ],
        note: T('Once Ollama restarts, the 403 Forbidden error from this extension is resolved.')
    },
    windows: {
        title: T('Set up Ollama on Windows'),
        steps: [
            { title: T('Quit Ollama'), body: T('Right-click the Ollama tray icon (bottom-right) and choose <b>Quit</b>.') },
            { title: T('Open Command Prompt'), body: T('Press <b>Win + R</b>, type <code>cmd</code> and press Enter.') },
            { title: T('Allow browser extensions'), body: T('Run this so Ollama accepts requests from browser extensions (permanent for your user account):'),
              code: 'setx OLLAMA_ORIGINS "chrome-extension://*,moz-extension://*,safari-web-extension://*"' },
            { title: T('Start Ollama'), body: T('Start Ollama again from the Start menu, or run it as a foreground server from a new Command Prompt window:'),
              code: 'ollama serve' }
        ],
        note: T('Once Ollama restarts, the 403 Forbidden error from your extension is fixed.')
    },
    linux: {
        title: T('Set up Ollama on Linux'),
        steps: [
            { title: T('Stop Ollama'), body: T('If running as a systemd service, stop it with <code>sudo systemctl stop ollama</code>.') },
            { title: T('Allow browser extensions (permanent)'), body: T('Open the service override with <code>sudo systemctl edit ollama.service</code> and add:'),
              code: '[Service]\nEnvironment="OLLAMA_ORIGINS=chrome-extension://*,moz-extension://*,safari-web-extension://*"' },
            { title: T('Restart the service'), body: T('Apply it:'),
              code: 'sudo systemctl daemon-reload && sudo systemctl restart ollama' },
            { title: T('Quick test (terminal)'), body: T('Without systemd, run Ollama in a foreground window:'),
              code: 'OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*,safari-web-extension://*" ollama serve' }
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

// Probes Ollama first: reachable → list installed models (click to use one);
// not reachable / refused / no models → prompt the user with the matching setup steps.
async function renderOllamaTutorial(serviceId, endpoint, onPickModel) {
    const container = document.getElementById('ollamaTutorialContainer');
    if (!container) return;
    const isOllama = (serviceId || '').toLowerCase() === 'ollama';
    container.style.display = isOllama ? 'block' : 'none';
    container.innerHTML = '';

    if (!isOllama) return;

    const status = document.createElement('div');
    status.className = 'ollama-status';
    status.setAttribute('role', 'status');
    status.textContent = T('Checking Ollama…');
    container.appendChild(status);
    const guide = document.createElement('div');
    container.appendChild(guide);

    const run = async () => {
        status.textContent = T('Checking Ollama…');
        const result = await checkOllama(endpoint);
        if (!container.isConnected) return;
        status.innerHTML = '';
        const line = document.createElement('div');
        status.appendChild(line);
        if (result.ok && result.models.length) {
            line.textContent = '✓ ' + T('Ollama is running. Installed models — click one to use it:');
            const list = document.createElement('div');
            list.className = 'model-id-list';
            result.models.forEach(name => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'model-id-tag';
                // Long names (e.g. llamacpp:<sha256>) keep their start and end so they stay recognisable.
                b.textContent = name.length > 28 ? `${name.slice(0, 18)}…${name.slice(-8)}` : name;
                b.title = name;
                b.addEventListener('click', () => onPickModel && onPickModel(name));
                list.appendChild(b);
            });
            status.appendChild(list);
            guide.innerHTML = '';
        } else {
            if (result.ok) {
                line.textContent = '⚠️ ' + T('Ollama is running, but no model is installed yet. Download one in a terminal:');
                const pre = document.createElement('pre');
                pre.className = 'ollama-code';
                pre.textContent = 'ollama pull llama3.2';
                status.appendChild(pre);
            } else {
                line.textContent = '⚠️ ' + (result.reason === 'forbidden'
                    ? T('Ollama refused the request. A 403 usually means it must be told to accept requests from this extension (OLLAMA_ORIGINS).')
                    : T('Could not reach Ollama. Make sure it is running and the endpoint is correct.'));
            }
            renderGuide(guide);
        }
        const again = document.createElement('button');
        again.type = 'button';
        again.className = 'button-secondary';
        again.textContent = '↻ ' + T('Check again');
        again.addEventListener('click', run);
        status.appendChild(again);
    };
    run();
}

function renderGuide(container) {
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
    const modeOllamaRadio = document.getElementById('modeOllama');
    
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
    // Three tabs, two stored modes: byPhil Cloud = 'cloud'; Own key and Ollama are both 'local'
    // and differ only by activeService (Ollama is not listed among the own-key providers).
    const tabOf = (mode, service) => mode === 'cloud' ? 'cloud' : (service === 'ollama' ? 'ollama' : 'local');
    const currentMode = storageData.connectionMode || 'cloud';
    const currentTab = tabOf(currentMode, storageData.activeService);
    if (currentTab === 'cloud' && modeCloudRadio) modeCloudRadio.checked = true;
    if (currentTab === 'local' && modeLocalRadio) modeLocalRadio.checked = true;
    if (currentTab === 'ollama' && modeOllamaRadio) modeOllamaRadio.checked = true;
    let lastOwnKeyService = storageData.activeService && storageData.activeService !== 'ollama' ? storageData.activeService : '';

    const toggleConnectionContainers = (mode) => {
        const providerLabel = document.getElementById('providerLabel');
        const ollamaTab = mode === 'ollama';
        if (providerLabel) providerLabel.style.display = ollamaTab ? 'none' : '';
        modelSelect.style.display = ollamaTab ? 'none' : '';
        if (mode === 'cloud') {
            cloudModeContainer.style.display = 'block';
            developerModeContainer.style.display = 'none';
        } else {
            cloudModeContainer.style.display = 'none';
            developerModeContainer.style.display = 'block';
        }
    };
    toggleConnectionContainers(currentTab);

    const handleModeChange = async (e) => {
        const tab = e.target.value; // cloud | local | ollama
        await autoSave('connectionMode', tab === 'cloud' ? 'cloud' : 'local');
        toggleConnectionContainers(tab);
        if (tab === 'cloud') return;

        // Restore the provider that belongs to this tab so the panel doesn't fall back to a stale selection.
        const latest = await StorageManager.getAll();
        let target = 'ollama';
        if (tab === 'local') {
            const ownKey = (id) => id && id !== 'ollama' && Array.from(modelSelect.options).some(o => o.value === id);
            target = [lastOwnKeyService, latest.activeService, modelSelect.value, 'openai'].find(ownKey) || modelSelect.options[0]?.value;
            modelSelect.value = target;
        }
        if (target) {
            await autoSave('activeService', target);
            await updateFields(target);
        }
    };

    if (modeCloudRadio) modeCloudRadio.addEventListener('change', handleModeChange);
    if (modeLocalRadio) modeLocalRadio.addEventListener('change', handleModeChange);
    if (modeOllamaRadio) modeOllamaRadio.addEventListener('change', handleModeChange);

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
        licenseStatusLabel.classList.toggle('signed-in', !!isValid);
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
    services.filter(service => service.id !== 'ollama').forEach(service => {
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
    if (activeService !== 'ollama') modelSelect.value = activeService;

    let shownService = activeService; // provider whose fields are on screen (the select is hidden on the Ollama tab)
    const updateFields = async (serviceId) => {
        shownService = serviceId;
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

        renderOllamaTutorial(serviceId, cfg.endpoint || service?.endpointUrl, async (name) => {
            const entry = (await StorageManager.getAll())[SK.servicesConfig]?.[serviceId] || {};
            const list = (Array.isArray(entry.customModel) ? entry.customModel : (entry.customModel ? [entry.customModel] : []))
                .map(m => StorageManager.normalizeCustomModel(m, serviceId));
            if (!list.some(m => m.id === name)) list.push({ id: name, provider: serviceId });
            await StorageManager.updateService(serviceId, { customModel: list, activeModelId: { id: name, provider: serviceId } });
            updateModelIdentifierUI(serviceId, services, await StorageManager.getAll());
            flashSaveIndicator();
        });

        if (apiKeyInput) apiKeyInput.value = cfg.apiKey || '';
        if (endpointInput) endpointInput.value = cfg.endpoint || service?.endpointUrl || '';

        updateModelIdentifierUI(serviceId, services, latest);
    };

    modelSelect.addEventListener('change', async () => {
        const selectedId = modelSelect.value;
        lastOwnKeyService = selectedId;
        await autoSave('activeService', selectedId);
        await updateFields(selectedId);
    });

    if (apiKeyInput) {
        apiKeyInput.addEventListener('change', () => {
            StorageManager.updateService(shownService, { apiKey: apiKeyInput.value });
        });
    }

    if (endpointInput) {
        endpointInput.addEventListener('change', () => {
            StorageManager.updateService(shownService, { endpoint: endpointInput.value }).then(() => updateFields(shownService));
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
        if (!supportsNativeSidePanel()) { const blk = nativeToggle.closest('.a11y-block'); if (blk) blk.hidden = true; }   // Chrome-only option; Firefox has its own sidebar (View > Sidebar)
        nativeToggle.addEventListener('change', () => {
            autoSave('useNativeSidePanel', nativeToggle.checked);
        });
    }

    // ── Notify when the background queue finishes ──────────────────
    const notifyToggle = document.getElementById('notifyWhenDoneToggle');
    if (notifyToggle) {
        notifyToggle.checked = storageData.notifyWhenDone !== false;
        notifyToggle.addEventListener('change', () => autoSave('notifyWhenDone', notifyToggle.checked));
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
                    const html=String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\\*\\*(.*?)\\*\\*/g,'<b>$1</b>').replace(/\\n/g,'<br>');
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
            container.innerHTML = `<div class="device-empty">${T('No devices added yet.')}</div>`;
            return;
        }
        container.innerHTML = list.map(d => {
            const isActive = activeDeviceIds[type] === d.id || (!activeDeviceIds[type] && list[0].id === d.id);
            return `
                <div class="device-row${isActive ? ' is-active' : ''}" data-id="${escapeHtml(d.id)}">
                    <button type="button" class="device-active-btn" data-type="${escapeHtml(type)}" title="${escapeHtml(isActive ? T('Active send target') : T('Set as active send target'))}" aria-pressed="${isActive}">${isActive ? '★' : '☆'}</button>
                    <div class="device-text">
                        <div class="device-label">${escapeHtml(d.label || (type === 'kindle' ? 'Kindle' : T('Device')))}</div>
                        <div class="device-address">${escapeHtml(addressLabel(d))}</div>
                    </div>
                    <button type="button" class="device-delete-btn" title="${escapeHtml(T('Remove device'))}" aria-label="${escapeHtml(T('Remove device'))}">🗑</button>
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
                statusLabel.dataset.tone = '';
            }

            try {
                const foundIp = await discoverLocalSendDevice();
                if (foundIp) {
                    if (newLocalSendIp) newLocalSendIp.value = foundIp;
                    if (statusLabel) {
                        statusLabel.textContent = T('Found device at {ip} — click Add to save it ✓', { ip: foundIp });
                        statusLabel.dataset.tone = 'ok';
                    }
                } else if (statusLabel) {
                    statusLabel.textContent = T('No active receiver found.');
                    statusLabel.dataset.tone = '';
                }
            } catch (err) {
                console.error('LocalSend scan failed:', err);
                if (statusLabel) {
                    statusLabel.textContent = T('Scan failed. Enter IP manually.');
                    statusLabel.dataset.tone = 'error';
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
                try { pc.close(); } catch (_) { /* peer connection already closed */ }
                resolve('192.168.1.1');
            }, 1200);

            pc.onicecandidate = (ice) => {
                const cand = ice?.candidate?.candidate;
                if (!cand) return;
                const match = /([0-9]{1,3}(?:\.[0-9]{1,3}){3})/.exec(cand);
                const myIp = match?.[1];
                if (myIp && (myIp.startsWith('192.168.') || myIp.startsWith('10.') || myIp.startsWith('172.'))) {
                    clearTimeout(timeout);
                    try { pc.close(); } catch (_) { /* peer connection already closed */ }
                    resolve(myIp);
                }
            };

            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .catch(() => {
                    clearTimeout(timeout);
                    try { pc.close(); } catch (_) { /* peer connection already closed */ }
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
    // Link to the Feed library run (Ollama): it belongs with the other tools that run on this machine.
    const libBtn = document.getElementById('libraryToolButton');
    if (libBtn) {
        document.getElementById('libraryToolTitle').textContent = T('Process the Feed library with Ollama');
        document.getElementById('libraryToolHint').textContent = T('Rates, categorizes and recaps all your feed items in small batches on your own machine. No tokens spent.');
        libBtn.textContent = T('Open') + ' →';
        libBtn.addEventListener('click', () => { import('./settingsNav.js').then(m => m.openSettingsPanel('feedprefs', 'feedPrefsLibrary')).catch(() => {}); });
    }
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
export function initDangerZone() {
    const btnSettings = document.getElementById('deleteSettingsButton');
    const btnHistory = document.getElementById('deleteHistoryButton');
    const btnAll = document.getElementById('deleteAllButton');

    // One dialog for all three buttons: a checklist of what goes, with counts, preselected by the button that opened it.
    const askAndDelete = async ({ title, body, preselect, confirmLabel, button }) => {
        const counts = await describeData().catch(() => ({}));
        const rows = [
            ['articles', '📚 ' + T('Summaries & archive'), counts.articles ? TN(counts.articles, '{n} summary', '{n} summaries') : ''],
            ['highlights', '🖍️ ' + T('Highlights'), counts.highlights ? String(counts.highlights) : ''],
            ['feeds', '📰 ' + T('Feeds'), counts.feeds ? TN(counts.feeds, '{n} feed', '{n} feeds') + ' · ' + TN(counts.feedItems || 0, '{n} item', '{n} items') : ''],
            ['podcasts', '🎙️ ' + T('Podcasts'), counts.podcasts ? String(counts.podcasts) : ''],
            ['keys', '🔑 ' + T('API keys, sign-in & license'), counts.keys ? String(counts.keys) : ''],
            ['send', '📤 ' + T('Kindle & LocalSend targets'), counts.send ? String(counts.send) : ''],
            ['prefs', '⚙️ ' + T('Preferences & prompts'), ''],
        ];
        const list = document.createElement('div');
        list.className = 'delete-list';
        const boxes = {};
        rows.forEach(([id, label, note]) => {
            const row = document.createElement('label');
            row.className = 'delete-row';
            const cb = document.createElement('input');
            cb.type = 'checkbox'; cb.checked = preselect.includes(id); cb.dataset.cat = id;
            const name = document.createElement('span'); name.className = 'delete-name'; name.textContent = label;
            const n = document.createElement('span'); n.className = 'delete-count'; n.textContent = note;
            row.append(cb, name, n);
            list.appendChild(row);
            boxes[id] = cb;
        });
        const chosen = () => Object.keys(boxes).filter((id) => boxes[id].checked);
        const yes = await confirmDestructive({
            title, body, confirmLabel, content: list,
            canConfirm: () => chosen().length > 0,
            extraLabel: T('Export backup first'),
            onExtra: () => { document.getElementById('exportSettingsButton')?.click(); }
        });
        if (!yes) return;
        const ids = chosen();
        if (!ids.length) return;
        const res = await deleteData(ids);
        const restart = res.everything || ids.includes('prefs') || ids.includes('keys');
        if (button) button.textContent = T('Deleted ✓');
        // Reload so nothing deleted is written back from memory (feeds and history screens keep their lists in memory).
        if (restart) chrome.runtime.reload(); else setTimeout(() => location.reload(), 400);
    };

    if (btnSettings) {
        btnSettings.addEventListener('click', () => askAndDelete({
            title: T('Delete settings?'),
            body: T('Resets preferences, prompts, API keys, sign-in and send targets on this device. Summaries, highlights and feeds stay unless you tick them. The extension will reload.'),
            preselect: ['prefs', 'keys', 'send'], confirmLabel: T('Delete settings'), button: btnSettings
        }));
    }
    if (btnHistory) {
        btnHistory.addEventListener('click', () => askAndDelete({
            title: T('Delete history?'),
            body: T('Permanently removes your summaries, the archive and your highlights from this device. Settings and feeds stay unless you tick them. This cannot be undone.'),
            preselect: ['articles', 'highlights'], confirmLabel: T('Delete history'), button: btnHistory
        }));
    }
    if (btnAll) {
        btnAll.addEventListener('click', () => askAndDelete({
            title: T('Delete all data?'),
            body: T('Removes everything this extension stores on this device and starts it fresh. This cannot be undone. Your account on our server is not affected: to have it deleted, contact us (see the privacy policy).'),
            preselect: ['articles', 'highlights', 'feeds', 'podcasts', 'keys', 'send', 'prefs'], confirmLabel: T('Delete all data'), button: btnAll
        }));
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
        choicePanel.className = 'export-choice';
        choicePanel.hidden = true;
        choicePanel.innerHTML = `
            <p class="export-choice-title">${T('What to export?')}</p>
            <button type="button" id="exportSettingsOnly" class="button-secondary">⚙️ ${T('Settings only')}</button>
            <button type="button" id="exportFullBackup"   class="button-secondary">📚 ${T('Settings + Article History')}</button>
        `;
        btnExport.parentElement.insertAdjacentElement('afterend', choicePanel);

        btnExport.addEventListener('click', () => {
            choicePanel.hidden = !choicePanel.hidden;
            btnExport.textContent = choicePanel.hidden ? '📤 ' + T('Export') : '📤 ' + T('Export') + ' ▲';
        });

        const doExport = async (includeContent) => {
            choicePanel.hidden = true;
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
