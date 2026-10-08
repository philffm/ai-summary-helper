import { applyA11y } from './modules/a11y.js';
import { SK } from './modules/storageKeys.js';
import { initMoodSetting } from './modules/moodSetting.js';
import UIManager from './modules/uiManager.js';
import StorageManager from './modules/storageManager.js';
import { initArticleManager } from './modules/articleManager.js';
import { initWorkspace } from './modules/workspaceManager.js';
import { initSettingsManager } from './modules/settingsManager.js';
// import { initModelManager } from './modules/modelManager.js';
import { initLanguageManager } from './modules/languageManager.js';
import { languageMatches } from './modules/languages.js';
// import { initPodcastManager } from './modules/podcastManager.js';
// Use window.initPodcastManager if needed
import { initShortcuts } from './modules/shortcuts.js';
import { initMainScreen } from './modules/mainScreen.js';
import { initReviewPrompt } from './modules/reviewPrompt.js';
import { initToolsManager } from './modules/toolsManager.js';
import { initFeedManager } from './modules/feedManager.js';
import { initSettingsNav, openSettingsPanel } from './modules/settingsNav.js';
import { initAccordion } from './modules/accordion.js';
import { T } from './modules/feedI18n.js';

// ── Cross-browser shim ─────────────────────────────────────────────────────
// Safari/iOS Web Extensions expose ONLY the `browser.*` namespace; `chrome.*`
// is undefined there. Firefox exposes both but prefers `browser.*`. Alias
// chrome → browser so the rest of this codebase works unchanged on every
// platform (popup, content script, background, and all modules).
if (typeof chrome === 'undefined' && typeof browser !== 'undefined') {
    globalThis.chrome = browser;
}

