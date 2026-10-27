// modules/mcpView.js — Settings → "AI apps (MCP)" (see claude/prd-local-mcp.md §4.5; design: Figma "AI apps (MCP) · 3 variants").
// Two states once the feature is on:
//   not connected → guided setup: 1 turned on · 2 pair aish-mcp · 3 add AISH to your app, plus "Waiting for your app…"
//   connected     → status card (calls today, last call, tools) with Replace code and Disconnect
// Below both: what apps may do (library always on, three switches, exclude tag) and the recent activity.
// The background worker (modules/mcp/client.js) owns the socket; this file only reads/writes settings and polls status.
import { T, TU } from './feedI18n.js';
import { SK } from './storageKeys.js';
import { iconEl } from './icons.js';

const $ = (id) => document.getElementById(id);
const local = () => chrome.storage.local;
const getL = (keys) => new Promise((r) => local().get(keys, r));
const setL = (obj) => new Promise((r) => local().set(obj, r));
const removeL = (keys) => new Promise((r) => local().remove(keys, r));

const GUIDE_URL = 'https://ai-summary-helper.byphil.eu/blog/ai-apps-mcp.html';
const PAIR_COMMAND = 'npx -y aish-mcp pair';
const DEFAULT_SCOPES = { library: true, fulltext: false, feeds: false, write: false };
const SERVER = { command: 'npx', args: ['-y', 'aish-mcp'] };
const APPS = () => ([
    { id: 'claude', name: 'Claude Desktop', config: { mcpServers: { aish: SERVER } }, hint: T('In Claude Desktop: Settings → Developer → Edit Config. Paste this, then quit Claude Desktop and open it again.') },
    { id: 'lmstudio', name: 'LM Studio', config: { mcpServers: { aish: SERVER } }, hint: T('Add this to LM Studio\'s mcp.json, then restart LM Studio.') },
    { id: 'cursor', name: 'Cursor', config: { mcpServers: { aish: SERVER } }, hint: T('Add this to ~/.cursor/mcp.json, then restart Cursor.') },
    { id: 'vscode', name: 'VS Code', config: { servers: { aish: { type: 'stdio', ...SERVER } } }, hint: T('Add this to .vscode/mcp.json in your project.') },
]);
const SCOPES = () => ([
    ['fulltext', 'file-text', T('Full article text'), T('Whole saved text')],
    ['feeds', 'newspaper', T('Feeds'), T('Unread subscription items')],
    ['write', 'link', T('Save links'), T('Add URLs to your inbox')],
]);

const PROMPTS = () => ([
    T('Summarize everything I saved in the last 7 days, grouped by theme, with my highlights quoted.'),
    T('What\'s due in my saved-for-later list? Rank it by what I\'d regret skipping and give me a 2-line brief for each.'),
    T('Search my library for a topic, read the top 5 articles in full, and write a brief that says which article each claim came from.'),
    T('Do any of my saved articles on a topic disagree? Show both sides with sources.'),
    T('What does my saving pattern say about my interests this quarter? What is rising and what has faded?'),
    T('From my feed items, pick the 5 worth saving based on my library, and save them.'),
]);

// ── state that survives re-renders ──
let selectedApp = 'claude';
let codeDraft = '';
let replacing = false;
let lastStatusSig = '';

async function getConfig() {
    const d = await getL({ [SK.mcpConfig]: {} });
    const cfg = d[SK.mcpConfig] || {};
    return { enabled: false, port: 47615, excludeTag: 'private', ...cfg, scopes: { ...DEFAULT_SCOPES, ...(cfg.scopes || {}) } };
}
async function patchConfig(patch) {
    const cfg = await getConfig();
    await setL({ [SK.mcpConfig]: { ...cfg, ...patch, scopes: { ...cfg.scopes, ...(patch.scopes || {}) } } });
}
async function getLog() { const d = await getL({ [SK.mcpLog]: [] }); return Array.isArray(d[SK.mcpLog]) ? d[SK.mcpLog] : []; }
async function hasSecret() { const d = await getL({ [SK.mcpSecret]: '' }); return !!d[SK.mcpSecret]; }
function status() {
    return new Promise((resolve) => {
        try { chrome.runtime.sendMessage({ action: 'mcpStatus' }, (res) => { void chrome.runtime.lastError; resolve(res || { ok: false }); }); }
        catch (_) { resolve({ ok: false }); }
    });
}

