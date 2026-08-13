// storageManager.js

class StorageManager {
    static API_BASE = 'https://api.byphil.eu';
    // static API_BASE = 'http://127.0.0.1:3000'; // for local testing - comment out for production

    static getApiBase() {
        return this.API_BASE || 'https://api.byphil.eu';
    }

    static DEFAULTS = {
        prompt: `- brief summary
    - fun standup comedy set on the topic
    - what does it mean for my profession (ux)
    - book recommendations`,
        promptType: 'custom',
        selectedLanguage: 'en-US',
        betaPodcast: false,
        connectionMode: 'cloud',
        preferredCloudModel: 'google/gemini-3.6-flash'
    };

    // bump if you later change the structure again
    static MIGRATION_VERSION = 2;

    // 🔥 Keys that MUST live in local storage (heavy data, device-specific
    // session state, or sensitive credentials that should never sync to cloud).
    static LOCAL_KEYS = [
        'articles',
        'annotations',
        'ghostHighlights',
        'articleHistory',
        'summaryMode',
        'summaryLength',
        'installId',
        'pb_token',
        'pb_user',
        'pending_otp_id',
        'pending_email',
        'pending_otp_expires_at',
        'pending_otp_requested_at',
        // Sensitive / network-local data — never send to Google's sync cloud.
        'servicesConfig',   // contains API keys, model endpoints
        'licenseKey',
        'localSendIp'
    ];

    static isLocalKey(key) {
        return this.LOCAL_KEYS.includes(key);
    }

    // ─────────────────────────────────────────────
    // Basic helpers
    // ─────────────────────────────────────────────

    // 🔥 Fetches and merges BOTH sync and local storage for complete backups
    static async getAll() {
        const syncData = await new Promise(resolve => chrome.storage.sync.get(null, resolve));
        const localData = await new Promise(resolve => chrome.storage.local.get(null, resolve));
        return { ...syncData, ...localData };
    }

    /**
     * Fetch key(s) from their respective storage locations.
     * Accepts a single string key, an array of keys, or null (returns everything from sync).
     */
    static async get(key) {
        // null/undefined means "get all from sync" (legacy usage in modelManager.js)
        if (key === null || key === undefined) {
            return new Promise(resolve => chrome.storage.sync.get(null, resolve));
        }

        if (typeof key === 'string') {
            if (this.isLocalKey(key)) {
                return new Promise(resolve => chrome.storage.local.get(key, resolve));
            }
            return new Promise(resolve => chrome.storage.sync.get(key, resolve));
        }

        // Array of keys
        const keys = Array.isArray(key) ? key : [key];
        const localKeys = keys.filter(k => this.isLocalKey(k));
        const syncKeys = keys.filter(k => !this.isLocalKey(k));

        const [syncData, localData] = await Promise.all([
            syncKeys.length > 0
                ? new Promise(resolve => chrome.storage.sync.get(syncKeys, resolve))
                : Promise.resolve({}),
            localKeys.length > 0
                ? new Promise(resolve => chrome.storage.local.get(localKeys, resolve))
                : Promise.resolve({})
        ]);

        return { ...syncData, ...localData };
    }

    // 🔥 Automatically routes large data to .local, settings to .sync.
    // Also cleans up any local keys that were mistakenly stored in sync.
    static async set(data) {
        const localData = {};
        const syncData = {};
        let hasLocal = false;
        let hasSync = false;

        for (const [key, value] of Object.entries(data || {})) {
            if (this.isLocalKey(key)) {
                localData[key] = value;
                hasLocal = true;
            } else {
                syncData[key] = value;
                hasSync = true;
            }
        }

        const promises = [];
        if (hasSync) promises.push(new Promise(resolve => chrome.storage.sync.set(syncData, resolve)));
        if (hasLocal) promises.push(new Promise(resolve => chrome.storage.local.set(localData, resolve)));

        await Promise.all(promises);

        // Clean up sync storage if any local keys were previously saved there by mistake
        if (hasLocal) {
            const keysToRemove = Object.keys(localData);
            await new Promise(resolve => chrome.storage.sync.remove(keysToRemove, resolve));
        }
    }

