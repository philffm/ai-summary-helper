// Model Manager modelManager.js
// Handles service/model config and label logic

import StorageManager from './storageManager.js';

    // Handles model identifier label and tag UI
    async function updateModelIdentifierUI(serviceId, services, storageData) {
        const modelIdentifierContainer = document.getElementById('modelIdentifierContainer');
        const service = services.find(s => s.id === serviceId);
        const cfg = storageData.servicesConfig?.[serviceId] || {};
        const defaultModel = service?.defaultModel || '';
        const models = Array.isArray(cfg.customModel) ? cfg.customModel : (cfg.customModel ? [cfg.customModel] : []);

        if (modelIdentifierContainer) {
            modelIdentifierContainer.style.display = 'block';
            // Build tag list: custom models + default (if not already in custom list)
            const allModels = [...models];
            if (defaultModel && !allModels.includes(defaultModel)) {
                allModels.push(defaultModel);
            }
            modelIdentifierContainer.innerHTML = `
                <label style="display:block;margin-bottom:6px;">Model Identifiers</label>
                <div id="modelTagList" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
                  ${allModels.map(m => {
                    const isDefault = m === defaultModel && !models.includes(m);
                    return `<span class="model-id-tag" data-model="${m.replace(/"/g, '&quot;')}">${m}${isDefault ? ' (default)' : ''} ${!isDefault ? '<span class="remove-model-tag" style="cursor:pointer;opacity:0.6;">✕</span>' : ''}</span>`;
                  }).join('')}
                </div>
                </div>
                <div style="display:flex;gap:6px;">
                  <input type="text" id="addModelInput" placeholder="e.g. gpt-5-mini" style="flex:1;padding:8px 10px;" />
                  <button id="addModelBtn" class="button-secondary" style="flex-shrink:0;">+ Add</button>
                </div>
            `;

            // Wire up remove buttons
            modelIdentifierContainer.querySelectorAll('.remove-model-tag').forEach(el => {
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const tag = el.closest('.model-id-tag');
                    const model = tag.dataset.model;
                    StorageManager.get(null).then(storageData => {
                        const servicesConfig = storageData.servicesConfig || {};
                        let list = Array.isArray(servicesConfig[serviceId]?.customModel)
                          ? [...servicesConfig[serviceId].customModel]
                          : [];
                        StorageManager.updateService(serviceId, { customModel: list.filter(m => m !== model) }).then(() => {
                            updateModelIdentifierUI(serviceId, services, { ...storageData, servicesConfig: { ...servicesConfig, [serviceId]: { ...servicesConfig[serviceId], customModel: list.filter(m => m !== model) } } });
                        });
                    });
                });
            });

            // Wire up add button
            const addBtn = document.getElementById('addModelBtn');
            const addInput = document.getElementById('addModelInput');
            if (addBtn && addInput) {
                const addModel = () => {
                    const val = addInput.value.trim();
                    if (!val) return;
                    StorageManager.get(null).then(storageData => {
                        const servicesConfig = storageData.servicesConfig || {};
                        const entry = servicesConfig[serviceId] || {};
                        let list = Array.isArray(entry.customModel) ? [...entry.customModel] : (entry.customModel ? [entry.customModel] : []);
                        if (!list.includes(val)) list.push(val);
                        StorageManager.updateService(serviceId, { customModel: list }).then(() => {
                            addInput.value = '';
                            updateModelIdentifierUI(serviceId, services, { ...storageData, servicesConfig: { ...servicesConfig, [serviceId]: { ...entry, customModel: list } } });
                        });
                    });
                };
                addBtn.addEventListener('click', addModel);
                addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addModel(); });
            }
        }
    }

// Expose for use in settingsManager.js
export { updateModelIdentifierUI };
