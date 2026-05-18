import UIManager from './modules/uiManager.js';
import StorageManager from './modules/storageManager.js';
import { initArticleManager } from './modules/articleManager.js';
import { initPromptManager } from './modules/promptManager.js';
import { initSettingsManager } from './modules/settingsManager.js';
// import { initModelManager } from './modules/modelManager.js';
import { initLanguageManager } from './modules/languageManager.js';
// import { initPodcastManager } from './modules/podcastManager.js';
// Use window.initPodcastManager if needed
import { initShortcuts } from './modules/shortcuts.js';
import { initMainScreen } from './modules/mainScreen.js';
import { initToolsManager } from './modules/toolsManager.js';
import { initAccordion } from './modules/accordion.js';

document.addEventListener("DOMContentLoaded", async () => {
    // Hide podcast button by default
    const initialPodcastBtn = document.getElementById('podcastButton');
    if (initialPodcastBtn) initialPodcastBtn.style.display = 'none';

    // Load theme and beta toggle preferences
    const storageData = await StorageManager.getAll();
    if (storageData.theme === 'dark' || storageData.theme === 'light') {
        document.documentElement.setAttribute('data-theme', storageData.theme);
    }
    
    if (initialPodcastBtn) {
        initialPodcastBtn.style.display = storageData.betaPodcast ? 'inline-flex' : 'none';
    }
    const ui = new UIManager();

    StorageManager.initializeDefaults();

    // ── Apply UI language setting ───────────────────────────────────────
    chrome.storage.sync.get('uiLanguage', (data) => {
        if (data.uiLanguage) {
            document.documentElement.lang = data.uiLanguage;
        }
    });

    // initModelManager(ui); // Not exported from modelManager.js
    initPromptManager(ui);
    initSettingsManager(ui);
    initLanguageManager(ui);
    initToolsManager(ui);
    if (window.initPodcastManager) {
        window.initPodcastManager(ui);
    }
    initShortcuts(ui);
    initMainScreen(ui);
    initArticleManager(ui);
    initAccordion(ui);

    ui.showScreen("main");

    // ── Auto-open native side panel if enabled ──────────────────────────
    chrome.storage.sync.get('useNativeSidePanel', (data) => {
        if (data.useNativeSidePanel) {
            chrome.runtime.sendMessage({ action: 'openNativeSidePanel' }, (response) => {
                if (response?.success) window.close();
            });
        }
    });

    // ── Pop-out to Sidebar ─────────────────────────────────────────────
    const popoutBtn = document.getElementById('popoutButton');
    if (popoutBtn) {
        popoutBtn.addEventListener('click', async () => {
            try {
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
                const activeTab = tabs[0];
                const { useNativeSidePanel } = await chrome.storage.sync.get('useNativeSidePanel').catch(() => ({}));

                // Native side panel (opt-in)
                if (useNativeSidePanel) {
                    chrome.runtime.sendMessage({ action: 'openNativeSidePanel' }, (response) => {
                        if (response?.success) window.close();
                    });
                    return;
                }

                // Default: hybrid injected iframe
                if (activeTab) {
                    const mod = await import('./modules/mainScreen.js').catch(() => null);
                    if (mod?.ensureContentScript) {
                        await mod.ensureContentScript(activeTab.id, activeTab.url).catch(() => {});
                        chrome.tabs.sendMessage(activeTab.id, { action: 'toggleHybridSidebar' }).catch(() => {});
                    }
                }
                window.close();
            } catch (err) {
                console.error('[sidePanel] Failed:', err.message);
            }
        });
    }

    // ── Slider fill track ───────────────────────────────────────────────
    const summarySlider = document.getElementById('summaryLength');
    const summaryLengthValue = document.getElementById('summaryLengthValue');
    const chipLengthLabel = document.getElementById('chipLengthLabel');
    if (summarySlider) {
        const updateSliderFill = () => {
            const min = summarySlider.min || 100;
            const max = summarySlider.max || 500;
            const val = parseInt(summarySlider.value);
            const pct = ((val - min) / (max - min)) * 100;
            summarySlider.style.setProperty('--range-progress', pct + '%');
            if (summaryLengthValue) summaryLengthValue.textContent = val;
            if (chipLengthLabel) chipLengthLabel.textContent = val + 'w';
        };
        summarySlider.addEventListener('input', updateSliderFill);
        updateSliderFill();
    }

    // ── Chip toggles (length / mode) ────────────────────────────────────
    const chips = document.querySelectorAll('.chip[data-panel]');
    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            const panelId = 'panel' + chip.dataset.panel.charAt(0).toUpperCase() + chip.dataset.panel.slice(1);
            const panel = document.getElementById(panelId);
            if (!panel) return;
            const isOpen = panel.style.display === 'block';
            // Close all panels
            document.querySelectorAll('.chip-panel').forEach(p => p.style.display = 'none');
            chips.forEach(c => c.classList.remove('active'));
            // Toggle this one
            if (!isOpen) {
                panel.style.display = 'block';
                chip.classList.add('active');
                // Auto-focus language search input
                if (panelId === 'panelLanguage') {
                    const searchInput = document.getElementById('languageSearch');
                    if (searchInput) setTimeout(() => searchInput.focus(), 50);
                }
                // Refresh model data from storage when model panel opens
                if (panelId === 'panelModel') {
                    refreshModelChip();
                }
            }
        });
    });

    // ── Language Tag Panel ──────────────────────────────────────────────
    const languageSelect = document.getElementById('languageSelect');
    const chipLanguageLabel = document.getElementById('chipLanguageLabel');
    const chipLanguageIcon = document.querySelector('.chip[data-panel="language"] .chip-icon');
    const languageTagGrid = document.getElementById('languageTagGrid');
    const languageSearch = document.getElementById('languageSearch');

    if (languageSelect && languageTagGrid) {
        const renderTags = (filter = '') => {
            languageTagGrid.innerHTML = '';
            const lower = filter.toLowerCase();
            Array.from(languageSelect.options).forEach(option => {
                const text = option.textContent.trim();
                const shortCode = option.value.split('-')[0].toUpperCase();
                if (filter && !text.toLowerCase().includes(lower) && !shortCode.toLowerCase().includes(lower)) return;
                const btn = document.createElement('button');
                btn.className = 'tag-btn';
                const flagEmoji = text.split(/\s/)[0] || '🌐';
                const name = text.split(/\s/).slice(1).join(' ') || shortCode;
                btn.innerHTML = `<span class="tag-flag">${flagEmoji}</span> ${name}`;
                btn.title = name;
                if (option.selected) btn.classList.add('active');
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    languageSelect.value = option.value;
                    languageSelect.dispatchEvent(new Event('change'));
                    // Close the panel
                    document.getElementById('panelLanguage').style.display = 'none';
                    document.querySelector('.chip[data-panel="language"]').classList.remove('active');
                });
                languageTagGrid.appendChild(btn);
            });
        };

        const observer = new MutationObserver(() => renderTags());
        observer.observe(languageSelect, { childList: true });

        if (languageSearch) {
            languageSearch.addEventListener('input', () => renderTags(languageSearch.value));
        }

        languageSelect.addEventListener('change', () => {
            const code = languageSelect.value || 'EN';
            const shortCode = code.split('-')[0].toUpperCase();
            chipLanguageLabel.textContent = shortCode;
            const selectedOption = languageSelect.options[languageSelect.selectedIndex];
            if (chipLanguageIcon && selectedOption) {
                chipLanguageIcon.textContent = selectedOption.textContent.trim().split(/\s/)[0] || '🌐';
            }
            renderTags(languageSearch?.value || '');
        });
    }

    // ── Model Tag Panel ────────────────────────────────────────────────
    const modelSelect = document.getElementById('modelSelect');
    const chipModelLabel = document.getElementById('chipModelLabel');
    const modelProviderGrid = document.getElementById('modelProviderGrid');
    const modelIdGrid = document.getElementById('modelIdGrid');
    const modelSettingsLink = document.getElementById('modelSettingsLink');
    const customModelInput = document.getElementById('customModelInput');
    const setCustomModelBtn = document.getElementById('setCustomModelBtn');

    let servicesMetaCache = [];

    // Refresh chip label from storage (used on init + whenever main screen shows)
    const refreshModelChip = async () => {
        const { servicesConfig, activeService } = await chrome.storage.sync.get(['servicesConfig', 'activeService']);
        const svcId = activeService || 'openai';
        const meta = servicesMetaCache.find(s => s.id === svcId);
        const cfg = (servicesConfig || {})[svcId] || {};
        const def = meta?.defaultModel || '';
        const custom = Array.isArray(cfg.customModel) ? cfg.customModel : [];
        const active = cfg.activeModelId || custom[0] || def;
        if (chipModelLabel) chipModelLabel.textContent = active || svcId;
    };

    if (modelSettingsLink) {
        modelSettingsLink.addEventListener('click', () => {
            document.getElementById('panelModel').style.display = 'none';
            document.querySelector('.chip[data-panel="model"]').classList.remove('active');
            ui.showScreen('settings');
        });
    }

    if (modelSelect && modelProviderGrid) {
        fetch('services.json')
            .then(r => r.json())
            .then(services => {
                servicesMetaCache = services;
                modelSelect.innerHTML = '';
                services.forEach(svc => {
                    const opt = document.createElement('option');
                    opt.value = svc.id;
                    opt.textContent = svc.name;
                    modelSelect.appendChild(opt);
                });
                chrome.storage.sync.get('activeService', data => {
                    const active = data.activeService || 'openai';
                    if (modelSelect.querySelector(`option[value="${active}"]`)) {
                        modelSelect.value = active;
                    }
                    modelSelect.dispatchEvent(new Event('change'));
                });
                // Refresh chip label once services are loaded
                refreshModelChip();
            })
            .catch(e => console.error('Error loading services:', e));

        const renderUI = () => {
            chrome.storage.sync.get('servicesConfig', ({ servicesConfig }) => {
                const curSvcId = modelSelect.value;
                const meta = servicesMetaCache.find(s => s.id === curSvcId);
                const defModel = meta?.defaultModel || '';
                const cfg = (servicesConfig || {})[curSvcId] || {};
                const hasConfig = !!(cfg.apiKey || cfg.endpoint);
                const customModels = Array.isArray(cfg.customModel) ? cfg.customModel : (cfg.customModel ? [cfg.customModel] : []);
                // Active model = activeModelId, or first custom, or default
                const activeModel = cfg.activeModelId || customModels[0] || defModel;
                // Build list: active first, then custom models, then default
                const allModels = [
                    activeModel,
                    ...customModels.filter(m => m !== activeModel),
                    ...(activeModel !== defModel && !customModels.includes(defModel) && defModel ? [defModel] : [])
                ];
                // Remove exact duplicates while preserving order
                const deduped = allModels.filter((m, i, a) => a.indexOf(m) === i);

                // Update chip label to show only the active model ID
                chipModelLabel.textContent = activeModel;

                // Provider tags
                modelProviderGrid.innerHTML = '';
                Array.from(modelSelect.options).forEach(option => {
                    const btn = document.createElement('button');
                    btn.className = 'tag-btn';
                    btn.textContent = option.textContent;
                    if (option.selected) btn.classList.add('active');
                    if (hasConfig && !option.selected) btn.style.borderColor = 'var(--accent-light)';
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        modelSelect.value = option.value;
                        modelSelect.dispatchEvent(new Event('change'));
                    });
                    modelProviderGrid.appendChild(btn);
                });

                // Model ID tags for selected provider
                modelIdGrid.innerHTML = '';
                if (deduped.length === 0) {
                    modelIdGrid.innerHTML = '<span style="font-size:11px;color:var(--text-muted);padding:4px 0;">No models configured</span>';
                    return;
                }
                deduped.forEach((modelId) => {
                    const btn = document.createElement('button');
                    btn.className = 'tag-btn';
                    btn.textContent = modelId;
                    if (modelId === activeModel) btn.classList.add('active');
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        chrome.storage.sync.get('servicesConfig', ({ servicesConfig: sc }) => {
                            const c = { ...(sc || {}) };
                            const entry = { ...(c[curSvcId] || {}) };
                            entry.activeModelId = modelId;
                            c[curSvcId] = entry;
                            chrome.storage.sync.set({ servicesConfig: c }, () => {
                                renderUI();
                            });
                        });
                    });
                    modelIdGrid.appendChild(btn);
                });

                if (customModelInput) customModelInput.value = '';
            });
        };

        const observer = new MutationObserver(renderUI);
        observer.observe(modelSelect, { childList: true });

        modelSelect.addEventListener('change', () => {
            const selected = modelSelect.options[modelSelect.selectedIndex];
            if (selected) {
                chrome.storage.sync.set({ activeService: modelSelect.value });
            }
            renderUI();
        });

        if (setCustomModelBtn && customModelInput) {
            setCustomModelBtn.addEventListener('click', () => {
                const val = customModelInput.value.trim();
                if (!val) return;
                const svcId = modelSelect.value;
                chrome.storage.sync.get('servicesConfig', ({ servicesConfig }) => {
                    const cfg = { ...(servicesConfig || {}) };
                    const entry = cfg[svcId] || {};
                    let list = Array.isArray(entry.customModel) ? [...entry.customModel] : [];
                    if (!list.includes(val)) list.push(val);
                    cfg[svcId] = { ...entry, customModel: list };
                    chrome.storage.sync.set({ servicesConfig: cfg }, () => {
                        customModelInput.value = '';
                        renderUI();
                    });
                });
            });
        }
    }

    // ── Bottom Nav ──────────────────────────────────────────────────────
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const screen = item.dataset.screen;
            if (screen === 'main' || screen === 'history' || screen === 'settings' || screen === 'apps') {
                ui.showScreen(screen);
            }
        });
    });

    // Reposition the nav blob when the window resizes
    window.addEventListener('resize', () => {
        const activeScreen = document.querySelector('.nav-item.active')?.dataset.screen;
        if (activeScreen) ui.positionNavBlob(activeScreen);
    });

    // ── Mode Selector ───────────────────────────────────────────────────
    const modeTabs = document.querySelectorAll('.mode-tab');
    const chipModeLabel = document.getElementById('chipModeLabel');
    modeTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            modeTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const mode = tab.dataset.mode;
            chrome.storage.local.set({ summaryMode: mode });
            if (chipModeLabel) chipModeLabel.textContent = mode === 'extension' ? 'Ext' : 'Inl';
        });
    });

    // Restore saved mode
    chrome.storage.local.get(['summaryMode'], data => {
        if (data.summaryMode) {
            modeTabs.forEach(t => {
                t.classList.toggle('active', t.dataset.mode === data.summaryMode);
            });
            if (chipModeLabel) chipModeLabel.textContent = data.summaryMode === 'extension' ? 'Ext' : 'Inl';
        }
    });

    // Podcast button in history screen triggers podcast manager in history view
    const historyPodcastBtn = document.getElementById('podcastButton');
    if (historyPodcastBtn) {
        historyPodcastBtn.addEventListener('click', () => {
            ui.enterPodcastMenu();
        });
    }

    // Utility to handle summarize button error state
    function showSummarizeError() {
        const summarizeBtn = document.getElementById('summarizeButton');
        if (summarizeBtn) {
            summarizeBtn.style.backgroundColor = 'red';
            summarizeBtn.textContent = 'Try again later';
        }
    }

    // Example: Wrap your message sending logic with error handling
    function sendMessageToContentScript(message, callback) {
        try {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    showSummarizeError();
                    return;
                }
                if (callback) callback(response);
            });
        } catch (e) {
            showSummarizeError();
        }
    }

    // Wherever you send a message to the background/content script, use sendMessageToContentScript
    // Example usage:
    // sendMessageToContentScript({ action: 'summarize' }, (response) => { /* handle response */ });
});