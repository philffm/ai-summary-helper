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
        preferredCloudModel: 'google/gemini-2.5-flash'
    };

    // bump if you later change the structure again
    static MIGRATION_VERSION = 1;

    // ─────────────────────────────────────────────
    // Basic helpers
    // ─────────────────────────────────────────────
    static AUTH_KEYS = [
        'pb_token',
        'pb_user',
        'pending_otp_id',
        'pending_email',
        'pending_otp_expires_at',
        'pending_otp_requested_at'
    ];

    static isAuthKey(key) {
        return this.AUTH_KEYS.includes(key);
    }

    static async getAll() {
        const [syncData, localAuthData] = await Promise.all([
            new Promise(resolve => chrome.storage.sync.get(null, resolve)),
            new Promise(resolve => chrome.storage.local.get(this.AUTH_KEYS, resolve)),
        ]);

        return {
            ...syncData,
            ...localAuthData,
        };
    }

    static async get(key) {
        if (typeof key === 'string') {
            if (this.isAuthKey(key)) {
                return new Promise(resolve => chrome.storage.local.get(key, resolve));
            }
            return new Promise(resolve => chrome.storage.sync.get(key, resolve));
        }

        const keys = Array.isArray(key) ? key : [key];
        const authKeys = keys.filter((k) => this.isAuthKey(k));
        const syncKeys = keys.filter((k) => !this.isAuthKey(k));

        const [syncData, authData] = await Promise.all([
            syncKeys.length > 0 ? new Promise(resolve => chrome.storage.sync.get(syncKeys, resolve)) : Promise.resolve({}),
            authKeys.length > 0 ? new Promise(resolve => chrome.storage.local.get(authKeys, resolve)) : Promise.resolve({}),
        ]);

        return {
            ...syncData,
            ...authData,
        };
    }

    static async set(data) {
        const entries = Object.entries(data || {});
        const localData = {};
        const syncData = {};

        for (const [key, value] of entries) {
            if (this.isAuthKey(key)) {
                localData[key] = value;
            } else {
                syncData[key] = value;
            }
        }

        await Promise.all([
            Object.keys(syncData).length > 0
                ? new Promise(resolve => chrome.storage.sync.set(syncData, resolve))
                : Promise.resolve(),
            Object.keys(localData).length > 0
                ? new Promise(resolve => chrome.storage.local.set(localData, resolve))
                : Promise.resolve(),
        ]);

        // Keep sync storage clean from legacy auth fields.
        const authKeysWritten = Object.keys(localData);
        if (authKeysWritten.length > 0) {
            await new Promise(resolve => chrome.storage.sync.remove(authKeysWritten, resolve));
        }
    }

    static async clear(cb) {
        return new Promise(resolve => chrome.storage.sync.clear(() => {
            if (typeof cb === 'function') cb();
            resolve();
        }));
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

        return {
            id: active,
            connectionMode: 'local',
            apiKey: cfg.apiKey || '',
            model: cfg.customModel || cfg.model || serviceMeta?.defaultModel,
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
