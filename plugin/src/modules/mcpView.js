// modules/mcpView.js — Settings → "AI apps (MCP)": the local-MCP panel (see claude/prd-local-mcp.md §4.5).
// Renders itself into #mcpSettings off whatever is in chrome.storage.local; the background worker (modules/mcp/client.js)
// is the only thing that opens the actual socket, so this file only reads/writes settings and polls connection status.
import { T, TU } from './feedI18n.js';
import { SK } from './storageKeys.js';

const $ = (id) => document.getElementById(id);
const local = () => chrome.storage.local;
const getL = (keys) => new Promise((r) => local().get(keys, r));
const setL = (obj) => new Promise((r) => local().set(obj, r));

const DEFAULT_SCOPES = { library: true, fulltext: false, feeds: false, write: false };
const SCOPE_LABELS = () => ([
    ['library', T('Your library'), T('Search, read and highlights')],
    ['fulltext', T('Full article text'), T('Lets an app read the whole saved text, not just the summary')],
    ['feeds', T('Feeds'), T('Unread items from your subscriptions')],
    ['write', T('Save links'), T('Lets an app save a URL into your inbox')],
]);

async function getConfig() {
    const d = await getL({ [SK.mcpConfig]: {} });
    return { enabled: false, port: 47615, excludeTag: 'private', scopes: DEFAULT_SCOPES, ...(d[SK.mcpConfig] || {}) };
}
async function patchConfig(patch) {
    const cfg = await getConfig();
    const next = { ...cfg, ...patch, scopes: { ...cfg.scopes, ...(patch.scopes || {}) } };
    await setL({ [SK.mcpConfig]: next });
    return next;
}
async function getLog() {
    const d = await getL({ [SK.mcpLog]: [] });
    return Array.isArray(d[SK.mcpLog]) ? d[SK.mcpLog] : [];
}
async function hasSecret() {
    const d = await getL({ [SK.mcpSecret]: '' });
    return !!d[SK.mcpSecret];
}
function sendMessage(msg) {
    return new Promise((resolve) => {
        try { chrome.runtime.sendMessage(msg, (res) => resolve(res || { ok: false })); }
        catch (_) { resolve({ ok: false }); }
    });
}

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}
function toggleRow(label, hint, checked, onChange, { disabled = false } = {}) {
    const block = el('div', 'a11y-block');
    const row = el('div', 'setting-group flex justify-between align-center');
    const lab = el('label', 'setting-label-inline', label);
    const sw = el('label', 'switch');
    const input = document.createElement('input');
    input.type = 'checkbox'; input.checked = !!checked; input.disabled = !!disabled;
    const slider = el('span', 'slider-toggle');
    sw.append(input, slider);
    row.append(lab, sw);
    block.append(row);
    if (hint) block.append(el('p', 'a11y-hint', hint));
    if (!disabled) input.addEventListener('change', () => onChange(input.checked));
    return block;
}

let pairingCodeValue = '';
let statusTimer = null;

