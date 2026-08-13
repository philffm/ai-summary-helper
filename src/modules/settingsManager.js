// settingsManager.js
// Settings screen initialization — UI is in popup.html (static accordion),
// this file handles logic, auto-save, and wiring event listeners.

import StorageManager from './storageManager.js';
import { initPromptManager } from './promptManager.js';
import { updateModelIdentifierUI } from './modelManager.js';
import { initAuthManager } from './authManager.js';

let uiRef = null;

export async function initSettingsManager(ui) {
    uiRef = ui;
    const storageData = await StorageManager.getAll();

    // Initialize distinct sections independently (DOM is already in popup.html)
    initModelSettings(storageData);
    initGeneralSettings(storageData);
    initLocalSendSettings(storageData);
    initDangerZone();
    initBackupRestore();
    initSummaryLengthSlider();
    initBookmarkletGenerator();

    // Initialize Auth Manager
    initAuthManager();

    // Initialize prompt manager with the static DOM elements
    const promptSelect = document.getElementById('promptSelect');
    const promptInput = document.getElementById('prompt');
    if (promptSelect && promptInput) {
        initPromptManager(promptSelect, promptInput);
    }

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
            const servicesConfig = storageData.servicesConfig || {};
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
            await StorageManager.set({ servicesConfig });

            flashSaveIndicator();
        });
    }
}

// ── UI Helper: Visual Auto-Save Indicator ──────────────────────────
function flashSaveIndicator() {
    const saveButton = document.querySelector('button[form="settingsForm"]');
    if (!saveButton) return;

    const origText = saveButton.textContent;
    const origBg = saveButton.style.background;
    const origColor = saveButton.style.color;

    saveButton.textContent = 'Saved! ✓';
    saveButton.style.background = 'var(--success, #2ecc40)';
    saveButton.style.color = '#fff';
    saveButton.disabled = true;

    setTimeout(() => {
        saveButton.textContent = origText;
        saveButton.style.background = origBg;
        saveButton.style.color = origColor;
        saveButton.disabled = false;
    }, 1500);
}

