// Settings Manager
// Handles settings form and persistence

import StorageManager from './storageManager.js';
import { initPromptManager } from './promptManager.js';
import { updateModelIdentifierUI } from './modelManager.js';

function initSettingsManager(ui) {

                // Helper to update API key link, endpoint visibility, and field values
                async function updateServiceUI(serviceId, services, storageData) {
                    // Get input elements first
                    const apiKeyLink = document.getElementById('apiKeyLink');
                    const apiKeyInput = document.getElementById('apiKey');
                    const modelIdentifierInput = document.getElementById('modelIdentifier');
                    const endpointInput = document.getElementById('customEndpoint');
                    const apiKeyContainer = document.getElementById('apiKeyContainer');
                    const customEndpointContainer = document.getElementById('customEndpointContainer');
                    const modelIdentifierLabel = document.getElementById('modelIdentifierLabel');
                    const modelIdentifierContainer = document.getElementById('modelIdentifierContainer');

                    // Add listeners to save changes
                    if (apiKeyInput) {
                        apiKeyInput.oninput = () => {
                            StorageManager.updateService(serviceId, { apiKey: apiKeyInput.value });
                        };
                    }
                    if (endpointInput) {
                        endpointInput.oninput = () => {
                            StorageManager.updateService(serviceId, { endpoint: endpointInput.value });
                        };
                    }

                    // Use modular model identifier UI logic
                    updateModelIdentifierUI(serviceId, services, storageData);

                    const service = services.find(s => s.id === serviceId);
                    if (!service) return;
                    if (apiKeyLink) {
                        apiKeyLink.innerHTML = service.apiKeyDocumentationUrl ? `(<a href="${service.apiKeyDocumentationUrl}" target="_blank">Get your API key</a>)` : '';
                    }
                    if (customEndpointContainer) {
                        customEndpointContainer.style.display = service.allowCustomEndpoint ? 'block' : 'none';
                    }
                    if (apiKeyContainer) {
                        apiKeyContainer.style.display = 'block';
                    }
                    // Populate fields from storage
                    const cfg = storageData.servicesConfig?.[serviceId] || {};
                    if (apiKeyInput) apiKeyInput.value = cfg.apiKey || '';
                    if (endpointInput) endpointInput.value = cfg.endpoint || service.endpointUrl || '';
                }

                // Populate model/service dropdown
                async function populateModelDropdown() {
                    const modelSelect = document.getElementById('model');
                    if (!modelSelect) return;
                    const services = await StorageManager.getServices();
                    modelSelect.innerHTML = '';
                    services.forEach(service => {
                        const option = document.createElement('option');
                        option.value = service.id;
                        option.textContent = service.name;
                        modelSelect.appendChild(option);
                    });

                    // Load current selection and config from storage
                    const data = await StorageManager.getAll();
                    const activeService = data.activeService || 'openai';
                    modelSelect.value = activeService;
                    await updateServiceUI(activeService, services, data);

                    // Listen for changes
                    modelSelect.addEventListener('change', async () => {
                        const selectedId = modelSelect.value;
                        await updateServiceUI(selectedId, services, await StorageManager.getAll());
                        StorageManager.set({ activeService: selectedId });
                    });
                }

                // Load initial settings and populate UI
                async function loadSettings() {
                    await populateModelDropdown();
                    // You can add more logic here to load other settings (prompt, etc.)
                }

                                loadSettings();

    // Dynamically render accordion items for settings
    const accordionContainer = document.querySelector('.accordion');
    if (accordionContainer) {
        accordionContainer.innerHTML = '';
        const accordionItems = [
            {
                button: '🤖 Model',
                content: `
                  <p>Choose the LLM model you want to use to generate the summary.</p>
                  <label for="model">Model <span id="apiKeyLink" style="font-weight: normal"></span></label>
                  <select id="model"></select>
                  <div id="modelIdentifierContainer">
                    <label id="modelIdentifierLabel" for="modelIdentifier">Model Identifier: (default)</label>
                    <input type="text" id="modelIdentifier" placeholder="e.g., gpt-5-mini, llama3.2, mistral-large-latest" />
                  </div>
                  <div id="apiKeyContainer">
                    <label for="apiKey">API Key:</label>
                    <input type="text" id="apiKey" name="apiKey" />
                    <label class="light" for="apiKey">🔒 The API key is stored locally in your browser.</label>
                  </div>
                  <div id="customEndpointContainer" style="display: none">
                    <label for="customEndpoint">Endpoint URL:</label>
                    <input type="text" id="customEndpoint" placeholder="http://localhost:11434/api/chat" />
                  </div>
                `
            },
            {
                button: '💬 Prompt',
                content: `
                  <p>Choose the prompt you want to use to generate the summary.</p>
                  <label for="promptSelect">Prompt <a href="https://github.com/philffm/ai-summary-helper/blob/main/chrome-extension/prompts.json" target="_blank">(View all & contribute)</a></label>
                  <select id="promptSelect"></select>
                  <textarea id="prompt" placeholder="Enter your custom prompt here"></textarea>
                `
            },
            {
                button: '🔄 General Settings',
                content: `
                  <p>General settings for the extension.</p>
                  <button id="deleteSettingsButton" class="button danger">Delete Settings</button>
                  <button id="deleteHistoryButton" class="button danger">Delete History</button>
                `
            }
        ];
        accordionItems.forEach(item => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'accordion-item';
            const button = document.createElement('button');
            button.className = 'accordion-button';
            button.innerHTML = item.button;
            const content = document.createElement('div');
            content.className = 'accordion-content';
            content.innerHTML = item.content;
            itemDiv.appendChild(button);
            itemDiv.appendChild(content);
            accordionContainer.appendChild(itemDiv);
        });
        // After rendering, populate model dropdown and update API key link
        setTimeout(() => {
            loadSettings();
            // Initialize prompt manager after accordion is rendered
            const promptSelect = document.getElementById('promptSelect');
            const promptInput = document.getElementById('prompt');
            if (promptSelect && promptInput) {
                initPromptManager(promptSelect, promptInput);
            }
        }, 0);
    }
    // Settings form logic
    const settingsForm = document.getElementById('settingsForm');
    const summaryLengthSlider = document.getElementById('summaryLength');
    const summaryLengthValue = document.getElementById('summaryLengthValue');
    const settingsButton = document.getElementById('toggleScreenButton');

    // Wire up settings button to show settings screen
    if (settingsButton && ui && typeof ui.showScreen === 'function') {
        settingsButton.addEventListener('click', () => {
            ui.showScreen('settings');
        });
    }

    // Initialize summary length slider
    if (summaryLengthSlider && summaryLengthValue) {
        chrome.storage.local.get(['summaryLength'], data => {
            const length = data.summaryLength || 500;
            summaryLengthSlider.value = length;
            summaryLengthValue.textContent = length;
        });
        summaryLengthSlider.addEventListener('input', () => {
            const newLength = summaryLengthSlider.value;
            summaryLengthValue.textContent = newLength;
            chrome.storage.local.set({ summaryLength: newLength });
        });
    }

    // Settings form submit logic (if form exists)
    if (settingsForm) {
        settingsForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            // Gather all settings fields
            const modelSelect = document.getElementById('model');
            const apiKeyInput = document.getElementById('apiKey');
            const modelIdentifierInput = document.getElementById('modelIdentifier');
            const endpointInput = document.getElementById('customEndpoint');
            const promptSelect = document.getElementById('promptSelect');
            const promptInput = document.getElementById('prompt');
            const saveButton = settingsForm.querySelector('button[type="submit"]');

            // Get selected service
            const activeService = modelSelect ? modelSelect.value : 'openai';
            // Get current config from storage
            const storageData = await StorageManager.getAll();
            const servicesConfig = storageData.servicesConfig || {};
            // Preserve any existing fields (like `model`) when updating the service entry
            const prevCfg = servicesConfig[activeService] || {};
            // Ensure we have service metadata so we can fall back to the service default model
            const servicesMeta = await StorageManager.getServices();
            const serviceMeta = servicesMeta.find(s => s.id === activeService);
            const defaultModel = serviceMeta?.defaultModel || '';

            servicesConfig[activeService] = {
                // keep previously saved model if present, otherwise fall back to the service default
                model: prevCfg.model || defaultModel,
                apiKey: apiKeyInput ? apiKeyInput.value : (prevCfg.apiKey || ''),
                customModel: modelIdentifierInput ? modelIdentifierInput.value : (prevCfg.customModel || ''),
                endpoint: endpointInput ? endpointInput.value : (prevCfg.endpoint || '')
            };
            // Save active service
            await StorageManager.set({ activeService });
            // Save service config
            await StorageManager.set({ servicesConfig });

            // Save prompt selection and custom prompt using canonical keys
            // used throughout the app: `prompt`, `presetPrompt`, and `promptType`.
            if (promptSelect) {
                const promptType = (promptSelect.value === 'custom') ? 'custom' : 'preset';
                await StorageManager.set({ presetPrompt: promptSelect.value, promptType });
            }
            if (promptInput) {
                await StorageManager.set({ prompt: promptInput.value });
            }

            // Button feedback: turn green and show 'Saved!'
            if (saveButton) {
                const originalText = saveButton.textContent;
                const originalClass = saveButton.className;
                const originalBg = saveButton.style.background;
                const originalColor = saveButton.style.color;
                const originalDisabled = saveButton.disabled;
                saveButton.textContent = 'Saved!';
                saveButton.className += ' saved';
                saveButton.style.background = '#2ecc40';
                saveButton.style.color = '#fff';
                saveButton.disabled = true;
                setTimeout(() => {
                    saveButton.textContent = originalText;
                    saveButton.className = originalClass;
                    saveButton.style.background = originalBg;
                    saveButton.style.color = originalColor;
                    saveButton.disabled = originalDisabled;
                }, 2000);
            }
        });
    }
}

/**
 * Initializes the summary length slider and syncs with storage.
 * @param {HTMLElement} summaryLengthSlider - The slider element.
 * @param {HTMLElement} summaryLengthValue - The value display element.
 */
export { initSettingsManager };
