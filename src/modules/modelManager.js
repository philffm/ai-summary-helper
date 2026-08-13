// Model Manager modelManager.js
// Handles service/model config and label logic

import StorageManager from './storageManager.js';

    // Handles model identifier label and tag UI
    async function updateModelIdentifierUI(serviceId, services, storageData) {
        const modelIdentifierContainer = document.getElementById('modelIdentifierContainer');
        const service = services.find(s => s.id === serviceId);
        const cfg = storageData.servicesConfig?.[serviceId] || {};
        const defaultModel = service?.defaultModel || '';
        // Normalize custom models to provider-bound objects ({ id, provider })
        const rawModels = Array.isArray(cfg.customModel) ? cfg.customModel : (cfg.customModel ? [cfg.customModel] : []);
        const models = rawModels.map(m => StorageManager.normalizeCustomModel(m, serviceId));
        const modelIds = models.map(m => m.id);

        if (modelIdentifierContainer) {
            modelIdentifierContainer.style.display = 'block';
            // Build tag list: custom models + default (if not already in custom list)
            const allModels = [...models];
            if (defaultModel && !modelIds.includes(defaultModel)) {
                allModels.push({ id: defaultModel, provider: serviceId });
            }
            modelIdentifierContainer.innerHTML = `
                <label style="display:block;margin-bottom:6px;">Model Identifiers</label>
                <div id="modelTagList" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
                  ${allModels.map(m => {
                    const isDefault = m.id === defaultModel && !modelIds.includes(m.id);
                    const safeId = m.id.replace(/"/g, '&quot;');
                    return `<span class="model-id-tag" data-model="${safeId}" data-provider="${m.provider}">${m.id}${isDefault ? ' (default)' : ''} ${!isDefault ? '<span class="remove-model-tag" style="cursor:pointer;opacity:0.6;">✕</span>' : ''}</span>`;
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
                        // Filter by id (works for both string and object entries)
                        list = list.filter(m => {
                            const id = typeof m === 'string' ? m : m?.id;
                            return id !== model;
                        });
                        StorageManager.updateService(serviceId, { customModel: list }).then(() => {
                            updateModelIdentifierUI(serviceId, services, { ...storageData, servicesConfig: { ...servicesConfig, [serviceId]: { ...servicesConfig[serviceId], customModel: list } } });
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
                        // Normalize existing entries and check for duplicates by id
                        const normalized = list.map(m => StorageManager.normalizeCustomModel(m, serviceId));
                        if (!normalized.some(m => m.id === val)) {
                            normalized.push({ id: val, provider: serviceId });
                        }
                        // Set the newly added model as the active one so it's
                        // immediately selected and retrievable.
                        StorageManager.updateService(serviceId, { customModel: normalized, activeModelId: { id: val, provider: serviceId } }).then(() => {
                            addInput.value = '';
                            updateModelIdentifierUI(serviceId, services, { ...storageData, servicesConfig: { ...servicesConfig, [serviceId]: { ...entry, customModel: normalized, activeModelId: { id: val, provider: serviceId } } } });
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
