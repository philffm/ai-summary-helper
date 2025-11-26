class StorageManager {
    static DEFAULTS = {
        prompt: `- brief summary
    - fun standup comedy set on the topic
    - what does it mean for my profession (ux)
    - book recommendations`,
        promptType: 'custom',
        model: 'openai',
        selectedLanguage: 'en-US'
    };

    static async get(key) {
        return new Promise(resolve => chrome.storage.sync.get(key, resolve));
    }

    static async set(data) {
        return new Promise(resolve => chrome.storage.sync.set(data, resolve));
    }

    static async getLocal(key) {
        return new Promise(resolve => chrome.storage.local.get(key, resolve));
    }

    static async setLocal(data) {
        return new Promise(resolve => chrome.storage.local.set(data, resolve));
    }

    static async initializeDefaults() {
        const data = await this.get(null);
        if (!data.prompt) await this.set(this.DEFAULTS);
    }

    static async getServices() {
        const response = await fetch('services.json');
        if (!response.ok) {
            throw new Error('Failed to load services.json');
        }
        return response.json();
    }

    static async getModelConfig() {
        const data = await this.get(['model', 'customEndpoint', 'modelIdentifier']);
        const services = await this.getServices();
        const model = data.model || this.DEFAULTS.model;
        const service = services.find(s => s.defaultModel === model);

        return {
            modelIdentifier: data.modelIdentifier || service.defaultModel,
            endpointUrl: model === 'openai' ? 'https://api.openai.com/v1/chat/completions' : data.customEndpoint || service.endpointUrl
        };
    }
}

export default StorageManager;
