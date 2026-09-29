// storageManager.js

// Precomputed once per save/migration so analyticsManager.js's reading-time
// and word-cloud stats can run off the lean articlesIndex, without loading
// every article's full content record just to open the report screen.
function countWordsForIndex(html) {
    return (html || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
}

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
        'articlesIndex',
        'articlesSchemaVersion',
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
        'localSendIp',
        // Unified send-target list (LocalSend receivers, Kindle emails, …).
        // Kept local rather than sync: LocalSend addresses are LAN-specific
        // and meaningless on another network, and since both device types
        // now share one list it's simpler to keep the whole list local than
        // to split it.
        'devices',
        'activeDeviceIds',
        'devicesMigrated'
    ];

    static isLocalKey(key) {
        // Per-article records (see migrateArticlesToIndexedRecords) are dynamic
        // keys, not in the static list.
        return this.LOCAL_KEYS.includes(key) || key.startsWith('article:');
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

    // Separate from MIGRATION_VERSION — this needs to be checkable without
    // ever touching the (potentially 40MB+) old 'articles' blob.
    static ARTICLES_SCHEMA_VERSION = 2;

    /**
     * Pure: splits an old-shape 'articles' array into the new
     * articlesIndex/article:<id> shape. No storage I/O, so both the startup
     * migration and backup restore can share this.
     */
    static splitArticlesArray(articles) {
        const index = [];
        const records = {};
        const seenIds = new Set();

        for (const article of articles) {
            let id = `article_${new Date(article.timestamp).getTime() || Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            while (seenIds.has(id)) id += `_${Math.random().toString(36).slice(2, 4)}`;
            seenIds.add(id);

            index.push({
                id,
                title: article.title || 'Untitled',
                url: article.url || '',
                timestamp: article.timestamp,
                tags: article.tags || [],
                modelId: article.modelId || '',
                connectionMode: article.connectionMode || '',
                summaryLength: article.summaryLength || 200,
                // Full summary (not just a preview) — needed as-is by
                // analyticsManager.js's word cloud and by list/feed previews,
                // without loading the heavier article:<id> content record.
                summary: article.summary || '',
                contentWordCount: countWordsForIndex(article.content || ''),
                summaryWordCount: countWordsForIndex(article.summary || ''),
                archived: false,
                // Read by archiveGraph.js to fade/shrink saves that haven't
                // been reopened — index-only field, no content needed.
                ...(article.lastOpened ? { lastOpened: article.lastOpened } : {}),
                ...(article.isDecision ? {
                    isDecision: true,
                    decisionTimeframe: article.decisionTimeframe,
                    decisionReason: article.decisionReason,
                    decisionSavedAt: article.decisionSavedAt
                } : {})
            });

            records[`article:${id}`] = {
                content: article.content || '',
                summary: article.summary || '',
                description: article.description || ''
            };
        }

        return { index, records };
    }

    /**
     * One-time migration: split the single 'articles' array (title + full
     * content + summary in one blob) into a small 'articlesIndex' (everything
     * list/search/graph/analytics views need) plus one 'article:<id>' record
     * per article (heavy content, loaded only when that article is opened).
     * Also assigns each article a stable id, replacing timestamp/array-index
     * identity used by older call sites.
     */
    static async migrateArticlesToIndexedRecords() {
        // Cheap check: a tiny dedicated flag, not the big blob. After the first
        // run, every subsequent initialize() call resolves this in O(1).
        const { articlesSchemaVersion } = await this.getLocal(['articlesSchemaVersion']);
        if (articlesSchemaVersion === this.ARTICLES_SCHEMA_VERSION) return;

        const { articles } = await this.getLocal({ articles: [] });
        if (!articles || !articles.length) {
            // New install, or already empty — nothing to migrate, just mark done.
            await this.setLocal({ articlesSchemaVersion: this.ARTICLES_SCHEMA_VERSION });
            return;
        }

        console.log(`⏳ Migrating ${articles.length} articles to indexed storage...`);

        const { index, records: recordWrites } = this.splitArticlesArray(articles);

        // Write in chunks rather than one giant set() call with hundreds of new
        // keys and all their content at once — spreads the cost, avoids a single
        // enormous synchronous write.
        const CHUNK_SIZE = 25;
        const recordKeys = Object.keys(recordWrites);
        for (let i = 0; i < recordKeys.length; i += CHUNK_SIZE) {
            const chunk = {};
            recordKeys.slice(i, i + CHUNK_SIZE).forEach(k => chunk[k] = recordWrites[k]);
            await this.setLocal(chunk);
        }

        await this.setLocal({
            articlesIndex: index,
            articlesSchemaVersion: this.ARTICLES_SCHEMA_VERSION
        });

        // Only remove the old blob once the new shape is confirmed written —
        // never delete data before its replacement is safely persisted.
        await new Promise(resolve => chrome.storage.local.remove('articles', resolve));

        console.log(`✅ Migrated ${index.length} articles to indexed storage (old 'articles' blob removed).`);
    }

    // ─────────────────────────────────────────────
    // Articles read/write API (post-migration shape)
    // ─────────────────────────────────────────────

    static async getArticlesIndex({ includeArchived = false } = {}) {
        const { articlesIndex = [] } = await this.getLocal({ articlesIndex: [] });
        return includeArchived ? articlesIndex : articlesIndex.filter(a => !a.archived);
    }

    static async getArchivedArticles() {
        const { articlesIndex = [] } = await this.getLocal({ articlesIndex: [] });
        return articlesIndex.filter(a => a.archived);
    }

    static async getArticleFull(id) {
        const key = `article:${id}`;
        const [recordData, { articlesIndex = [] }] = await Promise.all([
            this.getLocal([key]),
            this.getLocal({ articlesIndex: [] })
        ]);
        const meta = articlesIndex.find(a => a.id === id) || {};
        return { ...meta, ...(recordData[key] || {}) };
    }

    static async saveArticle({ content, summary, url, title, description, tags = [], modelId = '', connectionMode = '', summaryLength = 200, extra = {} }) {
        const id = `article_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const timestamp = new Date().toISOString();

        const { articlesIndex = [] } = await this.getLocal({ articlesIndex: [] });
        articlesIndex.push({
            id, title: title || 'Untitled', url, timestamp, tags, modelId, connectionMode, summaryLength,
            summary: summary || '',
            contentWordCount: countWordsForIndex(content || ''),
            summaryWordCount: countWordsForIndex(summary || ''),
            archived: false,
            ...extra
        });

        await this.setLocal({
            articlesIndex,
            [`article:${id}`]: { content, summary, description }
        });

        return { id, timestamp };
    }

    static async deleteArticle(id) {
        const { articlesIndex = [] } = await this.getLocal({ articlesIndex: [] });
        await this.setLocal({ articlesIndex: articlesIndex.filter(a => a.id !== id) });
        await new Promise(resolve => chrome.storage.local.remove(`article:${id}`, resolve));
    }

    // Deletes every article record, not just the index — a plain
    // setLocal({ articlesIndex: [] }) would leave every article:<id> record
    // orphaned in storage forever.
    static async clearAllArticles() {
        const { articlesIndex = [] } = await this.getLocal({ articlesIndex: [] });
        const recordKeys = articlesIndex.map(a => `article:${a.id}`);
        if (recordKeys.length) await new Promise(resolve => chrome.storage.local.remove(recordKeys, resolve));
        await this.setLocal({ articlesIndex: [] });
    }

    // Archiving is essentially free with this shape: flip a flag on the small
    // index, touch nothing else.
    static async setArticleArchived(id, archived = true) {
        const { articlesIndex = [] } = await this.getLocal({ articlesIndex: [] });
        const entry = articlesIndex.find(a => a.id === id);
        if (entry) entry.archived = archived;
        await this.setLocal({ articlesIndex });
    }

    // Records that an article was opened, for archiveGraph.js's
    // reopen-neglect fade. Index-only — no content read/write needed.
    static async touchArticleOpened(id) {
        const { articlesIndex = [] } = await this.getLocal({ articlesIndex: [] });
        const entry = articlesIndex.find(a => a.id === id);
        if (!entry) return null;
        entry.lastOpened = new Date().toISOString();
        await this.setLocal({ articlesIndex });
        return entry.lastOpened;
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
    // Send-target devices (Kindle emails, LocalSend receivers, …)
    // ─────────────────────────────────────────────

    /**
     * One-time migration: fold the old single-value 'kindleEmail'/'localSendIp'
     * settings into the unified 'devices' list (each entry: {id, label, type,
     * addresses}), so multiple Kindle/LocalSend targets can be configured
     * instead of just one of each. A dedicated 'devicesMigrated' flag makes
     * this an O(1) no-op on every subsequent startup.
     */
    static async migrateDeviceSettings() {
        const { devicesMigrated } = await this.getLocal(['devicesMigrated']);
        if (devicesMigrated) return;

        const data = await this.getAll();
        const devices = Array.isArray(data.devices) ? [...data.devices] : [];
        const activeDeviceIds = { ...(data.activeDeviceIds || {}) };

        if (data.kindleEmail && !devices.some(d => d.type === 'kindle')) {
            const id = `device_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            devices.push({ id, label: 'Kindle', type: 'kindle', addresses: [`mailto:${data.kindleEmail}`] });
            activeDeviceIds.kindle = id;
        }
        if (data.localSendIp && !devices.some(d => d.type === 'localsend')) {
            const raw = String(data.localSendIp).trim();
            const address = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
            const id = `device_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
            devices.push({ id, label: 'LocalSend Device', type: 'localsend', addresses: [address] });
            activeDeviceIds.localsend = id;
        }

        await this.setLocal({ devices, activeDeviceIds, devicesMigrated: true });
    }

    /**
     * The device to send to for a given type ('kindle' | 'localsend'): the
     * one explicitly marked active (last used, or picked in Settings), or
     * the first configured device of that type as a fallback.
     */
    static getActiveDevice(config, type) {
        const devices = Array.isArray(config.devices) ? config.devices.filter(d => d.type === type) : [];
        if (devices.length === 0) return null;
        const activeId = config.activeDeviceIds?.[type];
        return devices.find(d => d.id === activeId) || devices[0];
    }

    static async setActiveDevice(type, deviceId) {
        const { activeDeviceIds } = await this.getLocal(['activeDeviceIds']);
        await this.setLocal({ activeDeviceIds: { ...(activeDeviceIds || {}), [type]: deviceId } });
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

        // Split the old single 'articles' blob into a small index + per-article
        // records. Cheap no-op after the first run (checked via a dedicated flag,
        // not the blob itself). Every read/write call site (background.js,
        // content.js, content/core.js, mainScreen.js, articleManager.js,
        // podcastManager.js, analyticsManager.js, settingsManager.js) has been
        // switched to the articlesIndex/article:<id> shape, so it's now safe to
        // run this on every popup/service-worker startup.
        await this.migrateArticlesToIndexedRecords();

        // Fold the old single kindleEmail/localSendIp settings into the
        // unified multi-device 'devices' list. Cheap no-op after first run.
        await this.migrateDeviceSettings();

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
