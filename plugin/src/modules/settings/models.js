// settings/models.js — split out of settingsManager.js (R4 phase 1).
import { SK } from '../storageKeys.js';
import StorageManager from '../storageManager.js';
import { updateModelIdentifierUI, modelPriceLabel } from '../modelManager.js';
import { supportsEu, regionTag, isEuPreferred, routeSentence, euSuggestion, PREF_EU, PREF_ANY } from '../cloudRegion.js';
import { escapeHtml } from '../textUtils.js';
import { normalizeChatUrl } from '../endpointUrl.js';
import { T } from '../feedI18n.js';
import { flashSaveIndicator, autoSave } from './autosave.js';
import { renderOllamaTutorial } from './localModels.js';

// ── Section: Model Configuration (Refactored for Hybrid Subscription Model) ──
export async function initModelSettings(storageData) {
    const services = await StorageManager.getServices();
    
    // UI Mode Containers
    const cloudModeContainer = document.getElementById('cloudModeContainer');
    const developerModeContainer = document.getElementById('developerModeContainer');
    
    // High-Level Connection Mode Toggles
    const modeCloudRadio = document.getElementById('modeCloud');
    const modeLocalRadio = document.getElementById('modeLocal');
    const modeOllamaRadio = document.getElementById('modeOllama');
    
    // Cloud Mode Elements
    const cloudModelSelect = document.getElementById('cloudModelSelect');
    const licenseKeyInput = document.getElementById('licenseKey');
    const verifyLicenseBtn = document.getElementById('verifyLicenseButton');
    const licenseStatusLabel = document.getElementById('licenseStatusLabel');
    
    // Developer Mode Elements (Existing)
    const modelSelect = document.getElementById('model');
    const apiKeyInput = document.getElementById('apiKey');
    const endpointInput = document.getElementById('customEndpoint');

    if (!modelSelect || !cloudModeContainer || !developerModeContainer) return;

    // ── 1. Restore & Bind Connection Mode Toggles ───────────────────
    // Three tabs, two stored modes: byPhil Cloud = 'cloud'; Own key and Ollama are both 'local'
    // and differ only by activeService (Ollama is not listed among the own-key providers).
    const tabOf = (mode, service) => mode === 'cloud' ? 'cloud' : (service === 'ollama' ? 'ollama' : 'local');
    const currentMode = storageData.connectionMode || 'cloud';
    const currentTab = tabOf(currentMode, storageData.activeService);
    if (currentTab === 'cloud' && modeCloudRadio) modeCloudRadio.checked = true;
    if (currentTab === 'local' && modeLocalRadio) modeLocalRadio.checked = true;
    if (currentTab === 'ollama' && modeOllamaRadio) modeOllamaRadio.checked = true;
    let lastOwnKeyService = storageData.activeService && storageData.activeService !== 'ollama' ? storageData.activeService : '';

    const toggleConnectionContainers = (mode) => {
        const providerLabel = document.getElementById('providerLabel');
        const ollamaTab = mode === 'ollama';
        if (providerLabel) providerLabel.style.display = ollamaTab ? 'none' : '';
        modelSelect.style.display = ollamaTab ? 'none' : '';
        if (mode === 'cloud') {
            cloudModeContainer.style.display = 'block';
            developerModeContainer.style.display = 'none';
        } else {
            cloudModeContainer.style.display = 'none';
            developerModeContainer.style.display = 'block';
        }
    };
    toggleConnectionContainers(currentTab);

    // Own key and Local share one container (provider, key, endpoint, the local-model tutorial). Its content is rebuilt for the tab
    // that is chosen, which takes a few async steps: until it is ready the container stays invisible (it keeps its room, so nothing
    // jumps), and only then is it shown. The old tab's fields are never on screen under the new tab. A newer click wins.
    let switchSeq = 0;
    const handleModeChange = async (e) => {
        const tab = e.target.value; // cloud | local | ollama
        const seq = ++switchSeq;
        const own = tab !== 'cloud';
        if (own) developerModeContainer.classList.add('is-switching');
        toggleConnectionContainers(tab);
        try {
            await autoSave('connectionMode', own ? 'local' : 'cloud');
            if (!own || seq !== switchSeq) return;

            // Restore the provider that belongs to this tab so the panel doesn't fall back to a stale selection.
            const latest = await StorageManager.getAll();
            if (seq !== switchSeq) return;
            let target = 'ollama';
            if (tab === 'local') {
                const ownKey = (id) => id && id !== 'ollama' && Array.from(modelSelect.options).some(o => o.value === id);
                target = [lastOwnKeyService, latest.activeService, modelSelect.value, 'openai'].find(ownKey) || modelSelect.options[0]?.value;
                modelSelect.value = target;
            }
            if (target) {
                await autoSave('activeService', target);
                await updateFields(target);
            }
        } finally {
            if (seq === switchSeq) developerModeContainer.classList.remove('is-switching');
        }
    };

    if (modeCloudRadio) modeCloudRadio.addEventListener('change', handleModeChange);
    if (modeLocalRadio) modeLocalRadio.addEventListener('change', handleModeChange);
    if (modeOllamaRadio) modeOllamaRadio.addEventListener('change', handleModeChange);

    // ── 2. Initialize Cloud Settings State ──────────────────────────
    if (cloudModelSelect) {
        // Fetch filtered cheap models from your backend proxy
        let regionPref = storageData.cloudRegionPref === PREF_EU ? PREF_EU : PREF_ANY;
        const regionGroup = document.getElementById('cloudRegionGroup'), regionSwitch = document.getElementById('cloudRegionPref');
        let rosterModels = [], rosterData = null;
        // With "Prefer EU servers" on and a model that cannot run in the EU selected: one line offering the EU default (one tap, never automatic).
        const updateSuggest = () => {
            const box = document.getElementById('cloudRegionSuggest'); if (!box) return;
            const sug = rosterData ? euSuggestion(rosterData, cloudModelSelect.value, regionPref) : null;
            box.hidden = !sug; if (!sug) return;
            box.querySelector('span').textContent = T('This model does not run on EU servers. Use {name} (EU) instead?', { name: sug.name });
            const b = box.querySelector('button'); b.textContent = T('Use {name}', { name: sug.name });
            b.onclick = async () => {
                const { [SK.token]: token } = await chrome.storage.local.get([SK.token]);
                if (!token) { import('../settingsNav.js').then(m => m.openSettingsPanel('account', 'otpEmail')).catch(() => {}); return; }   // choosing needs an account, like the list
                cloudModelSelect.value = sug.id; await autoSave('preferredCloudModel', sug.id); updateSuggest();
            };
        };
        // The model list: every model stays selectable. EU models are marked, and with "Prefer EU servers" on the others are called out and EU prices are shown.
        const fillCloudModels = () => {
            const keep = cloudModelSelect.value || storageData.preferredCloudModel;
            cloudModelSelect.innerHTML = '';
            rosterModels.forEach(model => {
                const option = document.createElement('option');
                option.value = model.id;
                const price = modelPriceLabel(model, regionPref);
                const tag = regionTag(model, regionPref);
                // Example output: "Gemini 3.8 Flash (Context: 1M) · EU · 0.3 in / 2.5 out per 1M tokens"
                const tagText = tag ? ' · ' + (tag.kind === 'company' ? T('EU company') : tag.kind === 'eu' ? T('EU servers') : T('Not on EU servers')) : '';
                option.textContent = model.auto
                    ? `${model.name} · ${T('picks a model for each request')}` + tagText
                    : `${model.name} (${T('Context: {n}k', { n: Math.round(model.context / 1000) })})` + tagText + (price ? ' · ' + price : '');
                cloudModelSelect.appendChild(option);
            });
            cloudModelSelect.value = keep || rosterModels[0].id;
        };
        const showRoute = async () => {
            const note = document.getElementById('cloudRouteLast'); if (!note) return;
            const { [SK.cloudRoute]: route } = await chrome.storage.local.get(SK.cloudRoute);
            const text = routeSentence(route);
            note.textContent = text ? T(text) : ''; note.hidden = !text;
        };
        const describeRegion = () => {
            const n = document.getElementById('cloudRegionNote');
            if (n) n.textContent = isEuPreferred(regionPref)
                ? T('Models marked “EU servers” run only on servers in Europe, often those of US cloud companies. Only models marked “EU company” are also from a European company. Every other model still works, is marked “Not on EU servers”, and runs as usual; Auto choices stay on EU servers. EU servers can cost a little more; the prices shown are the EU ones. Read-aloud and speech-to-text have no EU option. Your text still passes through our service (a server in Germany) and then OpenRouter, a US company, on the way.')
                : T('Turn on to run models on servers in Europe where they offer that. All other models keep working and are marked.');
        };
        if (regionSwitch) {
            regionSwitch.checked = isEuPreferred(regionPref);
            regionSwitch.addEventListener('change', async () => {
                regionPref = regionSwitch.checked ? PREF_EU : PREF_ANY;
                await chrome.storage.sync.set({ cloudRegionPref: regionPref });
                describeRegion(); if (rosterModels.length) fillCloudModels(); updateSuggest();
            });
        }
        chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && SK.cloudRoute in ch) showRoute(); });
        fetch(`${StorageManager.getApiBase()}/v1/projects/ai_summary_helper/models`)
            .then(res => res.json())
            .then(data => {
                if (data.success && data.models.length > 0) {
                    rosterModels = data.models; rosterData = data;
                    fillCloudModels();
                    cloudModelSelect.addEventListener('change', updateSuggest);
                    // Only a server that knows about regions gets the switch: an older one would just ignore it, and nothing would be marked.
                    if (regionGroup) { regionGroup.hidden = !supportsEu(data); describeRegion(); showRoute(); updateSuggest(); }
                } else {
                    throw new Error("Empty model array received");
                }
            })
            .catch(err => {
                console.error("Failed to populate dynamic openrouter roster:", err);
                cloudModelSelect.innerHTML = '<option value="google/gemini-3.8-flash">Gemini 3.8 Flash (' + escapeHtml(T('Fallback')) + ')</option>';
            });

        // Retain auto-save trigger on user selection change
        cloudModelSelect.addEventListener('change', async () => {
            const { [SK.token]: token } = await chrome.storage.local.get([SK.token]);
            if (!token) {
                // Browsing the roster is fine; choosing needs an account.
                const { preferredCloudModel } = await chrome.storage.sync.get('preferredCloudModel');
                cloudModelSelect.value = preferredCloudModel || 'google/gemini-3.8-flash';
                import('../settingsNav.js').then(m => m.openSettingsPanel('account', 'otpEmail')).catch(() => {});
                return;
            }
            autoSave('preferredCloudModel', cloudModelSelect.value);
        });
    }

    if (licenseKeyInput) {
        licenseKeyInput.value = storageData[SK.licenseKey] || '';
    }

    const refreshLicenseUIStatus = (status, isValid = false) => {
        if (!licenseStatusLabel) return;
        licenseStatusLabel.textContent = status;
        licenseStatusLabel.classList.toggle('signed-in', !!isValid);
    };

    // Initialize display state of active token if it exists
    if (storageData[SK.licenseKey]) {
        refreshLicenseUIStatus(T('Pro Active ✓'), true);
    } else {
        refreshLicenseUIStatus(T('Free Trial Mode'));
    }

    // Handshake execution with api.byphil.eu
    if (verifyLicenseBtn && licenseKeyInput) {
        verifyLicenseBtn.addEventListener('click', async () => {
            const inputKey = licenseKeyInput.value.trim();
            if (!inputKey) {
                alert(T('Please enter a license key.'));
                return;
            }

            verifyLicenseBtn.disabled = true;
            verifyLicenseBtn.textContent = T('Verifying...');

            try {
                const response = await fetch(`${StorageManager.getApiBase()}/v1/projects/ai_summary_helper/license/verify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ license_key: inputKey })
                });

                const resData = await response.json();

                if (response.ok && resData.valid && resData.status === 'active') {
                    await StorageManager.set({ [SK.licenseKey]: inputKey });
                    refreshLicenseUIStatus(T('Pro Active ✓'), true);
                    flashSaveIndicator();
                } else {
                    alert(T('Invalid or deactivated license key. Check your subscription parameters.'));
                    refreshLicenseUIStatus(T('Invalid Key'));
                }
            } catch (err) {
                console.error('License authorization handshake broke down:', err);
                alert(T('Infrastructural link execution failed. Ensure network connection to gateway.'));
            } finally {
                verifyLicenseBtn.disabled = false;
                verifyLicenseBtn.textContent = T('Activate');
            }
        });
    }

    // ── 3. Initialize Developer Mode Settings (Legacy Elements) ─────
    modelSelect.innerHTML = '';
    services.filter(service => service.id !== 'ollama').forEach(service => {
        const option = document.createElement('option');
        option.value = service.id;
        option.textContent = service.name;
        modelSelect.appendChild(option);
    });

    let activeService = storageData.activeService || 'openai';
    if (!services.some(s => s.id === activeService)) {
        activeService = services[0]?.id;
        if (activeService) await StorageManager.set({ activeService });
    }
    if (activeService !== 'ollama') modelSelect.value = activeService;

    let shownService = activeService; // provider whose fields are on screen (the select is hidden on the Ollama tab)
    let fieldsSeq = 0;   // a slower, older updateFields must not paint over a newer one (quick tab switching)
    const updateFields = async (serviceId) => {
        shownService = serviceId;
        const mine = ++fieldsSeq;
        const service = services.find(s => s.id === serviceId);
        const latest = await StorageManager.getAll();
        if (mine !== fieldsSeq) return;
        const cfg = latest[SK.servicesConfig]?.[serviceId] || {};

        const apiKeyLink = document.getElementById('apiKeyLink');
        if (apiKeyLink) {
            const docUrl = service?.apiKeyDocumentationUrl || '';
            // only an https link, escaped: a custom service's URL is user data
            // eslint-disable-next-line no-unsanitized/property -- reviewed: https-only URL and label are escaped
            apiKeyLink.innerHTML = /^https:\/\//i.test(docUrl)
                ? `(<a href="${escapeHtml(docUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(T('Get Key'))}</a>)`
                : '';
        }

        // Keyless providers (Ollama): no API key field at all.
        const apiKeyContainer = document.getElementById('apiKeyContainer');
        if (apiKeyContainer) apiKeyContainer.style.display = (service?.apiKeyOptional && !service?.apiKeyField) ? 'none' : '';

        const customEndpointContainer = document.getElementById('customEndpointContainer');
        if (customEndpointContainer) {
            customEndpointContainer.style.display = service?.allowCustomEndpoint ? 'block' : 'none';
        }
        if (endpointInput) endpointInput.placeholder = service?.endpointPlaceholder || service?.endpointUrl || 'http://localhost:11434/api/chat';

        // “Local” bundles every local model: Ollama's, Chrome's built-in one and other servers (LM Studio …). A model from another
        // server switches the endpoint to that server; picking an Ollama model switches back to the Ollama endpoint (kept in ollamaEndpoint).
        const ollamaEndpointOf = (c) => c.ollamaEndpoint || (c.endpointSource && c.endpointSource !== 'ollama' ? '' : c.endpoint) || service?.endpointUrl || '';
        renderOllamaTutorial(serviceId, serviceId === 'ollama' ? ollamaEndpointOf(cfg) : (cfg.endpoint || service?.endpointUrl), async (name, opts = {}) => {
            const entry = (await StorageManager.getAll())[SK.servicesConfig]?.[serviceId] || {};
            const list = (Array.isArray(entry.customModel) ? entry.customModel : (entry.customModel ? [entry.customModel] : []))
                .map(m => StorageManager.normalizeCustomModel(m, serviceId));
            if (!list.some(m => m.id === name)) list.push({ id: name, provider: serviceId });
            const ollamaEp = ollamaEndpointOf(entry);
            const endpoint = opts.endpoint || ollamaEp;
            await StorageManager.updateService(serviceId, { customModel: list, activeModelId: { id: name, provider: serviceId }, ...(endpoint ? { endpoint } : {}), ollamaEndpoint: ollamaEp, endpointSource: opts.source || 'ollama' });
            if (endpointInput && endpoint) endpointInput.value = endpoint;
            updateModelIdentifierUI(serviceId, services, await StorageManager.getAll());
            flashSaveIndicator();
        });

        if (apiKeyInput) apiKeyInput.value = cfg.apiKey || '';
        if (endpointInput) endpointInput.value = cfg.endpoint || service?.endpointUrl || '';

        updateModelIdentifierUI(serviceId, services, latest);
    };

    modelSelect.addEventListener('change', async () => {
        const selectedId = modelSelect.value;
        lastOwnKeyService = selectedId;
        await autoSave('activeService', selectedId);
        await updateFields(selectedId);
    });

    if (apiKeyInput) {
        apiKeyInput.addEventListener('change', () => {
            StorageManager.updateService(shownService, { apiKey: apiKeyInput.value });
        });
    }

    if (endpointInput) {
        endpointInput.addEventListener('change', () => {
            // OpenAI-compatible servers: https://host/v1, …/v1/ or the full …/chat/completions all end up as the full chat URL.
            const typed = shownService === 'custom' ? normalizeChatUrl(endpointInput.value) : null;
            const value = typed && typed.ok ? typed.chatUrl : endpointInput.value.trim();
            StorageManager.updateService(shownService, { endpoint: value }).then(() => updateFields(shownService));
        });
    }

    await updateFields(activeService);
}