document.addEventListener("DOMContentLoaded", async () => {
    // Load theme and beta toggle preferences
    const storageData = await StorageManager.getAll();
    applyA11y({ ...storageData, theme: storageData.theme === 'system' ? '' : storageData.theme });
    
    const ui = new UIManager();

    // Must be awaited: this runs the articlesIndex/article:<id> storage
    // migration (see StorageManager.migrateArticlesToIndexedRecords()).
    // initMainScreen() below reads articlesIndex immediately on load — firing
    // it before migration finishes would read an empty index while the
    // migration is still mid-write, showing an empty main-screen feed even
    // though articles exist (History looks fine because it only loads on
    // first navigation there, by which point migration has long finished).
    await StorageManager.initializeDefaults();

    // ── Apply UI language setting ───────────────────────────────────────
    import('./modules/i18n.js').then(({ applyTranslations }) => {
        chrome.storage.sync.get('uiLanguage', (data) => {
            applyTranslations(data.uiLanguage || 'en');
        });
    });

    // initModelManager(ui); // Not exported from modelManager.js
    initSettingsManager(ui);
    initLanguageManager(ui);
    initToolsManager(ui);
    initFeedManager(ui);
    initSettingsNav(ui);
    if (window.initPodcastManager) {
        window.initPodcastManager(ui);
    }
    initShortcuts(ui);
    initMainScreen(ui);
    initReviewPrompt();
    initMoodSetting();
    initArticleManager(ui);
    initWorkspace();
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
                const mod = await import('./modules/mainScreen.js').catch(() => null);
                const activeTab = mod?.getActiveTab ? await mod.getActiveTab() : null;
                const { useNativeSidePanel } = await chrome.storage.sync.get('useNativeSidePanel').catch(() => ({}));

                // Native side panel (Chrome-only, opt-in). On Firefox/Safari/iOS
                // `chrome.sidePanel` is undefined, so we always fall through to
                // the hybrid injected iframe sidebar.
                const nativeAvailable = !!(chrome.sidePanel && chrome.sidePanel.setPanelBehavior);
                if (useNativeSidePanel && nativeAvailable) {
                    chrome.runtime.sendMessage({ action: 'openNativeSidePanel' }, (response) => {
                        if (response?.success) window.close();
                    });
                    return;
                }

                // Default: hybrid injected iframe (works on every platform)
                if (activeTab && mod?.ensureContentScript) {
                    // Safari opt-in model: request site access within this
                    // click gesture so the native prompt is honored.
                    if (mod.hasSiteAccess && !(await mod.hasSiteAccess(activeTab.url))) {
                        if (mod.requestSiteAccess) {
                            await mod.requestSiteAccess(activeTab.url);
                        }
                    }
                    await mod.ensureContentScript(activeTab.id, activeTab.url).catch(() => {});
                    // Route through the tab helper so a nested pop-out (triggered
                    // from inside an already-popped-out sidebar) still works on
                    // Firefox, where `chrome.tabs` is undefined in the iframe.
                    if (mod.sendMessageToTab) {
                        await mod.sendMessageToTab(activeTab.id, { action: 'toggleHybridSidebar' }).catch(() => {});
                    } else {
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
                    // Re-render the model grid so newly added custom models
                    // (e.g. added in Settings) show up immediately.
                    if (typeof renderModelUI === 'function') renderModelUI();
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
                if (filter && !languageMatches(option.value, filter) && !text.toLowerCase().includes(lower) && !shortCode.toLowerCase().includes(lower)) return;
                const btn = document.createElement('button');
                btn.className = 'pill pill--sm pill--soft';
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
            // If user typed a search term that doesn't match any language, show a "Use custom" chip
            if (filter && languageTagGrid.children.length === 0) {
                const customBtn = document.createElement('button');
                customBtn.className = 'pill pill--sm pill--soft';
                customBtn.innerHTML = `<span style="font-size:14px;">✏️</span> "${filter}"`;
                customBtn.title = T('Use "{name}" as custom language code', { name: filter });
                customBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    // Add a temporary option for this custom code
                    const opt = document.createElement('option');
                    opt.value = filter;
                    opt.textContent = `✏️ ${filter.toUpperCase()}`;
                    languageSelect.add(opt);
                    languageSelect.value = filter;
                    languageSelect.dispatchEvent(new Event('change'));
                    document.getElementById('panelLanguage').style.display = 'none';
                    document.querySelector('.chip[data-panel="language"]').classList.remove('active');
                });
                languageTagGrid.appendChild(customBtn);
            }
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

    // Module-level hook so the model panel can re-render the model grid
    // (assigned inside the renderUI block below).
    let renderModelUI = null;

    // Refresh chip label from storage (used on init + whenever main screen shows)
    const refreshModelChip = async () => {
        // servicesConfig now lives in LOCAL storage; prefs stay in sync.
        const [syncData, localData] = await Promise.all([
            chrome.storage.sync.get(['activeService', 'connectionMode', 'preferredCloudModel']),
            chrome.storage.local.get([SK.servicesConfig])
        ]);
        const { activeService, connectionMode, preferredCloudModel } = { ...syncData, ...localData };
        const servicesConfig = localData[SK.servicesConfig];
        
        if (connectionMode === 'cloud') {
            const active = preferredCloudModel || 'google/gemini-3.8-flash';
            // Just take the model name part (after /) for the chip if it's long
            const label = active.includes('/') ? active.split('/').pop() : active;
            if (chipModelLabel) chipModelLabel.textContent = label;
            return;
        }

        const svcId = activeService || 'openai';
        const meta = servicesMetaCache.find(s => s.id === svcId);
        const cfg = (servicesConfig || {})[svcId] || {};
        const def = meta?.defaultModel || '';
        const custom = Array.isArray(cfg.customModel) ? cfg.customModel : [];
        // Normalize custom models (legacy strings or { id, provider } objects)
        const customIds = custom.map(m => typeof m === 'string' ? m : m?.id);
        const activeId = (typeof cfg.activeModelId === 'string' ? cfg.activeModelId : cfg.activeModelId?.id) || customIds[0] || def;
        if (chipModelLabel) chipModelLabel.textContent = activeId || svcId;
    };

    if (modelSettingsLink) {
        modelSettingsLink.addEventListener('click', () => {
            document.getElementById('panelModel').style.display = 'none';
            document.querySelector('.chip[data-panel="model"]').classList.remove('active');
            ui.showScreen('settings');
            openSettingsPanel('models');
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

        // Always-visible source switch: byPhil Cloud | Your own model.
        // Keeps the same two buttons in place in both modes (only the
        // active state changes), so nothing "disappears" when switching.
        const renderModeSeg = (mode) => {
            const grid = document.getElementById('modelModeGrid');
            if (!grid) return;
            grid.innerHTML = '';
            [{ id: 'cloud', label: '☁️ byPhil Cloud' }, { id: 'local', label: '💻 ' + T('Own model / API key') }].forEach(m => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'pill pill--sm pill--soft' + (m.id === mode ? ' active' : '');
                btn.textContent = m.label;
                btn.setAttribute('aria-pressed', m.id === mode ? 'true' : 'false');
                btn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    if (m.id === mode) return;
                    customModelInput.value = '';
                    await chrome.storage.sync.set({ connectionMode: m.id });
                    renderUI();
                });
                grid.appendChild(btn);
            });
            const show = (id, on) => { const e = document.getElementById(id); if (e) e.style.display = on ? '' : 'none'; };
            show('modelNote', mode === 'cloud'); show('providerLabel', mode !== 'cloud'); show('modelProviderGrid', mode !== 'cloud');
            const note = document.getElementById('modelNote');
            if (note) note.textContent = T('Included with your byPhil account — no API key needed.');
            const ml = document.getElementById('modelIdLabel'); if (ml) ml.textContent = mode === 'cloud' ? T('Recent models') : T('Model');
            customModelInput.placeholder = mode === 'cloud' ? T('Search cloud models…') : T('Add model ID, e.g. gemma3:4b');
            customModelInput.setAttribute('aria-label', customModelInput.placeholder);
            if (setCustomModelBtn) setCustomModelBtn.style.display = mode === 'cloud' ? 'none' : '';
        };

        // Close the model panel (used by the ✕ button, Esc and after a model was picked).
        const closeModelPanel = () => {
            const panel = document.getElementById('panelModel');
            if (panel) panel.style.display = 'none';
            const chip = document.querySelector('.chip[data-panel="model"]');
            if (chip) { chip.classList.remove('active'); chip.focus && chip.focus(); }
            if (customModelInput) customModelInput.value = '';
        };
        // A model was chosen/added: it is already stored; refresh the chip label and close.
        const applyAndClose = async () => { await refreshModelChip(); closeModelPanel(); };
        document.getElementById('modelPanelClose')?.addEventListener('click', closeModelPanel);
        document.getElementById('panelModel')?.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeModelPanel(); } });

        const setModelStatus = (text, state) => {
            const t = document.getElementById('modelStatusText'); if (t) t.textContent = text;
            const d = document.querySelector('#modelStatus .model-dot'); if (d) d.dataset.state = state || '';
        };

        const renderUI = () => {
            renderModelUI = renderUI; // expose for the model panel chip handler
            // servicesConfig now lives in LOCAL storage; prefs stay in sync.
            return Promise.all([
                chrome.storage.sync.get(['connectionMode', 'preferredCloudModel']),
                chrome.storage.local.get([SK.servicesConfig])
            ]).then(async ([syncData, localData]) => {
                const { connectionMode, preferredCloudModel } = { ...syncData, ...localData };
                const servicesConfig = localData[SK.servicesConfig];
                renderModeSeg(connectionMode === 'cloud' ? 'cloud' : 'local');
                if (connectionMode === 'cloud') {
                    // Update chip label
                    const activeCloudModel = preferredCloudModel || 'google/gemini-3.8-flash';
                    const chipLabel = activeCloudModel.includes('/') ? activeCloudModel.split('/').pop() : activeCloudModel;
                    chipModelLabel.textContent = chipLabel;

                    modelProviderGrid.innerHTML = '';
                    setModelStatus('byPhil Cloud', '');

                    // Model ID tags: Fetch from local proxy for quick select
                    const { recentCloudModels = ['google/gemini-3.8-flash'] } = await chrome.storage.sync.get('recentCloudModels');
                    const filter = customModelInput.value.toLowerCase().trim();

                    if (!filter) {
                        modelIdGrid.innerHTML = '';
                        recentCloudModels.forEach(modelId => {
                            const btn = document.createElement('button');
                            btn.className = 'pill pill--sm pill--soft';
                            const shortName = modelId.includes('/') ? modelId.split('/').pop() : modelId;
                            btn.innerHTML = modelId === activeCloudModel
                                ? `${shortName} <span aria-hidden="true">✓</span>`
                                : `${shortName} <span class="remove-recent" style="margin-left:4px;opacity:0.5;cursor:pointer;">✕</span>`;
                            if (modelId === activeCloudModel) btn.classList.add('active');
                            
                            btn.addEventListener('click', async (e) => {
                                if (e.target.classList.contains('remove-recent')) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const newRecent = recentCloudModels.filter(m => m !== modelId);
                                    await chrome.storage.sync.set({ recentCloudModels: newRecent });
                                    renderUI();
                                    return;
                                }
                                await chrome.storage.sync.set({ preferredCloudModel: modelId });
                                await renderUI();
                                applyAndClose();
                            });
                            modelIdGrid.appendChild(btn);
                        });
                        return;
                    }

                    modelIdGrid.innerHTML = '<span style="font-size:11px;color:var(--text-muted);padding:4px 0;">🔍 ' + T('Searching Cloud...') + '</span>';
                    try {
                        const response = await fetch(`${StorageManager.getApiBase()}/v1/projects/ai_summary_helper/models`);
                        const data = await response.json();
                        if (data.success && data.models.length > 0) {
                            modelIdGrid.innerHTML = '';
                            const searchResults = data.models.filter(m => 
                                m.name.toLowerCase().includes(filter) || m.id.toLowerCase().includes(filter)
                            );
                            
                            if (searchResults.length === 0) {
                                modelIdGrid.innerHTML = '<span style="font-size:11px;color:var(--text-muted);padding:4px 0;">' + T('No matches found') + '</span>';
                                return;
                            }

                            searchResults.forEach(model => {
                                const btn = document.createElement('button');
                                btn.className = 'pill pill--sm pill--soft';
                                btn.textContent = model.name;
                                if (model.id === activeCloudModel) btn.classList.add('active');
                                btn.addEventListener('click', async (e) => {
                                    e.preventDefault();
                                    await chrome.storage.sync.set({ preferredCloudModel: model.id });
                                    
                                    // Add to recent list (limit to 10)
                                    let newRecent = [model.id, ...recentCloudModels.filter(m => m !== model.id)];
                                    newRecent = newRecent.slice(0, 10);
                                    await chrome.storage.sync.set({ recentCloudModels: newRecent });
                                    
                                    customModelInput.value = '';
                                    await renderUI();
                                    applyAndClose();
                                });
                                modelIdGrid.appendChild(btn);
                            });
                        }
                    } catch (err) {
                        modelIdGrid.innerHTML = '<span style="font-size:11px;color:var(--danger);padding:4px 0;">' + T('Failed to load models') + '</span>';
                    }
                    return;
                }

                const curSvcId = modelSelect.value;
                const meta = servicesMetaCache.find(s => s.id === curSvcId);
                const defModel = meta?.defaultModel || '';
                const cfg = (servicesConfig || {})[curSvcId] || {};
                // Normalize custom models to provider-bound objects
                const rawCustom = Array.isArray(cfg.customModel) ? cfg.customModel : (cfg.customModel ? [cfg.customModel] : []);
                const customModels = rawCustom.map(m => StorageManager.normalizeCustomModel(m, curSvcId));
                const customIds = customModels.map(m => m.id);
                // Active model = activeModelId (string or object), or first custom, or default
                const activeModelObj = cfg.activeModelId
                    ? StorageManager.normalizeCustomModel(cfg.activeModelId, curSvcId)
                    : (customModels[0] || { id: defModel, provider: curSvcId });
                const activeModel = activeModelObj.id;
                // Build list: active first, then custom models, then default
                const allModels = [
                    activeModelObj,
                    ...customModels.filter(m => m.id !== activeModel),
                    ...(activeModel !== defModel && !customIds.includes(defModel) && defModel ? [{ id: defModel, provider: curSvcId }] : [])
                ];
                // Remove exact duplicates while preserving order
                const deduped = allModels.filter((m, i, a) => a.findIndex(x => x.id === m.id) === i);

                // Update chip label to show only the active model ID
                chipModelLabel.textContent = activeModel;
                if (meta?.apiKeyOptional) setModelStatus(T('{name} · local, no API key', { name: meta.name }), '');
                else if (cfg.apiKey) setModelStatus(T('{name} · API key set', { name: meta?.name || curSvcId }), '');
                else setModelStatus(T('{name} · API key missing — add it in Settings', { name: meta?.name || curSvcId }), 'warn');

                // Provider tags
                modelProviderGrid.innerHTML = '';
                
                Array.from(modelSelect.options).forEach(option => {
                    const btn = document.createElement('button');
                    btn.className = 'pill pill--sm pill--soft';
                    btn.textContent = option.textContent;
                    if (option.selected) btn.classList.add('active');
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
                    modelIdGrid.innerHTML = '<span style="font-size:11px;color:var(--text-muted);padding:4px 0;">' + T('No models configured') + '</span>';
                    return;
                }
                deduped.forEach((modelObj) => {
                    const modelId = modelObj.id;
                    const btn = document.createElement('button');
                    btn.className = 'pill pill--sm pill--soft';
                    const isCustom = customIds.includes(modelId);
                    btn.innerHTML = `${modelId}${isCustom ? ` <span class="remove-tag" style="margin-left:4px;opacity:0.5;cursor:pointer;">✕</span>` : ''}`;
                    if (modelId === activeModel) btn.classList.add('active');
                    
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        
                        // Handle removal of custom model
                        if (e.target.classList.contains('remove-tag')) {
                            const newCustom = customModels.filter(m => m.id !== modelId);
                            const newActive = modelId === activeModel
                                ? (newCustom[0] || { id: defModel, provider: curSvcId })
                                : activeModelObj;
                            StorageManager.updateService(curSvcId, { 
                                customModel: newCustom,
                                // If we just removed the active model, fall back to default
                                activeModelId: newActive
                            }).then(() => renderUI());
                            return;
                        }

                        // Use StorageManager.updateService for a proper read-modify-write
                        // that preserves the latest stored custom models.
                        StorageManager.updateService(curSvcId, {
                            activeModelId: { id: modelId, provider: curSvcId }
                        }).then(() => { renderUI(); applyAndClose(); });
                    });
                    modelIdGrid.appendChild(btn);
                });
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

        if (customModelInput) {
            customModelInput.addEventListener('input', () => {
                renderUI();
            });
        }

        // Save (and activate) whatever model ID is typed. Runs from the "+" button,
        // Enter and on blur, so a typed ID is never silently dropped.
        let committing = false;
        const commitCustomModel = async (ev) => {
            const explicit = !!ev && (ev.type === 'click' || ev.type === 'keydown');
            if (!customModelInput || committing) return;
            const val = customModelInput.value.trim();
            if (!val) return;
            const { connectionMode, activeService } = await chrome.storage.sync.get(['connectionMode', 'activeService']);
            if (connectionMode === 'cloud') return; // cloud input is a search filter
            committing = true;
            // The stored active provider is the source of truth (the hidden select can lag behind it).
            const svcId = activeService || modelSelect.value || 'openai';
            try {
                const current = await StorageManager.getAll();
                const entry = (current[SK.servicesConfig] || {})[svcId] || {};
                let list = Array.isArray(entry.customModel) ? [...entry.customModel] : (entry.customModel ? [entry.customModel] : []);
                list = list.map(m => StorageManager.normalizeCustomModel(m, svcId)).filter(m => m.id);
                if (!list.some(m => m.id === val)) list.push({ id: val, provider: svcId });
                await StorageManager.updateService(svcId, {
                    customModel: list,
                    activeModelId: { id: val, provider: svcId }
                });
                customModelInput.value = '';
                renderUI();
                refreshModelChip();
                if (explicit) closeModelPanel();
            } catch (err) {
                console.error('[Model] Failed to add custom model:', err);
            } finally {
                committing = false;
            }
        };
        if (setCustomModelBtn && customModelInput) {
            setCustomModelBtn.addEventListener('click', commitCustomModel);
            customModelInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitCustomModel(e); }
            });
            customModelInput.addEventListener('blur', (e) => {
                // Moving to another control inside the panel (pill, "+") is handled by that control.
                const to = e.relatedTarget;
                if (to && to.closest && to.closest('#panelModel')) return;
                commitCustomModel();
            });
        }
    }

    // ── Bottom Nav ──────────────────────────────────────────────────────
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const screen = item.dataset.screen;
            if (screen === 'main' || screen === 'history' || screen === 'settings' || screen === 'feeds') {
                ui.showScreen(screen);
            }
        });
    });

    // Settings lives in the header (top right). Clicking it again returns to
    // the screen the user came from.
    const settingsButton = document.getElementById('settingsButton');
    if (settingsButton) {
        settingsButton.addEventListener('click', () => {
            const onSettings = settingsButton.classList.contains('active');
            ui.showScreen(onSettings ? (ui._lastNavScreen || 'main') : 'settings');
        });
    }

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
            chrome.storage.local.set({ [SK.summaryMode]: mode });
            if (chipModeLabel) chipModeLabel.textContent = mode === 'extension' ? T('Ext') : T('Inl');
        });
    });

    // Restore saved mode
    chrome.storage.local.get([SK.summaryMode], data => {
        if (data[SK.summaryMode]) {
            modeTabs.forEach(t => {
                t.classList.toggle('active', t.dataset.mode === data[SK.summaryMode]);
            });
            if (chipModeLabel) chipModeLabel.textContent = data[SK.summaryMode] === 'extension' ? T('Ext') : T('Inl');
        }
    });
});