// ── tiny DOM helpers ──
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function button(label, cls, onClick) { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', onClick); return b; }
function chip(label, cls = '') { return el('span', 'mcp-chip ' + cls, label); }
function copyButton(text, label = T('Copy'), cls = 'mcp-chip is-accent') {
    const b = button(label, cls, async () => {
        try { await navigator.clipboard.writeText(text); b.textContent = T('Copied'); }
        catch (_) { b.textContent = T('Select and copy it'); }
        setTimeout(() => { b.textContent = label; }, 1600);
    });
    return b;
}
function switchRow(title, hint, checked, onChange) {
    const row = el('label', 'mcp-row');
    const text = el('span', 'mcp-row-text');
    text.append(el('span', 'mcp-row-title', title));
    if (hint) text.append(el('span', 'mcp-row-hint', hint));
    const sw = el('span', 'switch');
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!checked;
    input.addEventListener('change', () => onChange(input.checked));
    sw.append(input, el('span', 'slider-toggle'));
    row.append(text, sw);
    return row;
}
function codeField(id, placeholder, onSave, saveLabel) {
    const wrap = el('div', 'mcp-field');
    const label = el('label', null, T('Pairing code')); label.htmlFor = id;
    const input = document.createElement('input');
    Object.assign(input, { type: 'text', id, placeholder, value: codeDraft, autocomplete: 'off', spellcheck: false });
    input.addEventListener('input', () => { codeDraft = input.value; });
    const save = async () => { const v = codeDraft.trim(); if (!v) { input.focus(); return; } await setL({ [SK.mcpSecret]: v }); codeDraft = ''; replacing = false; render(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    wrap.append(label, input, button(saveLabel, 'button-primary w-full', save));
    return wrap;
}

function step(n, title, state, done) {
    const card = el('section', 'mcp-card' + (state === 'now' ? ' is-now' : ''));
    const head = el('div', 'mcp-step-head');
    const badge = el('span', 'mcp-badge' + (done ? ' is-done' : state === 'now' ? ' is-now' : ''), done ? '✓' : String(n));
    badge.setAttribute('aria-hidden', 'true');
    const label = done ? T('Done') : state === 'now' ? T('Now') : T('Next');
    head.append(badge, el('span', 'mcp-step-title', title), chip(label, done ? 'is-ok' : state === 'now' ? 'is-accent' : ''));
    card.append(head);
    return card;
}

const isToday = (iso) => { const d = new Date(iso); const n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate(); };
const timeOf = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–';
function callsToday(log) { const n = log.filter((e) => isToday(e.at)).length; return n >= 50 && log.length >= 50 ? '50+' : String(n); }

let renderToken = 0;
async function render() {
    const root = $('mcpSettings');
    if (!root) return;
    const token = ++renderToken;
    const [cfg, paired, st, log] = await Promise.all([getConfig(), hasSecret(), status(), getLog()]);
    if (token !== renderToken) return;
    lastStatusSig = JSON.stringify([st.available, st.connected, cfg.enabled, paired]);
    const frag = document.createDocumentFragment();
    const panel = el('div', 'mcp-panel');
    frag.append(panel);

    panel.append(el('p', 'setting-note', T('AI apps on this computer, like Claude Desktop, LM Studio or Cursor, can search and read your library. Nothing goes through our server. What leaves your computer depends on the app and model you use.')));
    const help = el('a', 'mcp-link', T('How to connect Claude Desktop, LM Studio, Cursor and more') + ' ›');
    help.href = GUIDE_URL; help.target = '_blank'; help.rel = 'noopener';
    panel.append(help);
    panel.append(switchRow(T('Let AI apps on this computer use my library'), T('Off by default. Switch off any time.'), cfg.enabled, async (on) => { await patchConfig({ enabled: on }); render(); }));

    if (cfg.enabled) {
        if (st.ok && st.available === false) panel.append(el('p', 'setting-note phone-inbox-error', T('Reload AI Summary Helper to finish turning this on.')));
        if (st.connected) panel.append(connectedCard(st, log));
        else panel.append(...setupSteps(paired));
        panel.append(...tryAsking(cfg));
        panel.append(...permissions(cfg));
        panel.append(...activity(log));
    }

    if (token !== renderToken) return;
    // keep focus and caret in the field the user is typing in (a status change re-renders the panel)
    const active = document.activeElement && root.contains(document.activeElement) ? document.activeElement.id : '';
    root.replaceChildren(frag);
    if (active && $(active)) { const f = $(active); f.focus(); if (f.setSelectionRange && typeof f.value === 'string') f.setSelectionRange(f.value.length, f.value.length); }
    const sub = document.querySelector('.settings-row-sub[data-sub="mcp"]');
    if (sub) sub.textContent = !cfg.enabled ? T('Off') : st.connected ? T('Connected') : T('On');
}

function connectedCard(st, log) {
    const card = el('section', 'mcp-card mcp-hero');
    const head = el('div', 'mcp-hero-status');
    head.append(el('span', 'mcp-dot'), el('span', null, T('Connected')));
    card.append(head, el('p', 'mcp-row-hint', T('Your AI apps can search and read your library right now.')));
    const stats = el('div', 'mcp-stats');
    const stat = (value, label) => { const s = el('div', 'mcp-stat'); s.append(el('b', null, value), el('span', null, label)); return s; };
    stats.append(stat(callsToday(log), T('calls today')), stat(timeOf(log.length ? log[log.length - 1].at : ''), T('last call')), stat(String(st.tools || '–'), T('tools')));
    card.append(stats);
    if (replacing) {
        card.append(codeField('mcpReplaceInput', T('Paste the new pairing code'), null, T('Save code')));
        card.append(button(T('Cancel'), 'mcp-link-button', () => { replacing = false; codeDraft = ''; render(); }));
    } else {
        const actions = el('div', 'mcp-actions');
        actions.append(
            button(T('Replace code'), 'button-secondary btn-sm', () => { replacing = true; render(); setTimeout(() => $('mcpReplaceInput')?.focus(), 0); }),
            button(T('Disconnect'), 'button-danger-outline btn-sm', async () => { await removeL(SK.mcpSecret); replacing = false; render(); }),
        );
        card.append(actions);
    }
    return card;
}

function setupSteps(paired) {
    const out = [];
    const s1 = step(1, T('Turned on'), 'done', true);
    s1.append(el('p', 'mcp-row-hint', T('Your library stays private until you pair an app.')));
    out.push(s1);

    const s2 = step(2, T('Pair aish-mcp'), paired ? 'done' : 'now', paired);
    if (paired && !replacing) {
        const line = el('div', 'mcp-inline');
        line.append(el('span', 'mcp-row-hint', T('Pairing code saved.')), button(T('Replace code'), 'mcp-link-button', () => { replacing = true; render(); setTimeout(() => $('mcpPairingInput')?.focus(), 0); }));
        s2.append(line);
    } else {
        s2.append(el('p', 'mcp-row-hint', T('Run this once in a terminal. It prints a pairing code.')));
        const cmd = el('div', 'mcp-code'); cmd.append(el('code', null, PAIR_COMMAND), copyButton(PAIR_COMMAND));
        s2.append(cmd, codeField('mcpPairingInput', T('Paste your pairing code'), null, T('Connect')));
    }
    out.push(s2);

    const s3 = step(3, T('Add AISH to your app'), paired ? 'now' : 'next', false);
    s3.append(el('p', 'mcp-row-hint', T('Pick your app and copy its setting.')));
    const apps = el('div', 'mcp-apps'); apps.setAttribute('role', 'radiogroup'); apps.setAttribute('aria-label', T('Your AI app'));
    const list = APPS(); const app = list.find((a) => a.id === selectedApp) || list[0];
    for (const a of list) {
        const b = button(a.name, 'mcp-chip' + (a.id === app.id ? ' is-selected' : ''), () => { selectedApp = a.id; render(); });
        b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(a.id === app.id));
        apps.append(b);
    }
    const json = JSON.stringify(app.config, null, 2);
    s3.append(apps, el('pre', 'mcp-config', json), copyButton(json, T('Copy config'), 'button-secondary btn-sm mcp-self-start'), el('p', 'mcp-row-hint', app.hint));
    out.push(s3);

    if (paired) { const w = el('div', 'mcp-wait'); w.setAttribute('role', 'status'); w.append(el('span', 'mcp-dot is-wait'), el('span', null, T('Waiting for your app… This updates on its own.'))); out.push(w); }
    return out;
}

function tryAsking(cfg) {
    const out = [el('p', 'settings-caption', TU('Try asking your AI app')), el('p', 'mcp-row-hint', T('Tap one to copy it, then paste it into your app.'))];
    const list = el('div', 'mcp-prompts');
    const prompts = PROMPTS();
    prompts.forEach((text, i) => {
        const line = el('span', null, text);
        const b = button('', 'mcp-prompt', async () => {
            try { await navigator.clipboard.writeText(text); line.textContent = T('Copied'); }
            catch (_) { line.textContent = T('Select and copy it'); }
            setTimeout(() => { line.textContent = text; }, 1600);
        });
        b.append(line);
        // the last one saves links from feeds; both switches are off by default, so say so instead of letting the app fail
        if (i === prompts.length - 1 && !(cfg.scopes.feeds && cfg.scopes.write)) b.append(el('span', 'mcp-row-hint', T('Needs Feeds and Save links switched on below.')));
        list.append(b);
    });
    out.push(list);
    return out;
}

function permissions(cfg) {
    const out = [el('p', 'settings-caption', TU('What apps may do'))];
    // Design B "Permission tiles": 2×2 grid, each tile is a toggle (library is fixed on).
    const grid = el('div', 'mcp-tiles');
    const tile = (icon, title, hint, state, onToggle, id) => {
        const t = el(onToggle ? 'button' : 'div', 'mcp-tile' + (state ? ' is-on' : ''));
        if (id) t.id = id;
        if (onToggle) { t.type = 'button'; t.setAttribute('aria-pressed', String(!!state)); t.addEventListener('click', onToggle); }
        const head = el('span', 'mcp-tile-head');
        head.append(iconEl(icon), chip(state === 'always' ? T('Always on') : state ? T('On') : T('Off'), state ? 'is-accent' : ''));
        t.append(head, el('span', 'mcp-tile-title', title), el('span', 'mcp-tile-hint', hint));
        return t;
    };
    grid.append(tile('book-open', T('Your library'), T('Search, read, highlights'), 'always', null));
    for (const [key, icon, title, hint] of SCOPES()) grid.append(tile(icon, title, hint, !!cfg.scopes[key], () => patchConfig({ scopes: { [key]: !cfg.scopes[key] } }), 'mcpScope-' + key));
    out.push(grid);
    const f = el('div', 'mcp-field');
    const label = el('label', null, T('Never share articles tagged')); label.htmlFor = 'mcpExcludeTag';
    const input = document.createElement('input'); Object.assign(input, { type: 'text', id: 'mcpExcludeTag', value: cfg.excludeTag || '', placeholder: 'private', spellcheck: false });
    input.addEventListener('change', () => patchConfig({ excludeTag: input.value.trim() }));
    f.append(label, input);
    out.push(f);
    return out;
}

function activity(log) {
    const head = el('div', 'mcp-section-head');
    head.append(el('p', 'settings-caption', TU('Recent activity')));
    if (log.length) head.append(el('span', 'mcp-row-hint', T('{n} calls today', { n: callsToday(log) })));
    if (!log.length) return [head, el('p', 'setting-note', T('No calls yet.'))];
    const list = el('div', 'mcp-activity-log');
    log.slice(-10).reverse().forEach((entry) => {
        const row = el('div', 'mcp-activity-row');
        row.append(el('span', 'mcp-activity-tool', entry.tool || ''), el('span', entry.ok ? 'mcp-activity-ok' : 'mcp-activity-err', entry.ok ? T('ok') : (entry.error || T('error'))), el('span', 'mcp-activity-time', timeOf(entry.at)));
        list.append(row);
    });
    return [head, list];
}

let pollTimer = null;
export function initMcpView() {
    render();
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (SK.mcpConfig in changes || SK.mcpSecret in changes || SK.mcpLog in changes) render();
    });
    // Connection state lives in the background worker, not in storage: poll it while the panel is open, re-render on change.
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
        const panel = $('settingsPanel-mcp');
        if (!panel || panel.hidden) return;
        const [st, cfg, paired] = await Promise.all([status(), getConfig(), hasSecret()]);
        if (JSON.stringify([st.available, st.connected, cfg.enabled, paired]) !== lastStatusSig) render();
    }, 3000);
}