    // 🔥 Clears both storages completely
    static async clear(cb) {
        await new Promise(resolve => chrome.storage.local.clear(resolve));
        await new Promise(resolve => chrome.storage.sync.clear(resolve));
        if (typeof cb === 'function') cb();
    }

    static async getLocal(key) {
        return new Promise(resolve => chrome.storage.local.get(key, resolve));
    }

    static async setLocal(data, cb) {
        return new Promise(resolve => chrome.storage.local.set(data, () => {
            if (typeof cb === 'function') cb();
            resolve();
        }));
    }

    /**
     * Purge any LOCAL_KEYS that were mistakenly stored in sync storage.
     * Call during initialization to recover from quota errors.
     */
    static async purgeSyncBloat() {
        return new Promise(resolve => {
            chrome.storage.sync.remove(this.LOCAL_KEYS, resolve);
        });
    }

    /**
     * One-time migration: move sensitive keys that previously lived in sync
     * (servicesConfig, licenseKey, localSendIp) down to local storage and
     * remove them from sync. Prevents credentials from being synced to
     * Google's cloud and fixes split-brain (key in both storages).
     */
    static async migrateSensitiveToLocal() {
        const sensitiveKeys = ['servicesConfig', 'licenseKey', 'localSendIp'];
        const syncData = await new Promise(resolve => chrome.storage.sync.get(sensitiveKeys, resolve));
        const toLocal = {};
        let found = false;

        for (const key of sensitiveKeys) {
            if (syncData[key] !== undefined) {
                toLocal[key] = syncData[key];
                found = true;
            }
        }

        if (found) {
            await new Promise(resolve => chrome.storage.local.set(toLocal, resolve));
            await new Promise(resolve => chrome.storage.sync.remove(Object.keys(toLocal), resolve));
            console.log('✅ Migrated sensitive keys from sync → local:', Object.keys(toLocal).join(', '));
        }
    }

    /**
     * Get or generate a stable installId for anonymous cloud tracking
     */
    static async getInstallId() {
        const data = await this.getLocal(['installId']);
        if (data.installId) return data.installId;
        
        const newId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
            .map(b => b.toString(16).padStart(2, '0')).join('');
        await this.setLocal({ installId: newId });
        return newId;
    }

    // ─────────────────────────────────────────────
    // Services config & migration
    // ─────────────────────────────────────────────

    static async getServices() {
        const response = await fetch(chrome.runtime.getURL('services.json'));
        if (!response.ok) {
            throw new Error('Failed to load services.json');
        }
        const services = await response.json();
        // add a stable id for each service: openai, mistral, deepseek, ...
        return services.map(s => ({
            ...s,
            id: (s.name || '').toLowerCase()
        }));
    }

