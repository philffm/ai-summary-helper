// Model Manager modelManager.js
// Handles service/model config and label logic

    // Handles model identifier label and input logic
    async function updateModelIdentifierUI(serviceId, services, storageData) {
        const modelIdentifierInput = document.getElementById('modelIdentifier');
        const modelIdentifierLabel = document.getElementById('modelIdentifierLabel');
        const modelIdentifierContainer = document.getElementById('modelIdentifierContainer');
        const service = services.find(s => s.id === serviceId);
        const cfg = storageData.servicesConfig?.[serviceId] || {};
        // Model label always shows current model
        const currentModel = (cfg.customModel && cfg.customModel.trim() !== '') ? cfg.customModel : service.defaultModel || '';
        if (modelIdentifierLabel) {
            modelIdentifierLabel.textContent = `Model Identifier: ${currentModel}`;
        }
        // Show input by default so the user can see and edit the model identifier.
        // Previously this was hidden unconditionally which made the identifier input
        // invisible in the settings UI.
        if (modelIdentifierContainer) {
            modelIdentifierContainer.style.display = 'block';
        }
        // Only set input value if editing
        if (modelIdentifierInput) {
            modelIdentifierInput.value = cfg.customModel || '';
            modelIdentifierInput.oninput = () => {
                chrome.storage.sync.get(null, storageData => {
                    const servicesConfig = storageData.servicesConfig || {};
                    servicesConfig[serviceId] = {
                        ...servicesConfig[serviceId],
                        customModel: modelIdentifierInput.value
                    };
                    chrome.storage.sync.set({ servicesConfig }, () => {
                        if (modelIdentifierLabel) {
                            modelIdentifierLabel.textContent = `Model Identifier: ${modelIdentifierInput.value}`;
                        }
                    });
                });
            };
        }
    }

// Expose for use in settingsManager.js
export { updateModelIdentifierUI };
