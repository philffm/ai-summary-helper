// settingsManager.js — Settings screen: the UI is in popup.html (static panels), the logic per area in settings/<area>.js.
// This file wires them up. The panels that are only needed when they are opened (Library & Data, the bookmarklet in
// Send to) load on demand: popup.js passes { lazy: true }; tests and the other surfaces load everything at once.
//   settings/autosave.js        Save button flash + autoSave(key, value)
//   settings/models.js          Models › connection path, provider, key, endpoint (+ settings/localModels.js: local servers, Ollama guide)
//   settings/general.js         theme, accessibility, reading, dock, side panel
//   settings/sendTargets.js     Kindle / LocalSend / KOReader devices, delivery method
//   settings/bookmarklet.js     bookmarklet generator                     (Send to — on demand)
//   settings/tagCleanup.js      on-device tag cleanup, tag names           (Library & Data — on demand)
//   settings/backup.js          export / import settings                   (Library & Data — on demand)
//   settings/storageCleanup.js  storage & cleanup                          (Library & Data — on demand)
//   settings/danger.js          delete history / settings / everything     (Library & Data — on demand)
//   settings/speedRead.js       Speed-Read                                 (Reading — on demand)

import { SK } from './storageKeys.js';
import StorageManager from './storageManager.js';
import { initPromptSettings } from './promptSettings.js';
import { initAuthManager } from './authManager.js';
import { flashSaveIndicator } from './settings/autosave.js';
import { initModelSettings } from './settings/models.js';
import { initGeneralSettings } from './settings/general.js';
import { initLocalSendSettings } from './settings/sendTargets.js';

// panel name (settingsNav) → the sections it needs that are not loaded at start
const ON_DEMAND = {
    library: async () => {
        const [tags, danger, backup, cleanup] = await Promise.all([
            import('./settings/tagCleanup.js'), import('./settings/danger.js'),
            import('./settings/backup.js'), import('./settings/storageCleanup.js'),
        ]);
        tags.initLocalIntelligence();
        danger.initDangerZone();
        backup.initBackupRestore();
        cleanup.initStorageCleanup(await StorageManager.getAll());
    },
    send: async () => (await import('./settings/bookmarklet.js')).initBookmarkletGenerator(),
    reading: async () => (await import('./settings/speedRead.js')).initSpeedReadSettings(),
};

function loadOnDemand(lazy) {
    const started = {};
    const load = (name) => {
        if (!ON_DEMAND[name] || started[name]) return;
        started[name] = ON_DEMAND[name]().catch((e) => { started[name] = null; console.warn('[AISH] settings panel', name, e); });
    };
    if (!lazy) return Promise.all(Object.keys(ON_DEMAND).map((n) => { load(n); return started[n]; }));
    document.addEventListener('aish:settings-panel', (e) => load(e.detail && e.detail.name));
    // the search can jump straight to a control on such a panel; and after a while load the rest anyway
    const whenIdle = (typeof window !== 'undefined' && window.requestIdleCallback) || ((f) => setTimeout(f, 0));
    setTimeout(() => whenIdle(() => Object.keys(ON_DEMAND).forEach(load)), 15000);
    return Promise.resolve();
}

export async function initSettingsManager(ui, { lazy = false } = {}) {
    const storageData = await StorageManager.getAll();

    // sections whose controls feed the row subtitles in settingsNav (or the main screen) load at once
    initModelSettings(storageData);
    initGeneralSettings(storageData);
    initLocalSendSettings(storageData);
    const onDemandReady = loadOnDemand(lazy);

    // Initialize Auth Manager (drives both the Settings panel and the
    // main-screen onboarding mask — see authManager.js)
    initAuthManager(ui);

    // Initialize prompt manager with the static DOM elements
    const promptsReady = initPromptSettings(document.getElementById('promptSettingsRoot'));
    // The controls now hold the stored values (the prompt list once it has loaded): tell settingsNav, so the row
    // subtitles ("Highlighting on · ghost on", "Delivery: Kindle") describe the real settings instead of the defaults.
    Promise.resolve(promptsReady).catch(() => {}).finally(() => document.dispatchEvent(new CustomEvent('aish:settings-populated')));

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

    await onDemandReady;   // everything loaded (not lazy): the caller can use every panel right away
}

// the Local models helpers, for the tests (models.js loads that file anyway)
export { renderBuiltinModel as __test_renderBuiltinModel, renderFirefoxModel as __test_renderFirefoxModel, renderRecommendation as __test_renderRecommendation, runQuickTest as __test_runQuickTest } from './settings/localModels.js';
