// settingsManager.js
// Settings screen initialization — UI is in popup.html (static accordion),
// this file handles logic, auto-save, and wiring event listeners.

import StorageManager from './storageManager.js';
import { initPromptManager } from './promptManager.js';
import { updateModelIdentifierUI } from './modelManager.js';

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

// ── Section: Model Configuration ─────────────────────────────────────
async function initModelSettings(storageData) {
    const services = await StorageManager.getServices();
    const modelSelect = document.getElementById('model');
    const apiKeyInput = document.getElementById('apiKey');
    const endpointInput = document.getElementById('customEndpoint');

    if (!modelSelect) return;

    // Populate provider dropdown
    modelSelect.innerHTML = '';
    services.forEach(service => {
        const option = document.createElement('option');
        option.value = service.id;
        option.textContent = service.name;
        modelSelect.appendChild(option);
    });

    // Restore active service
    let activeService = storageData.activeService || 'openai';
    if (!services.some(s => s.id === activeService)) {
        activeService = services[0]?.id;
        if (activeService) await StorageManager.set({ activeService });
    }
    modelSelect.value = activeService;

    // ── Helper: refresh all UI fields for a given provider ────────
    const updateFields = async (serviceId) => {
        const service = services.find(s => s.id === serviceId);
        const latest = await StorageManager.getAll();
        const cfg = latest.servicesConfig?.[serviceId] || {};

        // API key documentation link
        const apiKeyLink = document.getElementById('apiKeyLink');
        if (apiKeyLink) {
            apiKeyLink.innerHTML = service?.apiKeyDocumentationUrl
                ? `(<a href="${service.apiKeyDocumentationUrl}" target="_blank">Get Key</a>)`
                : '';
        }

        // Endpoint visibility
        const customEndpointContainer = document.getElementById('customEndpointContainer');
        if (customEndpointContainer) {
            customEndpointContainer.style.display = service?.allowCustomEndpoint ? 'block' : 'none';
        }

        // Populate field values
        if (apiKeyInput) apiKeyInput.value = cfg.apiKey || '';
        if (endpointInput) endpointInput.value = cfg.endpoint || service?.endpointUrl || '';

        // Model identifier tag UI (from modelManager.js)
        updateModelIdentifierUI(serviceId, services, latest);
    };

    // ── Event: provider change ────────────────────────────────────
    modelSelect.addEventListener('change', async () => {
        const selectedId = modelSelect.value;
        await autoSave('activeService', selectedId);
        await updateFields(selectedId);
    });

    // ── Real-time save: API key ────────────────────────────────────
    if (apiKeyInput) {
        apiKeyInput.addEventListener('input', () => {
            StorageManager.updateService(modelSelect.value, { apiKey: apiKeyInput.value });
        });
    }

    // ── Real-time save: Endpoint ───────────────────────────────────
    if (endpointInput) {
        endpointInput.addEventListener('input', () => {
            StorageManager.updateService(modelSelect.value, { endpoint: endpointInput.value });
        });
    }

    // Initial population
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

    // ── Export Settings ──
    if (btnExport) {
        btnExport.addEventListener('click', async () => {
            try {
                const data = await StorageManager.getAll();
                const jsonStr = JSON.stringify(data, null, 2);
                const blob = new Blob([jsonStr], { type: 'application/json' });
                const url = URL.createObjectURL(blob);

                const a = document.createElement('a');
                a.href = url;
                const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
                a.download = `ai_summary_settings_${date}.json`;

                document.body.appendChild(a);
                a.click();

                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                const origText = btnExport.textContent;
                btnExport.textContent = 'Exported! ✓';
                setTimeout(() => btnExport.textContent = origText, 2000);
            } catch (err) {
                console.error('Export failed:', err);
                alert('Failed to export settings.');
            }
        });
    }

    // ── Import Settings ──
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

                    await StorageManager.set(importedData);

                    alert('Settings imported successfully! The extension will now reload to apply them.');
                    chrome.runtime.reload();
                } catch (err) {
                    console.error('Import failed:', err);
                    alert('Invalid JSON file. Please select a valid AI Summary Helper backup.');
                } finally {
                    fileInput.value = '';
                }
            };

            reader.readAsText(file);
        });
    }
}
