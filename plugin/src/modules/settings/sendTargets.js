// settings/sendTargets.js — split out of settingsManager.js (R4 phase 1).
import { SK } from '../storageKeys.js';
import { escapeHtml } from '../textUtils.js';
import { T } from '../feedI18n.js';
import { normalizeKindleFormat } from '../kindleFormat.js';
import { autoSave } from './autosave.js';

// ── Section: Send-target devices (Kindle emails, LocalSend receivers) ──
// Each device is {id, label, type: 'kindle'|'localsend', addresses: [...]}
// — a single generic shape shared by both delivery methods (see
// StorageManager.migrateDeviceSettings / getActiveDevice). Multiple devices
// per type can be configured; the ★'d one is the active send target,
// updated automatically to whichever device a send last used.
export function initLocalSendSettings(storageData) {
    const scanBtn = document.getElementById('scanLocalSendButton');
    const statusLabel = document.getElementById('localSendStatus');
    const deliveryPreferenceSelect = document.getElementById('deliveryPreference');
    const kindleConfigBlock = document.getElementById('kindleDeliveryConfig');
    const localSendConfigBlock = document.getElementById('localSendDeliveryConfig');
    const kindleDeviceList = document.getElementById('kindleDeviceList');
    const localSendDeviceList = document.getElementById('localSendDeviceList');
    const newKindleLabel = document.getElementById('newKindleLabel');
    const newKindleEmail = document.getElementById('newKindleEmail');
    const addKindleDeviceButton = document.getElementById('addKindleDeviceButton');
    const newLocalSendLabel = document.getElementById('newLocalSendLabel');
    const newLocalSendIp = document.getElementById('newLocalSendIp');
    const addLocalSendDeviceButton = document.getElementById('addLocalSendDeviceButton');

    if (!localSendDeviceList) return;

    // devices is mutated in place and persisted after every add/remove/
    // activate, then re-rendered from that same in-memory copy — avoids a
    // re-fetch from storage after each change.
    let devices = Array.isArray(storageData[SK.devices]) ? [...storageData[SK.devices]] : [];
    let activeDeviceIds = { ...(storageData[SK.activeDevices] || {}) };

    const persistDevices = () => autoSave(SK.devices, devices);
    const persistActiveIds = () => autoSave(SK.activeDevices, activeDeviceIds);

    const addressLabel = (device) => {
        const addr = device.addresses?.[0] || '';
        return device.type === 'kindle' ? addr.replace(/^mailto:/i, '') : addr.replace(/^https?:\/\//i, '');
    };

    const renderDeviceList = (type, container) => {
        const list = devices.filter(d => d.type === type);
        if (list.length === 0) {
            container.innerHTML = `<div class="device-empty">${T('No devices added yet.')}</div>`;
            return;
        }
        // eslint-disable-next-line no-unsanitized/property -- reviewed: device fields are escaped
        container.innerHTML = list.map(d => {
            const isActive = activeDeviceIds[type] === d.id || (!activeDeviceIds[type] && list[0].id === d.id);
            return `
                <div class="device-row${isActive ? ' is-active' : ''}" data-id="${escapeHtml(d.id)}">
                    <button type="button" class="device-active-btn" data-type="${escapeHtml(type)}" title="${escapeHtml(isActive ? T('Active send target') : T('Set as active send target'))}" aria-pressed="${isActive}">${isActive ? '★' : '☆'}</button>
                    <div class="device-text">
                        <div class="device-label">${escapeHtml(d.label || (type === 'kindle' ? 'Kindle' : T('Device')))}</div>
                        <div class="device-address">${escapeHtml(addressLabel(d))}</div>
                    </div>
                    <button type="button" class="device-delete-btn" title="${escapeHtml(T('Remove device'))}" aria-label="${escapeHtml(T('Remove device'))}">🗑</button>
                </div>`;
        }).join('');

        container.querySelectorAll('.device-active-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                activeDeviceIds[type] = btn.closest('.device-row').dataset.id;
                persistActiveIds();
                renderDeviceList(type, container);
            });
        });
        container.querySelectorAll('.device-delete-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.closest('.device-row').dataset.id;
                devices = devices.filter(d => d.id !== id);
                if (activeDeviceIds[type] === id) delete activeDeviceIds[type];
                persistDevices();
                persistActiveIds();
                renderDeviceList(type, container);
            });
        });
    };

    const addDevice = (type, label, address) => {
        const id = `device_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        devices.push({ id, label: label || (type === 'kindle' ? 'Kindle' : T('Device')), type, addresses: [address] });
        // First device of its type becomes active automatically.
        if (!activeDeviceIds[type]) activeDeviceIds[type] = id;
        persistDevices();
        persistActiveIds();
        renderDeviceList(type, type === 'kindle' ? kindleDeviceList : localSendDeviceList);
    };

    renderDeviceList('kindle', kindleDeviceList);
    renderDeviceList('localsend', localSendDeviceList);

    if (addKindleDeviceButton) {
        addKindleDeviceButton.addEventListener('click', () => {
            const email = (newKindleEmail?.value || '').trim();
            if (!email) return;
            addDevice('kindle', (newKindleLabel?.value || '').trim(), `mailto:${email}`);
            if (newKindleLabel) newKindleLabel.value = '';
            if (newKindleEmail) newKindleEmail.value = '';
        });
    }

    // Which config block is visible is decided by the target list (sendTargets.js);
    // here we only tell it that the default target changed.
    const applyDeliveryModeVisibility = (mode) => {
        document.dispatchEvent(new CustomEvent('aish:delivery-default', { detail: { mode } }));
    };

    const kindleFormatSeg = document.getElementById('kindleFormat');
    if (kindleFormatSeg) {
        const btns = [...kindleFormatSeg.querySelectorAll('[role=radio]')];
        const paint = (f) => btns.forEach(b => { const on = b.dataset.value === f; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
        paint(normalizeKindleFormat(storageData.kindleFormat));
        btns.forEach((b, i) => {
            b.addEventListener('click', () => { paint(b.dataset.value); autoSave('kindleFormat', b.dataset.value); });
            b.addEventListener('keydown', (e) => {
                const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
                if (!d) return;
                e.preventDefault(); const n = btns[(i + d + btns.length) % btns.length]; n.focus(); n.click();
            });
        });
    }

    if (deliveryPreferenceSelect) {
        const btns = [...deliveryPreferenceSelect.querySelectorAll('[role=radio]')];
        const paint = (mode) => btns.forEach(b => { const on = b.dataset.value === mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
        const pick = (v) => { const m = v === 'localsend' ? 'localsend' : 'kindle'; paint(m); applyDeliveryModeVisibility(m); autoSave('deliveryPreference', m); };
        const currentMode = storageData.deliveryPreference === 'localsend' ? 'localsend' : 'kindle';
        paint(currentMode);
        applyDeliveryModeVisibility(currentMode);

        // Migrate old value 'both' to exclusive default 'kindle'.
        if (storageData.deliveryPreference === 'both') {
            autoSave('deliveryPreference', 'kindle');
        }

        btns.forEach((b, i) => {
            b.addEventListener('click', () => pick(b.dataset.value));
            b.addEventListener('keydown', (e) => {
                const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
                if (!d) return;
                e.preventDefault(); const n = btns[(i + d + btns.length) % btns.length]; n.focus(); n.click();
            });
        });
    } else {
        applyDeliveryModeVisibility('kindle');
    }

    if (addLocalSendDeviceButton) {
        addLocalSendDeviceButton.addEventListener('click', () => {
            const raw = (newLocalSendIp?.value || '').trim();
            if (!raw) return;
            const address = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
            addDevice('localsend', (newLocalSendLabel?.value || '').trim(), address);
            if (newLocalSendLabel) newLocalSendLabel.value = '';
            if (newLocalSendIp) newLocalSendIp.value = '';
            if (statusLabel) statusLabel.textContent = '';
        });
    }

    if (scanBtn) {
        scanBtn.addEventListener('click', async () => {
            scanBtn.disabled = true;
            scanBtn.textContent = T('Scanning...');

            if (statusLabel) {
                statusLabel.textContent = T('Searching LAN for LocalSend receiver...');
                statusLabel.dataset.tone = '';
            }

            try {
                const foundIp = await discoverLocalSendDevice();
                if (foundIp) {
                    if (newLocalSendIp) newLocalSendIp.value = foundIp;
                    if (statusLabel) {
                        statusLabel.textContent = T('Found device at {ip} — click Add to save it ✓', { ip: foundIp });
                        statusLabel.dataset.tone = 'ok';
                    }
                } else if (statusLabel) {
                    statusLabel.textContent = T('No active receiver found.');
                    statusLabel.dataset.tone = '';
                }
            } catch (err) {
                console.error('LocalSend scan failed:', err);
                if (statusLabel) {
                    statusLabel.textContent = T('Scan failed. Enter IP manually.');
                    statusLabel.dataset.tone = 'error';
                }
            } finally {
                scanBtn.disabled = false;
                scanBtn.textContent = T('Auto-Detect');
            }
        });
    }
}

async function discoverLocalSendDevice() {
    const localIp = await getLocalSubnetIp();
    if (!localIp) return null;

    const PORT = 53317;
    const prefix = localIp.substring(0, localIp.lastIndexOf('.'));
    const candidates = [];
    for (let i = 1; i < 255; i++) candidates.push(`${prefix}.${i}`);

    const batchSize = 24;
    for (let start = 0; start < candidates.length; start += batchSize) {
        const batch = candidates.slice(start, start + batchSize);
        const results = await Promise.all(batch.map(ip => probeLocalSendInfo(ip, PORT)));
        const found = results.find(Boolean);
        if (found) return found;
    }

    return null;
}

function probeLocalSendInfo(targetIp, port) {
    return new Promise((resolve) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => {
            controller.abort();
            resolve(null);
        }, 1100);

        // Probe KOReader-compatible HTTP first, then HTTPS; check both v2 and v1 routes.
        const probeInfo = async () => {
            const protocols = ['http', 'https'];
            const versions = ['v2', 'v1'];

            for (const protocol of protocols) {
                for (const version of versions) {
                    const data = await fetch(`${protocol}://${targetIp}:${port}/api/localsend/${version}/info`, {
                        method: 'GET',
                        signal: controller.signal
                    }).then(res => (res.ok ? res.json() : null)).catch(() => null);

                    if (data) {
                        return { data, protocol };
                    }
                }
            }

            return null;
        };

        probeInfo()
            .then(result => {
                clearTimeout(timeout);
                if (result?.data && (result.data.alias || result.data.deviceModel || result.data.version)) {
                    resolve(`${result.protocol}://${targetIp}`);
                } else {
                    resolve(null);
                }
            })
            .catch(() => {
                clearTimeout(timeout);
                resolve(null);
            });
    });
}

function getLocalSubnetIp() {
    return new Promise((resolve) => {
        try {
            const pc = new RTCPeerConnection({ iceServers: [] });
            pc.createDataChannel('');

            const timeout = setTimeout(() => {
                try { pc.close(); } catch (_) { /* peer connection already closed */ }
                resolve('192.168.1.1');
            }, 1200);

            pc.onicecandidate = (ice) => {
                const cand = ice?.candidate?.candidate;
                if (!cand) return;
                const match = /([0-9]{1,3}(?:\.[0-9]{1,3}){3})/.exec(cand);
                const myIp = match?.[1];
                if (myIp && (myIp.startsWith('192.168.') || myIp.startsWith('10.') || myIp.startsWith('172.'))) {
                    clearTimeout(timeout);
                    try { pc.close(); } catch (_) { /* peer connection already closed */ }
                    resolve(myIp);
                }
            };

            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .catch(() => {
                    clearTimeout(timeout);
                    try { pc.close(); } catch (_) { /* peer connection already closed */ }
                    resolve('192.168.1.1');
                });
        } catch (_) {
            resolve('192.168.1.1');
        }
    });
}