    /**
     * Initialize storage structure:
     * - migrate old flat keys → servicesConfig + activeService
     * - ensure servicesConfig has entries for all services.json
     * - ensure default prompt exists
     */
    static async initialize() {
        // Run legacy sync cleanup first — purge any local keys from sync storage
        await this.purgeSyncBloat();

        // Migrate sensitive keys that previously lived in sync (servicesConfig,
        // licenseKey, localSendIp) down to local, then remove them from sync.
        // This keeps credentials off Google's sync cloud and fixes the
        // split-brain where servicesConfig existed in both storages.
        await this.migrateSensitiveToLocal();

        const data = await this.getAll();

        // Already migrated?
        if (data.migrationVersion === this.MIGRATION_VERSION) {
            await this.ensureServicesIntegrity();
            await this.ensurePromptDefaults();
            return;
        }

        const services = await this.getServices();

        // Build base servicesConfig from services.json
        const servicesConfig = {};
        for (const service of services) {
            servicesConfig[service.id] = {
                apiKey: '',
                model: service.defaultModel,
                customModel: '',
                endpoint: service.endpointUrl
            };
        }

        // Old flat structure keys
        const oldApiKey         = data.apiKey;
        const oldModel          = data.model;           // used as "openai" / "mistral" OR as actual model name, depending on version
        const oldModelIdentifier= data.modelIdentifier; // custom model
        const oldCustomEndpoint = data.customEndpoint;

        // Decide active service: if oldModel is one of the service ids, use that, else default to 'openai'
        const serviceIds = services.map(s => s.id);
        let activeService = 'openai';
        if (oldModel && serviceIds.includes(oldModel.toLowerCase())) {
            activeService = oldModel.toLowerCase();
        }

        // Migrate OpenAI-related fields into openai config
        const openaiCfg = servicesConfig['openai'] || {
            apiKey: '',
            model: services.find(s => s.id === 'openai')?.defaultModel || 'gpt-5-mini',
            customModel: '',
            endpoint: services.find(s => s.id === 'openai')?.endpointUrl || 'https://api.openai.com/v1/chat/completions'
        };

        if (oldApiKey)         openaiCfg.apiKey      = oldApiKey;
        if (oldModel && !serviceIds.includes(oldModel.toLowerCase())) {
            // If oldModel was not a service id, treat it as an OpenAI model name
            openaiCfg.model = oldModel;
        }
        if (oldModelIdentifier) openaiCfg.customModel = oldModelIdentifier;
        if (oldCustomEndpoint)  openaiCfg.endpoint    = oldCustomEndpoint;

        servicesConfig['openai'] = openaiCfg;

        // Write new structure
        await this.set({
            servicesConfig,
            activeService,
            migrationVersion: this.MIGRATION_VERSION
        });

        // Optional: clean old keys
        chrome.storage.sync.remove(['apiKey', 'model', 'modelIdentifier', 'customEndpoint']);

        // Ensure prompt defaults
        await this.ensurePromptDefaults();

        console.log('✅ Storage migration to multidimensional servicesConfig completed.');
    }

    static async ensureServicesIntegrity() {
        const [data, services] = await Promise.all([
            this.getAll(),
            this.getServices()
        ]);

        let cfg = data.servicesConfig || {};
        let changed = false;

        for (const service of services) {
            if (!cfg[service.id]) {
                // Missing whole service entry -> create with defaults
                cfg[service.id] = {
                    apiKey: '',
                    model: service.defaultModel,
                    customModel: [],
                    endpoint: service.endpointUrl
                };
                changed = true;
            } else {
                // Ensure existing entry has all expected fields (don't clobber existing values)
                const entry = cfg[service.id] || {};
                const updatedEntry = { ...entry };
                if (updatedEntry.apiKey === undefined) updatedEntry.apiKey = '';
                if (updatedEntry.model === undefined || updatedEntry.model === null || updatedEntry.model === '') updatedEntry.model = service.defaultModel;
                if (updatedEntry.customModel === undefined) updatedEntry.customModel = [];
                // Migrate old string customModel → array
                if (typeof updatedEntry.customModel === 'string') {
                    updatedEntry.customModel = updatedEntry.customModel ? [updatedEntry.customModel] : [];
                }
                // Migrate legacy string-based custom models → provider-bound objects.
                // Each entry becomes { id, provider } so the routing context is
                // never lost when the background script wakes back up.
                if (Array.isArray(updatedEntry.customModel)) {
                    updatedEntry.customModel = updatedEntry.customModel.map(m =>
                        typeof m === 'string'
                            ? { id: m, provider: service.id }
                            : m
                    );
                }
                // Migrate legacy string activeModelId → provider-bound object
                if (typeof updatedEntry.activeModelId === 'string') {
                    updatedEntry.activeModelId = { id: updatedEntry.activeModelId, provider: service.id };
                }
                if (updatedEntry.endpoint === undefined || updatedEntry.endpoint === '') updatedEntry.endpoint = service.endpointUrl;

                // If any defaults were applied, write back
                if (JSON.stringify(updatedEntry) !== JSON.stringify(entry)) {
                    cfg[service.id] = updatedEntry;
                    changed = true;
                }
            }
        }

        if (!data.activeService) {
            await this.set({ activeService: 'openai' });
        }

        if (changed) {
            await this.set({ servicesConfig: cfg });
        }
    }

