import { SK } from './storageKeys.js';
import { T } from './feedI18n.js';
// sendTargets.js
// Settings › Send & Share as a target list. Each row opens its own detail view
// (the existing Kindle / LocalSend forms, ids unchanged). The default target is
// the existing `deliveryPreference` (kindle | localsend), shown as a "Default" tag;
// ★ stays "active device" inside the Kindle / LocalSend lists.

const $ = (id) => document.getElementById(id);
let view = 'list';

const TARGETS = [
    { id: 'kindle', icon: 'send', emoji: '📚', name: () => 'Kindle' },
    { id: 'localsend', icon: 'smartphone', emoji: '📖', name: () => 'KOReader / LocalSend' },
    { id: 'phone', icon: 'smartphone', emoji: '📱', name: () => T('Phone inbox'), panel: 'phoneinbox' },
    { id: 'share', icon: 'share', emoji: '↗️', name: () => T('Share') },
];

export function setSendView(next) {
    view = next || 'list';
    const panel = $('settingsPanel-send');
    if (!panel) return;
    panel.querySelectorAll('.send-pane').forEach(el => {
        el.hidden = !(el.dataset.sendPane || '').split(' ').includes(view);
    });
    panel.querySelectorAll('.send-detail').forEach(el => { el.hidden = el.id !== 'sendDetail-' + view; });
    const list = $('sendTargets');
    if (list) list.hidden = view !== 'list';
    const head = panel.querySelector('.settings-back[data-back]');
    if (head) head.hidden = view !== 'list';
}

async function status() {
    const out = {};
    let devices = [], mode = 'kindle', paired = false;
    try {
        const local = await chrome.storage.local.get([SK.devices]);
        devices = Array.isArray(local[SK.devices]) ? local[SK.devices] : [];
        const sync = await chrome.storage.sync.get(['deliveryPreference']);
        mode = sync.deliveryPreference === 'localsend' ? 'localsend' : 'kindle';
    } catch (e) { /* storage unavailable */ }
    const sub = document.querySelector('.settings-row-sub[data-sub="phoneinbox"]');
    paired = !!(sub && /paired|gekoppelt/i.test(sub.textContent) && !/not|nicht/i.test(sub.textContent));
    const count = (t) => devices.filter(d => d.type === t).length;
    const dev = (t) => { const n = count(t); return n ? T('{n} devices', { n }) : T('Not set up'); };
    out.kindle = dev('kindle'); out.localsend = dev('localsend');
    out.phone = sub ? sub.textContent.trim() : T('Not paired');
    out.share = T('Always available');
    out.mode = mode; out.paired = paired;
    return out;
}

export async function renderSendTargets() {
    const list = $('sendTargets');
    if (!list) return;
    const st = await status();
    list.textContent = '';
    for (const t of TARGETS) {
        const row = document.createElement('button');
        row.type = 'button'; row.className = 'settings-row send-target'; row.setAttribute('role', 'listitem');
        row.dataset.target = t.id;
        const ic = document.createElement('span'); ic.className = 'settings-row-icon'; ic.textContent = t.emoji; ic.setAttribute('aria-hidden', 'true');
        const tx = document.createElement('span'); tx.className = 'settings-row-text';
        const ti = document.createElement('span'); ti.className = 'settings-row-title'; ti.textContent = t.name();
        const su = document.createElement('span'); su.className = 'settings-row-sub'; su.textContent = st[t.id];
        tx.append(ti, su);
        row.append(ic, tx);
        if (t.id === st.mode) {
            const tag = document.createElement('span'); tag.className = 'send-default-tag'; tag.textContent = T('Default'); row.append(tag);
        }
        const ch = document.createElement('span'); ch.className = 'settings-row-chev'; ch.textContent = '›'; ch.setAttribute('aria-hidden', 'true');
        row.append(ch);
        row.addEventListener('click', async () => {
            if (t.panel) { const m = await import('./settingsNav.js'); m.openSettingsPanel(t.panel); return; }
            setSendView(t.id);
        });
        list.append(row);
    }
    for (const [id, mode] of [['sendDefaultKindle', 'kindle'], ['sendDefaultLocalsend', 'localsend']]) {
        const sw = $(id); if (sw) sw.checked = st.mode === mode;
    }
}

export function initSendTargets() {
    const panel = $('settingsPanel-send');
    if (!panel || panel.dataset.sendInit) return;
    panel.dataset.sendInit = '1';
    panel.querySelectorAll('[data-send-back]').forEach(b => b.addEventListener('click', () => { setSendView('list'); renderSendTargets(); }));
    // Default switch → drives the (hidden) original control so settingsManager saves it.
    const bind = (id, mode) => {
        const sw = $(id); if (!sw) return;
        sw.addEventListener('change', () => {
            const target = sw.checked ? mode : (mode === 'kindle' ? 'localsend' : 'kindle');
            const btn = document.querySelector(`#deliveryPreference [data-value="${target}"]`);
            if (btn) btn.click();
            setTimeout(renderSendTargets, 60);
        });
    };
    bind('sendDefaultKindle', 'kindle'); bind('sendDefaultLocalsend', 'localsend');
    document.addEventListener('aish:delivery-default', () => setTimeout(renderSendTargets, 60));
    // Opening the panel (also from search) starts on the list, or on the target holding the searched control.
    document.addEventListener('aish:settings-panel', (e) => {
        if (e.detail?.name !== 'send') return;
        const id = e.detail.targetId;
        const el = id && $(id);
        const pane = el && el.closest('[data-send-pane]');
        const first = pane && (pane.dataset.sendPane || '').split(' ').find(v => v !== 'list');
        setSendView(first || 'list');
        renderSendTargets();
    });
    setSendView('list');
    setTimeout(renderSendTargets, 500);
}
