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
                    let activeService = data.activeService || 'openai';
                    // If the activeService is not in the available services, fall back to the first one
                    if (!services.some(s => s.id === activeService)) {
                        activeService = services.length > 0 ? services[0].id : '';
                        await StorageManager.set({ activeService });
                    }
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
                    const themeSelect = document.getElementById('themeSelect');
                    const betaPodcastToggle = document.getElementById('betaPodcastToggle');
                    const storageData = await StorageManager.getAll();
                    
                    if (themeSelect) {
                        const savedTheme = storageData.theme || 'system';
                        themeSelect.value = savedTheme;
                        
                        // APPLY THEME IMMEDIATELY ON LOAD
                        if (savedTheme === 'dark' || savedTheme === 'light') {
                            document.documentElement.setAttribute('data-theme', savedTheme);
                        } else {
                            document.documentElement.removeAttribute('data-theme');
                        }
                    }
                    if (betaPodcastToggle) {
                        betaPodcastToggle.checked = !!storageData.betaPodcast;
                    }
                    const nativeSidePanelToggle = document.getElementById('nativeSidePanelToggle');
                    if (nativeSidePanelToggle) {
                        nativeSidePanelToggle.checked = !!storageData.useNativeSidePanel;
                    }
                    const openLargeToggle = document.getElementById('openLargeToggle');
                    if (openLargeToggle) {
                        openLargeToggle.checked = !!storageData.openLarge;
                    }
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
                  
                  <div class="setting-group" style="margin-bottom: var(--spacing-s-3); display: flex; justify-content: space-between; align-items: center;">
                    <label for="themeSelect">Theme</label>
                    <select id="themeSelect" style="width: auto; margin-bottom: 0;">
                        <option value="system">System Default</option>
                        <option value="light">Light Mode</option>
                        <option value="dark">Dark Mode</option>
                    </select>
                  </div>

                  <div class="setting-group" style="margin-bottom: var(--spacing-s-3); display: flex; justify-content: space-between; align-items: center;">
                    <label for="openLargeToggle" style="margin: 0; font-weight: normal; cursor: pointer;">Open Large by Default</label>
                    <label class="switch">
                      <input type="checkbox" id="openLargeToggle" />
                      <span class="slider-toggle"></span>
                    </label>
                  </div>

                  <div class="setting-group" style="margin-bottom: var(--spacing-s-3); display: flex; justify-content: space-between; align-items: center;">
                    <label for="nativeSidePanelToggle" style="margin: 0; font-weight: normal; cursor: pointer;">Use Native Side Panel</label>
                    <label class="switch">
                      <input type="checkbox" id="nativeSidePanelToggle" />
                      <span class="slider-toggle"></span>
                    </label>
                  </div>
                  
                  <div class="setting-group" style="margin-bottom: var(--spacing-s-4); display: flex; justify-content: space-between; align-items: center;">
                    <label for="betaPodcastToggle" style="margin: 0; font-weight: normal; cursor: pointer;">Enable Podcast Beta</label>
                    <label class="switch">
                      <input type="checkbox" id="betaPodcastToggle" />
                      <span class="slider-toggle"></span>
                    </label>
                  </div>
                  
                  <div style="margin-top: var(--spacing-s-4); padding-top: var(--spacing-s-3); border-top: 2px solid var(--danger);">
                    <p style="font-size: 12px; font-weight: 700; color: var(--danger); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: var(--spacing-s-3);">⚠️ Danger Zone</p>
                    <div style="display: flex; gap: var(--spacing-s-2);">
                      <button id="deleteSettingsButton" class="button danger" style="flex:1;">Delete Settings</button>
                      <button id="deleteHistoryButton" class="button danger" style="flex:1;">Delete History</button>
                    </div>
                  </div>
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
    const saveButton = document.querySelector('button[form="settingsForm"]');

    // ── Auto-save helper: saves a key/value and flashes the save button ──
    const autoSave = async (key, value) => {
        await StorageManager.set({ [key]: value });
        if (saveButton) {
            const origText = saveButton.textContent;
            const origBg = saveButton.style.background;
            const origColor = saveButton.style.color;
            saveButton.textContent = 'Saved!';
            saveButton.style.background = '#2ecc40';
            saveButton.style.color = '#fff';
            saveButton.disabled = true;
            setTimeout(() => {
                saveButton.textContent = origText;
                saveButton.style.background = origBg;
                saveButton.style.color = origColor;
            }, 1500);
        }
    };

    // ── Auto-save on individual setting changes ──────────────────────────
    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) {
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

    const betaPodcastToggle = document.getElementById('betaPodcastToggle');
    if (betaPodcastToggle) {
        betaPodcastToggle.addEventListener('change', () => {
            autoSave('betaPodcast', betaPodcastToggle.checked);
            const podcastButton = document.getElementById('podcastButton');
            if (podcastButton) {
                podcastButton.style.display = betaPodcastToggle.checked ? 'inline-flex' : 'none';
            }
        });
    }

    const nativeSidePanelToggle = document.getElementById('nativeSidePanelToggle');
    if (nativeSidePanelToggle) {
        nativeSidePanelToggle.addEventListener('change', () => {
            autoSave('useNativeSidePanel', nativeSidePanelToggle.checked);
        });
    }

    const openLargeToggle = document.getElementById('openLargeToggle');
    if (openLargeToggle) {
        openLargeToggle.addEventListener('change', () => {
            autoSave('openLarge', openLargeToggle.checked);
        });
    }

    // Auto-save model selection
    const modelSelect = document.getElementById('model');
    if (modelSelect) {
        modelSelect.addEventListener('change', async () => {
            await StorageManager.set({ activeService: modelSelect.value });
            autoSave('activeService', modelSelect.value);
        });
    }

    // Auto-save prompt selection
    const promptSelect = document.getElementById('promptSelect');
    if (promptSelect) {
        promptSelect.addEventListener('change', () => {
            const promptType = promptSelect.value === 'custom' ? 'custom' : 'preset';
            StorageManager.set({ presetPrompt: promptSelect.value, promptType });
            autoSave('presetPrompt', promptSelect.value);
        });
    }

    // Initialize summary length slider
    if (summaryLengthSlider && summaryLengthValue) {
        chrome.storage.local.get(['summaryLength'], data => {
            const length = data.summaryLength || 200;
            summaryLengthSlider.value = length;
            summaryLengthValue.textContent = length;
            // Force the blue fill track and chip label to recalculate
            summaryLengthSlider.dispatchEvent(new Event('input'));
        });
        summaryLengthSlider.addEventListener('input', () => {
            const newLength = summaryLengthSlider.value;
            summaryLengthValue.textContent = newLength;
            chrome.storage.local.set({ summaryLength: newLength });
        });
    }

    // Settings form submit — only handles fields not auto-saved (API key, endpoint, custom prompt)
    if (settingsForm) {
        settingsForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const apiKeyInput = document.getElementById('apiKey');
            const endpointInput = document.getElementById('customEndpoint');
            const promptInput = document.getElementById('prompt');
            const activeService = (document.getElementById('model') || {}).value || 'openai';

            const storageData = await StorageManager.getAll();
            const servicesConfig = storageData.servicesConfig || {};
            const existing = servicesConfig[activeService] || {};
            servicesConfig[activeService] = {
                ...existing,
                apiKey: apiKeyInput ? apiKeyInput.value : (existing.apiKey || ''),
                endpoint: endpointInput ? endpointInput.value : (existing.endpoint || ''),
                customModel: existing.customModel || [],
                activeModelId: existing.activeModelId || ''
            };
            await StorageManager.set({ servicesConfig });
            if (promptInput) {
                await StorageManager.set({ prompt: promptInput.value });
            }
            autoSave('servicesConfig', servicesConfig);
        });
    }
}

/**
 * Initializes the summary length slider and syncs with storage.
 * @param {HTMLElement} summaryLengthSlider - The slider element.
 * @param {HTMLElement} summaryLengthValue - The value display element.
 */
export { initSettingsManager };