const autoSave = async (key, value) => {
    await StorageManager.set({ [key]: value });
    flashSaveIndicator();
};

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
                        // Example output: "Gemini 2.5 Flash (Context: 1M)"
                        option.textContent = `${model.name} (Context: ${Math.round(model.context / 1000)}k)`;
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
                cloudModelSelect.innerHTML = '<option value="google/gemini-2.5-flash">Gemini 2.5 Flash (Fallback)</option>';
            });

        // Retain auto-save trigger on user selection change
        cloudModelSelect.addEventListener('change', () => {
            autoSave('preferredCloudModel', cloudModelSelect.value);
        });
    }

    if (licenseKeyInput) {
        licenseKeyInput.value = storageData.licenseKey || '';
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
    if (storageData.licenseKey) {
        refreshLicenseUIStatus('Pro Active ✓', true);
    } else {
        refreshLicenseUIStatus('Free Trial Mode');
    }

    // Handshake execution with api.byphil.eu
    if (verifyLicenseBtn && licenseKeyInput) {
        verifyLicenseBtn.addEventListener('click', async () => {
            const inputKey = licenseKeyInput.value.trim();
            if (!inputKey) {
                alert('Please enter a license key.');
                return;
            }

            verifyLicenseBtn.disabled = true;
            verifyLicenseBtn.textContent = 'Verifying...';

            try {
                const response = await fetch(`${StorageManager.getApiBase()}/v1/projects/ai_summary_helper/license/verify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ license_key: inputKey })
                });

                const resData = await response.json();

                if (response.ok && resData.valid && resData.status === 'active') {
                    await StorageManager.set({ licenseKey: inputKey });
                    refreshLicenseUIStatus('Pro Active ✓', true);
                    flashSaveIndicator();
                } else {
                    alert('Invalid or deactivated license key. Check your subscription parameters.');
                    refreshLicenseUIStatus('Invalid Key');
                }
            } catch (err) {
                console.error('License authorization handshake broke down:', err);
                alert('Infrastructural link execution failed. Ensure network connection to gateway.');
            } finally {
                verifyLicenseBtn.disabled = false;
                verifyLicenseBtn.textContent = 'Activate';
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
        const cfg = latest.servicesConfig?.[serviceId] || {};

        const apiKeyLink = document.getElementById('apiKeyLink');
        if (apiKeyLink) {
            apiKeyLink.innerHTML = service?.apiKeyDocumentationUrl
                ? `(<a href="${service.apiKeyDocumentationUrl}" target="_blank">Get Key</a>)`
                : '';
        }

        const customEndpointContainer = document.getElementById('customEndpointContainer');
        if (customEndpointContainer) {
            customEndpointContainer.style.display = service?.allowCustomEndpoint ? 'block' : 'none';
        }

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
    // ── Theme ──────────────────────────────────────────────────────
    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) {
        themeSelect.value = storageData.theme || 'system';
        themeSelect.addEventListener('change', () => {
            const val = themeSelect.value;
            autoSave('theme', val);
            if (val === 'dark' || val === 'light') {
                document.documentElement.setAttribute('data-theme', val);
            } else {
                document.documentElement.removeAttribute('data-theme');
            }
        });
    }

    // ── UI Language ────────────────────────────────────────────────
    const uiLangSelect = document.getElementById('uiLangSelect');
    if (uiLangSelect) {
        uiLangSelect.value = storageData.uiLanguage || '';
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

    // ── Beta Podcast ───────────────────────────────────────────────
    const betaPodcastToggle = document.getElementById('betaPodcastToggle');
    if (betaPodcastToggle) {
        betaPodcastToggle.checked = !!storageData.betaPodcast;
        betaPodcastToggle.addEventListener('change', () => {
            autoSave('betaPodcast', betaPodcastToggle.checked);
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
        const token = data.pb_token;

        if (!token) {
            alert('⚠️ You must be logged into byphil Cloud first to generate a bookmarklet.');
            return;
        }

        // Minified payload with the token injected. The token is embedded
        // directly so the bookmarklet can authenticate without storage access.
        const rawJs = `
            (async function(){
                const t='${token}';
                const d=document;
                const ui=d.createElement('div');
                ui.style.cssText='position:fixed;top:20px;right:20px;width:350px;max-height:80vh;overflow-y:auto;background:#fff;color:#171717;z-index:999999;padding:16px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,0.2);font-family:sans-serif;font-size:14px;line-height:1.5;';
                ui.innerHTML='<b>✨ AI Summary Helper</b><br><span id="as-st">Reading page...</span><br><button id="as-cl" style="margin-top:10px;padding:4px 8px;border:none;background:#eee;border-radius:4px;cursor:pointer;">Close</button>';
                d.body.appendChild(ui);
                d.getElementById('as-cl').onclick=()=>ui.remove();
                try{
                    const text=d.body.innerText.substring(0,15000);
                    d.getElementById('as-st').innerText='Summarizing...';
                    const r=await fetch('https://api.byphil.eu/v1/projects/ai_summary_helper/chat',{
                        method:'POST',
                        headers:{'Content-Type':'application/json','Authorization':'Bearer '+t},
                        body:JSON.stringify({
                            model:'google/gemini-2.5-flash',
                            messages:[
                                {role:'system',content:'You are a summarizer returning concise, useful summaries.'},
                                {role:'user',content:'- brief summary\\n- key takeaways\\n\\nContent: '+text}
                            ]
                        })
                    });
                    if(!r.ok) throw new Error(r.status===401?'Session expired. Generate a new bookmarklet.':'API Error: '+r.status);
                    const j=await r.json();
                    const s=j.result?.choices?.[0]?.message?.content||j.choices?.[0]?.message?.content||j.summary||'No summary returned.';
                    const html=s.replace(/\\*\\*(.*?)\\*\\*/g,'<b>$1</b>').replace(/\\n/g,'<br>');
                    d.getElementById('as-st').innerHTML='<div style="margin-top:8px;padding-top:8px;border-top:1px solid #eee;">'+html+'</div>';
                }catch(e){
                    d.getElementById('as-st').innerText='❌ Error: '+e.message;
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

    chrome.storage.local.get(['summaryLength'], (data) => {
        const length = data.summaryLength || 200;
        slider.value = length;
        valueDisplay.textContent = length;
        slider.dispatchEvent(new Event('input'));
    });

    slider.addEventListener('input', () => {
        const newLength = slider.value;
        valueDisplay.textContent = newLength;
        if (chipLabel) chipLabel.textContent = newLength + 'w';
        chrome.storage.local.set({ summaryLength: Number(newLength) });
    });
}

// ── Section: LocalSend Configuration ─────────────────────────────────
function initLocalSendSettings(storageData) {
    const kindleEmailInput = document.getElementById('kindleEmail');
    const localSendIpInput = document.getElementById('localSendIp');
    const scanBtn = document.getElementById('scanLocalSendButton');
    const statusLabel = document.getElementById('localSendStatus');
    const deliveryPreferenceSelect = document.getElementById('deliveryPreference');
    const kindleConfigBlock = document.getElementById('kindleDeliveryConfig');
    const localSendConfigBlock = document.getElementById('localSendDeliveryConfig');

    if (!localSendIpInput) return;

    if (kindleEmailInput) {
        kindleEmailInput.value = storageData.kindleEmail || '';
        kindleEmailInput.addEventListener('input', () => {
            autoSave('kindleEmail', kindleEmailInput.value.trim());
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

    localSendIpInput.value = storageData.localSendIp || '';

    localSendIpInput.addEventListener('input', () => {
        autoSave('localSendIp', localSendIpInput.value.trim());
        if (statusLabel) statusLabel.textContent = '';
    });

    if (scanBtn) {
        scanBtn.addEventListener('click', async () => {
            scanBtn.disabled = true;
            scanBtn.textContent = 'Scanning...';

            if (statusLabel) {
                statusLabel.textContent = 'Searching LAN for LocalSend receiver...';
                statusLabel.style.color = 'var(--text-muted)';
            }

            try {
                const foundIp = await discoverLocalSendDevice();
                if (foundIp) {
                    localSendIpInput.value = foundIp;
                    await autoSave('localSendIp', foundIp);
                    if (statusLabel) {
                        statusLabel.textContent = `Found device at ${foundIp} ✓`;
                        statusLabel.style.color = '#2ecc40';
                    }
                } else if (statusLabel) {
                    statusLabel.textContent = 'No active receiver found.';
                    statusLabel.style.color = 'var(--text-muted)';
                }
            } catch (err) {
                console.error('LocalSend scan failed:', err);
                if (statusLabel) {
                    statusLabel.textContent = 'Scan failed. Enter IP manually.';
                    statusLabel.style.color = 'var(--danger, #dc2626)';
                }
            } finally {
                scanBtn.disabled = false;
                scanBtn.textContent = 'Auto-Detect';
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

// ── Section: Danger Zone ─────────────────────────────────────────────
function initDangerZone() {
    const btnSettings = document.getElementById('deleteSettingsButton');
    const btnHistory = document.getElementById('deleteHistoryButton');

    if (btnSettings) {
        btnSettings.addEventListener('click', async () => {
            if (confirm('Are you sure you want to reset all settings to default?')) {
                await chrome.storage.sync.clear();
                alert('Settings deleted. The extension will now reload.');
                chrome.runtime.reload();
            }
        });
    }

    if (btnHistory) {
        btnHistory.addEventListener('click', async () => {
            if (confirm('Are you sure you want to delete all saved summaries?')) {
                await StorageManager.setLocal({ articles: [] });
                alert('History deleted.');
            }
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
            <p style="font-size:11px;font-weight:600;color:var(--text-secondary);margin:0 0 4px;">What to export?</p>
            <button type="button" id="exportSettingsOnly" class="button-secondary" style="font-size:12px;justify-content:flex-start;">⚙️ Settings only</button>
            <button type="button" id="exportFullBackup"   class="button-secondary" style="font-size:12px;justify-content:flex-start;">📚 Settings + Article History</button>
        `;
        btnExport.parentElement.insertAdjacentElement('afterend', choicePanel);

        btnExport.addEventListener('click', () => {
            const isOpen = choicePanel.style.display === 'flex';
            choicePanel.style.display = isOpen ? 'none' : 'flex';
            btnExport.textContent = isOpen ? '📤 Export' : '📤 Export ▲';
        });

        const doExport = async (includeContent) => {
            choicePanel.style.display = 'none';
            btnExport.textContent = '📤 Export';
            try {
                // Fetch cleanly separated sync and local data
                const [syncData, localData] = await Promise.all([
                    new Promise(resolve => chrome.storage.sync.get(null, resolve)),
                    new Promise(resolve => chrome.storage.local.get(null, resolve))
                ]);

                let backup, filename;
                const date = new Date().toISOString().split('T')[0].replace(/-/g, '');

                if (includeContent) {
                    const count = (localData.articles || []).length;
                    backup = {
                        _backup_version: 2,
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
                    ? `Exported! ✓ (${backup._article_count} articles)`
                    : 'Exported! ✓';
                setTimeout(() => btnExport.textContent = origText, 2500);
            } catch (err) {
                console.error('Export failed:', err);
                alert('Failed to export backup.');
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

                    if (importedData._backup_version === 2) {
                        // Full backup — restore settings to sync, local data to local
                        const { settings, local } = importedData;

                        // Use raw chrome APIs to ensure strict separation
                        if (settings) await new Promise(resolve => chrome.storage.sync.set(settings, resolve));
                        if (local) await new Promise(resolve => chrome.storage.local.set(local, resolve));

                        const count = (local?.articles || []).length;
                        alert(`Backup restored successfully!\n${count} articles imported.\n\nThe extension will now reload.`);
                    } else {
                        // Legacy v1 backup — settings only
                        // Safe to use StorageManager.set() since it routes automatically
                        await StorageManager.set(importedData);
                        alert('Settings imported successfully! The extension will now reload.');
                    }

                    chrome.runtime.reload();
                } catch (err) {
                    console.error('Import failed:', err);
                    alert('Invalid backup file. Please select a valid AI Summary Helper export.');
                } finally {
                    fileInput.value = '';
                }
            };

            reader.readAsText(file);
        });
    }
}