    static async ensurePromptDefaults() {
        const data = await this.get(['prompt', 'promptType']);
        if (!data.prompt) {
            await this.set({
                prompt: this.DEFAULTS.prompt,
                promptType: 'custom'
            });
        }
    }

    /**
     * Old entry point used in your code – keep it but delegate to new logic.
     */
    static async initializeDefaults() {
        await this.initialize();
        await this.ensurePromptDefaults();
    }

    // ─────────────────────────────────────────────
    // Convenience methods for active service
    // ─────────────────────────────────────────────

    static async getActiveServiceConfig() {
        const data = await this.getAll();
        const connectionMode = data.connectionMode || 'cloud';

        if (connectionMode === 'cloud') {
            return {
                id: 'cloud',
                connectionMode: 'cloud',
                apiKey: data.licenseKey || '',
                model: data.preferredCloudModel || 'google/gemini-2.5-flash',
                endpoint: `${this.getApiBase()}/v1/projects/ai_summary_helper/chat`,
                responseStructure: 'result.choices?.[0]?.message?.content'
            };
        }

        const services = await this.getServices();

        const active = data.activeService || 'openai';
        const cfg = data.servicesConfig?.[active] || {};
        const serviceMeta = services.find(s => s.id === active);
        const activeModel = await this.getActiveModel(active, cfg);

        return {
            id: active,
            connectionMode: 'local',
            apiKey: cfg.apiKey || '',
            model: activeModel.id || cfg.model || serviceMeta?.defaultModel,
            provider: activeModel.provider,
            endpoint: cfg.endpoint || serviceMeta?.endpointUrl,
            responseStructure: serviceMeta?.responseStructure || null
        };
    }

    static async updateService(serviceId, updates) {
        const data = await this.getAll();
        const cfg = data.servicesConfig || {};
        cfg[serviceId] = {
            ...(cfg[serviceId] || {}),
            ...updates
        };
        await this.set({ servicesConfig: cfg });
    }

    /**
     * Normalize a customModel entry to a provider-bound object.
     * Accepts either a legacy string ("qwen3:8b") or an object ({ id, provider }).
     * @param {string|object} m
     * @param {string} fallbackProvider
     * @returns {{id: string, provider: string}}
     */
    static normalizeCustomModel(m, fallbackProvider) {
        if (typeof m === 'string') {
            return { id: m, provider: fallbackProvider };
        }
        if (m && typeof m === 'object') {
            return {
                id: m.id || '',
                provider: m.provider || fallbackProvider
            };
        }
        return { id: '', provider: fallbackProvider };
    }

    /**
     * Get the active model for a service as a provider-bound object.
     * Falls back to the first custom model, then the service default.
     * @param {string} serviceId
     * @param {object} [cfg] optional pre-fetched service config
     * @returns {{id: string, provider: string}}
     */
    static async getActiveModel(serviceId, cfg) {
        const data = cfg ? { servicesConfig: { [serviceId]: cfg } } : await this.getAll();
        const services = await this.getServices();
        const serviceMeta = services.find(s => s.id === serviceId);
        const entry = (data.servicesConfig || {})[serviceId] || {};
        const defaultModel = serviceMeta?.defaultModel || '';

        // activeModelId may be a string (legacy) or { id, provider }
        if (entry.activeModelId) {
            return this.normalizeCustomModel(entry.activeModelId, serviceId);
        }
        const custom = Array.isArray(entry.customModel) ? entry.customModel : [];
        if (custom.length > 0) {
            return this.normalizeCustomModel(custom[0], serviceId);
        }
        return { id: defaultModel, provider: serviceId };
    }

    /**
     * Used by popup.js to send a compact config to content.js
     */
    static async getModelConfig() {
        const activeCfg = await this.getActiveServiceConfig();
        return {
            endpointUrl: activeCfg.endpoint,
            modelIdentifier: activeCfg.model,
            responseStructure: activeCfg.responseStructure
        };
    }
}

export default StorageManager;