async function render() {
    const root = $('mcpSettings');
    if (!root) return;
    const [cfg, paired, status, log] = await Promise.all([getConfig(), hasSecret(), sendMessage({ action: 'mcpStatus' }), getLog()]);
    const frag = document.createDocumentFragment();

    frag.append(el('p', 'setting-note', T('AI apps on this computer, like Claude Desktop, LM Studio or Cursor, can search and read your library. Nothing goes through our server. What leaves your computer depends on the app and model you use.')));

    const help = el('a', 'setting-note', T('How to connect Claude Desktop, LM Studio, Cursor and more'));
    help.href = 'https://ai-summary-helper.byphil.eu/blog/ai-apps-mcp.html'; help.target = '_blank'; help.rel = 'noopener';
    frag.append(help);

    // ── main on/off ──
    frag.append(toggleRow(T('Let AI apps on this computer use my library'), null, cfg.enabled, async (checked) => {
        await patchConfig({ enabled: checked });
        render();
    }));

    if (cfg.enabled) {
        // ── status line ──
        let statusText, statusCls = 'setting-note';
        if (!status || !status.available) { statusText = T('Reload AI Summary Helper to finish turning this on.'); }
        else if (!paired) { statusText = T('Waiting for a pairing code.'); }
        else if (status.connected) { statusText = T('Connected'); statusCls = 'setting-note phone-inbox-status'; }
        else { statusText = T('Not connected. Open your AI app, or follow the guide above to set one up.'); statusCls = 'setting-note phone-inbox-error'; }
        frag.append(el('p', statusCls, statusText));

        // ── pairing code ──
        const pairRow = el('div', 'a11y-block');
        const label = el('label', 'setting-label-inline', T('Pairing code'));
        label.htmlFor = 'mcpPairingInput';
        const input = document.createElement('input');
        input.type = 'text'; input.id = 'mcpPairingInput'; input.placeholder = T('Paste your pairing code'); input.value = pairingCodeValue;
        input.autocomplete = 'off'; input.spellcheck = false;
        input.addEventListener('input', () => { pairingCodeValue = input.value; });
        const btnRow = el('div', 'phone-inbox-actions');
        const connectBtn = document.createElement('button');
        connectBtn.type = 'button'; connectBtn.className = 'button-primary'; connectBtn.textContent = paired ? T('Replace code') : T('Connect');
        connectBtn.addEventListener('click', async () => {
            const token = pairingCodeValue.trim();
            if (!token) return;
            await setL({ [SK.mcpSecret]: token });
            pairingCodeValue = '';
            await render();
        });
        btnRow.append(connectBtn);
        if (paired) {
            const disconnectBtn = document.createElement('button');
            disconnectBtn.type = 'button'; disconnectBtn.className = 'button-danger btn-sm'; disconnectBtn.textContent = T('Disconnect');
            disconnectBtn.addEventListener('click', async () => {
                await chrome.storage.local.remove(SK.mcpSecret);
                await patchConfig({ enabled: false });
                await render();
            });
            btnRow.append(disconnectBtn);
        }
        pairRow.append(label, input, btnRow);
        frag.append(pairRow);

        // ── scopes ──
        frag.append(el('p', 'settings-caption', TU('What apps may do')));
        for (const [key, label2, hint] of SCOPE_LABELS()) {
            frag.append(toggleRow(label2, hint, cfg.scopes[key], async (checked) => { await patchConfig({ scopes: { [key]: checked } }); }, { disabled: key === 'library' }));
        }

        // ── exclude tag ──
        const tagBlock = el('div', 'a11y-block');
        const tagRow = el('div', 'setting-group flex justify-between align-center');
        const tagLabel = el('label', 'setting-label-inline', T('Never show articles tagged'));
        tagLabel.htmlFor = 'mcpExcludeTag';
        const tagInput = document.createElement('input');
        tagInput.type = 'text'; tagInput.id = 'mcpExcludeTag'; tagInput.value = cfg.excludeTag || ''; tagInput.placeholder = 'private';
        tagInput.addEventListener('change', async () => { await patchConfig({ excludeTag: tagInput.value.trim() }); });
        tagRow.append(tagLabel, tagInput);
        tagBlock.append(tagRow);
        frag.append(tagBlock);

        // ── activity log ──
        frag.append(el('p', 'settings-caption', TU('Recent activity')));
        if (!log.length) {
            frag.append(el('p', 'setting-note', T('No calls yet.')));
        } else {
            const list = el('div', 'mcp-activity-log');
            log.slice(-10).reverse().forEach((entry) => {
                const row = el('div', 'mcp-activity-row');
                const when = entry.at ? new Date(entry.at).toLocaleTimeString() : '';
                row.append(el('span', 'mcp-activity-tool', entry.tool || ''));
                row.append(el('span', entry.ok ? 'mcp-activity-ok' : 'mcp-activity-err', entry.ok ? T('ok') : (entry.error || T('error'))));
                row.append(el('span', 'mcp-activity-time', when));
                list.append(row);
            });
            frag.append(list);
        }
    }

    root.replaceChildren(frag);
    const sub = document.querySelector('.settings-row-sub[data-sub="mcp"]');
    if (sub) sub.textContent = !cfg.enabled ? T('Off') : (status && status.connected ? T('Connected') : T('On'));
}

export function initMcpView() {
    render();
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (SK.mcpConfig in changes || SK.mcpSecret in changes || SK.mcpLog in changes) render();
    });
    // The connection state lives in the background worker, not storage, so poll it while the panel might be visible.
    clearInterval(statusTimer);
    statusTimer = setInterval(render, 5000);
}
