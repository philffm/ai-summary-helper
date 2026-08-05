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
    initDangerZone();
    initBackupRestore();
    initSummaryLengthSlider();

    // Initialize Auth Manager
    initAuthManager();

    // Initialize prompt manager with the static DOM elements
    const promptSelect = document.getElementById('promptSelect');
    const promptInput = document.getElementById('prompt');
    if (promptSelect && promptInput) {
        initPromptManager(promptSelect, promptInput);
    }

    // Prevent form submission page reloads
    const settingsForm = document.getElementById('settingsForm');
    if (settingsForm) {
        settingsForm.addEventListener('submit', (e) => e.preventDefault());
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
        apiKeyInput.addEventListener('input', () => {
            StorageManager.updateService(modelSelect.value, { apiKey: apiKeyInput.value });
        });
    }

    if (endpointInput) {
        endpointInput.addEventListener('input', () => {
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

    // ── Highlighting ───────────────────────────────────────────────
    const highlightingToggle = document.getElementById('highlightingToggle');
    if (highlightingToggle) {
        highlightingToggle.checked = storageData.highlightingEnabled !== false; // default on
        highlightingToggle.addEventListener('change', () => {
            autoSave('highlightingEnabled', highlightingToggle.checked);
        });
    }

    // ── Beta Podcast ───────────────────────────────────────────────
    const betaPodcastToggle = document.getElementById('betaPodcastToggle');
    if (betaPodcastToggle) {
        betaPodcastToggle.checked = !!storageData.betaPodcast;
        betaPodcastToggle.addEventListener('change', () => {
            autoSave('betaPodcast', betaPodcastToggle.checked);
            const podcastButton = document.getElementById('podcastButton');
            if (podcastButton) {
                podcastButton.style.display = betaPodcastToggle.checked ? 'inline-flex' : 'none';
            }
        });
    }
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
                const [syncData, localData] = await Promise.all([
                    StorageManager.getAll(),
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
                        if (settings) await StorageManager.set(settings);
                        if (local) await new Promise(resolve => chrome.storage.local.set(local, resolve));
                        const count = (local?.articles || []).length;
                        alert(`Backup restored successfully!\n${count} articles imported.\n\nThe extension will now reload.`);
                    } else {
                        // Legacy v1 backup — settings only
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
