// modules/syncView.js — Settings → "Sync & backup" (design: variant B "List of places", .briefs/prd-library-sync.md).
//   list   the places (each with its status), Add a place, Sync now
//   add    choose the kind of place
//   form   one place: address and login, who can read it, which articles, what goes out; test and save
// Built from the same pieces as the AI apps panel (mcp-* classes) and Send & Share (settings-row list).
// Today: WebDAV places that publish readable files (publish only). Encrypted places and two-way sync are shown as "Soon".
// The run itself happens in the background worker (message syncNow); this file only edits places and shows their status.
import { T, TN, TU } from './feedI18n.js';
import { SK, syncLedgerKey } from './storageKeys.js';
import { iconEl } from './icons.js';
import { timeAgo } from './feedUtil.js';
import { createSyncService, cleanPlace } from './syncService.js';
import { createStampStore } from './syncStampStore.js';
import { makeStore } from './syncStores.js';

const $ = (id) => document.getElementById(id);
const getL = (keys) => new Promise((r) => chrome.storage.local.get(keys, r));

const svc = createSyncService({ storage: chrome.storage.local, makeStore, stampStore: createStampStore({ storage: chrome.storage.local }) });

// ── state that survives re-renders ──
let view = 'list';            // 'list' | 'add' | 'form'
let editId = '';              // '' = a new place
let draft = null;
let draftSecret = '';
let busy = false;
let testMsg = null;           // { ok, text }
let formError = '';
let previewToken = 0;

const blankDraft = () => ({ service: 'webdav', name: '', url: '', root: 'aish-sync', username: '', filter: { tag: 'public' }, include: { highlights: true, qa: false } });

// ── tiny DOM helpers ──
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function button(label, cls, onClick) { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', onClick); return b; }
function chip(label, cls = '') { return el('span', 'mcp-chip ' + cls, label); }
function hint(text) { return el('p', 'mcp-row-hint', text); }
function field(id, label, value, { type = 'text', placeholder = '', onInput, help } = {}) {
    const wrap = el('div', 'mcp-field');
    const l = el('label', null, label); l.htmlFor = id;
    const input = document.createElement('input');
    Object.assign(input, { type, id, value: value || '', placeholder, autocomplete: type === 'password' ? 'new-password' : 'off', spellcheck: false });
    input.addEventListener('input', () => onInput && onInput(input.value));
    wrap.append(l, input);
    if (help) wrap.append(hint(help));
    return wrap;
}
function switchRow(title, hintText, checked, onChange) {
    const row = el('label', 'mcp-row');
    const text = el('span', 'mcp-row-text');
    text.append(el('span', 'mcp-row-title', title));
    if (hintText) text.append(el('span', 'mcp-row-hint', hintText));
    const sw = el('span', 'switch');
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!checked;
    input.addEventListener('change', () => onChange(input.checked));
    sw.append(input, el('span', 'slider-toggle'));
    row.append(text, sw);
    return row;
}
function listRow(icon, title, sub, onClick, { chev = true, disabled = false, tag = '' } = {}) {
    const b = el('button', 'settings-row'); b.type = 'button';
    if (disabled) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
    const ic = el('span', 'settings-row-icon'); ic.append(iconEl(icon, 'icon--lg'));
    const text = el('span', 'settings-row-text');
    text.append(el('span', 'settings-row-title', title), el('span', 'settings-row-sub', sub));
    b.append(ic, text);
    if (tag) b.append(chip(tag));
    else if (chev) { const c = el('span', 'settings-row-chev'); c.append(iconEl('chevron-right')); b.append(c); }
    if (onClick) b.addEventListener('click', onClick);
    return b;
}
function head(title, back) {
    const h = el('div', 'settings-panel-head');
    h.append(button(back.label, 'settings-back', back.fn), el('h2', null, title));
    return h;
}
function tile(icon, title, hintText, state, { disabled = false, onClick } = {}) {
    const t = el('button', 'mcp-tile' + (state === 'on' ? ' is-on' : ''));
    t.type = 'button'; t.setAttribute('aria-pressed', String(state === 'on'));
    if (disabled) { t.disabled = true; t.setAttribute('aria-disabled', 'true'); }
    const h = el('span', 'mcp-tile-head'); h.append(iconEl(icon), chip(disabled ? T('Soon') : state === 'on' ? T('Selected') : T('Choose'), state === 'on' ? 'is-accent' : ''));
    t.append(h, el('span', 'mcp-tile-title', title), el('span', 'mcp-tile-hint', hintText));
    if (onClick && !disabled) t.addEventListener('click', onClick);
    return t;
}
function sendToWorker(msg) {
    return new Promise((resolve) => {
        try { chrome.runtime.sendMessage(msg, (res) => { void chrome.runtime.lastError; resolve(res || { ok: false }); }); } catch (_) { resolve({ ok: false }); }
    });
}

// ── status text ──
async function ledgerCount(id) { const d = await getL({ [syncLedgerKey(id)]: {} }); const l = d[syncLedgerKey(id)]; return l && l.items ? Object.keys(l.items).length : 0; }
function statusSub(place, st, count) {
    if (place.enabled === false) return T('Paused');
    if (!st) return T('Not published yet');
    if (!st.ok) return (st.error && st.error.message) || T('Could not reach the server');
    return TN(count, '{n} article', '{n} articles') + ' · ' + T('published {t} ago', { t: timeAgo(Date.parse(st.at)) });
}

// ── screens ──
let renderToken = 0;
async function render() {
    const root = $('syncSettings');
    if (!root) return;
    const token = ++renderToken;
    const [places, status] = await Promise.all([svc.placesNow(), svc.statusNow()]);
    const counts = {};
    for (const p of places) counts[p.id] = await ledgerCount(p.id);
    if (token !== renderToken) return;
    const frag = document.createDocumentFragment();
    if (view === 'add') frag.append(...addScreen());
    else if (view === 'form') frag.append(...formScreen(places.find((p) => p.id === editId), status[editId], counts[editId]));
    else frag.append(...listScreen(places, status, counts));
    root.replaceChildren(frag);
    updateRowSub(places, status);
}

function updateRowSub(places, status) {
    const sub = document.querySelector('.settings-row-sub[data-sub="sync"]');
    if (!sub) return;
    if (!places.length) { sub.textContent = T('Off'); return; }
    const times = Object.values(status || {}).filter((s) => s && s.ok && s.at).map((s) => Date.parse(s.at));
    sub.textContent = TN(places.length, '{n} place', '{n} places') + (times.length ? ' · ' + T('synced {t} ago', { t: timeAgo(Math.max(...times)) }) : '');
}

function listScreen(places, status, counts) {
    const out = [];
    out.push(el('p', 'setting-note', T('Publish your library to your own server. Each place has its own address, the articles it receives and what goes out. Nothing leaves this device until you add one.')));
    if (places.length) {
        out.push(el('p', 'settings-caption', TU('Places')));
        for (const p of places) out.push(listRow(p.mode === 'encrypted' ? 'lock' : 'globe', p.name, statusSub(p, status[p.id], counts[p.id] || 0), () => openForm(p.id)));
    }
    const add = button('', 'button-secondary w-full', () => { view = 'add'; render(); });
    add.append(iconEl('plus'), document.createTextNode(' ' + T('Add a place')));
    out.push(add);
    if (places.length) {
        out.push(el('p', 'settings-caption', TU('All places')));
        const actions = el('div', 'mcp-actions');
        const now = button(T('Sync now'), 'button-secondary btn-sm', async () => { now.disabled = true; now.textContent = T('Syncing…'); await sendToWorker({ action: 'syncNow' }); render(); });
        actions.append(now);
        out.push(actions);
    }
    return out;
}

function addScreen() {
    const out = [head(T('Add a place'), { label: '‹ ' + T('Sync & backup'), fn: () => { view = 'list'; render(); } })];
    out.push(listRow('server', T('Nextcloud / WebDAV'), T('Nextcloud, ownCloud, Synology, most NAS boxes'), () => openForm('')));
    out.push(listRow('cloud', T('S3-compatible'), T('AWS, Cloudflare R2, Backblaze, MinIO'), null, { disabled: true, tag: T('Soon') }));
    out.push(listRow('folders', T('A folder on this computer'), T('Syncthing, iCloud Drive, Dropbox. Chrome and Edge only'), null, { disabled: true, tag: T('Soon') }));
    return out;
}

function openForm(id) {
    editId = id; view = 'form'; testMsg = null; formError = ''; draftSecret = '';
    getL({ [SK.syncPlaces]: [] }).then((d) => {
        const p = id ? (d[SK.syncPlaces] || []).find((x) => x.id === id) : null;
        draft = p ? JSON.parse(JSON.stringify(p)) : blankDraft();
        render().then(refreshPreview);
    });
}

function formScreen(place, st, count) {
    if (!draft) draft = blankDraft();
    const editing = !!editId && !!place;
    const out = [head(editing ? draft.name : T('Nextcloud / WebDAV'), { label: '‹ ' + T('Sync & backup'), fn: () => { view = 'list'; render(); } })];

    if (editing) {
        const hero = el('section', 'mcp-card mcp-hero');
        const s = el('div', 'mcp-hero-status');
        s.append(el('span', 'mcp-dot' + (st && st.ok === false ? ' is-wait' : '')), el('span', null, statusSub(place, st, count)));
        hero.append(s);
        if (st && st.needsConfirm) {
            hero.append(hint(TN(st.needsConfirm, '{n} file is no longer wanted here and would be removed from your server. Check that this is right.', '{n} files are no longer wanted here and would be removed from your server. Check that this is right.')));
            const a = el('div', 'mcp-actions');
            a.append(button(T('Remove them'), 'button-danger-outline btn-sm', async () => { await sendToWorker({ action: 'syncNow', placeId: editId, confirmRemovals: true }); render(); }));
            hero.append(a);
        }
        const a = el('div', 'mcp-actions');
        const pub = button(T('Publish now'), 'button-secondary btn-sm', async () => { pub.disabled = true; pub.textContent = T('Publishing…'); await sendToWorker({ action: 'syncNow', placeId: editId }); render(); });
        a.append(pub);
        hero.append(a);
        out.push(hero);
    }

    out.push(el('p', 'settings-caption', TU('Where')));
    out.push(field('syncName', T('Name'), draft.name, { placeholder: T('My website'), onInput: (v) => { draft.name = v; } }));
    out.push(field('syncUrl', T('Server address'), draft.url, { placeholder: 'https://cloud.example.com/remote.php/dav/files/you/', onInput: (v) => { draft.url = v; } }));
    out.push(field('syncRoot', T('Folder'), draft.root, { placeholder: 'aish-sync', onInput: (v) => { draft.root = v; }, help: T('A folder inside that address. It is created for you.') }));
    out.push(field('syncUser', T('Username'), draft.username, { onInput: (v) => { draft.username = v; } }));
    out.push(field('syncPass', T('App password'), draftSecret, { type: 'password', placeholder: editing ? T('Unchanged') : '', onInput: (v) => { draftSecret = v; }, help: T('In Nextcloud: Settings → Security → create an app password. Never use your main password.') }));

    out.push(el('p', 'settings-caption', TU('Who can read it')));
    const tiles = el('div', 'mcp-tiles');
    tiles.append(tile('lock', T('Encrypted'), T('Only you can read it. The provider sees scrambled files.'), 'off', { disabled: true }),
        tile('globe', T('Readable'), T('Plain JSON files for your website or other tools.'), 'on'));
    out.push(tiles);
    out.push(el('div', 'explanatory-card sync-warn', T('Anyone who can open this folder can read these files. Use a folder you control, and keep it private unless you want to publish it.')));
    out.push(hint(T('This place publishes only: this device writes the files and never reads them back. Syncing between your devices is coming.')));

    out.push(el('p', 'settings-caption', TU('What goes out')));
    out.push(field('syncTag', T('Only publish articles tagged'), (draft.filter && draft.filter.tag) || '', { placeholder: 'public', onInput: (v) => { draft.filter = { tag: v }; refreshPreview(); } }));
    out.push(switchRow(T('Highlights'), T('Your yellow and AI highlights'), draft.include.highlights, (on) => { draft.include.highlights = on; }));
    out.push(switchRow(T('Pinned Q&A'), T('Questions you pinned, with answers'), draft.include.qa, (on) => { draft.include.qa = on; }));
    out.push(hint(T('Notes, reminders and full article text are never published.')));
    const pv = el('section', 'mcp-card');
    const pvHead = el('div', 'mcp-step-head');
    pvHead.append(el('span', 'mcp-step-title', T('What goes out')), (() => { const c = chip('…', 'is-accent'); c.id = 'syncPreviewCount'; return c; })());
    pv.append(pvHead, hint(T('Articles with this tag. Each becomes one file, and a list for your website (library.json).')));
    out.push(pv);

    if (formError) { const e = el('p', 'setting-note phone-inbox-error', formError); e.setAttribute('role', 'alert'); out.push(e); }
    if (testMsg) { const m = el('p', 'setting-note' + (testMsg.ok ? '' : ' phone-inbox-error'), testMsg.text); m.setAttribute('role', 'status'); out.push(m); }

    const actions = el('div', 'mcp-actions');
    const test = button(T('Test connection'), 'button-secondary btn-sm', async () => {
        test.disabled = true; testMsg = null; formError = '';
        const r = await svc.test(draft, { password: passwordForTest(place) });
        testMsg = r.ok ? { ok: true, text: TN(r.count, 'Connected. {n} article matches.', 'Connected. {n} articles match.') } : { ok: false, text: r.error.message };
        render();
    });
    const save = button(editing ? T('Save') : T('Connect and publish'), 'button-primary btn-sm', async () => {
        if (busy) return; busy = true; save.disabled = true; formError = ''; testMsg = null;
        try {
            if (editing) { await svc.update(editId, draft, draftSecret ? { password: draftSecret } : null); await sendToWorker({ action: 'syncNow', placeId: editId }); }
            else { const p = await svc.add(draft, { password: draftSecret }); await sendToWorker({ action: 'syncNow', placeId: p.id }); }
            view = 'list'; draft = null; draftSecret = '';
        } catch (e) { formError = e.message || T('Could not save this place.'); }
        busy = false; render();
    });
    actions.append(test, save);
    out.push(actions);

    if (editing) {
        out.push(hint(T('Removing a place stops publishing. The files already on your server stay where they are.')));
        const rm = el('div', 'mcp-actions');
        rm.append(button(T('Remove this place'), 'button-danger-outline btn-sm', async () => {
            if (!window.confirm(T('Remove this place? The files already on your server are not deleted.'))) return;
            await svc.remove(editId); view = 'list'; draft = null; render();
        }));
        out.push(rm);
    }
    return out;
}

// A stored password is not shown again: testing an existing place without typing one uses the saved login.
function passwordForTest(place) { return draftSecret || ''; }

async function refreshPreview() {
    const token = ++previewToken;
    const chipEl = $('syncPreviewCount');
    if (!chipEl || !draft) return;
    try {
        const input = { ...draft, url: draft.url || 'https://example.com/', filter: draft.filter && draft.filter.tag ? draft.filter : { tag: '…' }, service: 'webdav' };
        const r = await svc.preview(input);
        if (token === previewToken && $('syncPreviewCount')) $('syncPreviewCount').textContent = TN(r.count, '{n} article', '{n} articles');
    } catch (_) { /* an incomplete form has no preview yet */ }
}

export function initSyncView() {
    render();
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (view === 'form' && !(SK.syncStatus in changes)) return;   // never re-render a form while someone types in it
        if (SK.syncPlaces in changes || SK.syncStatus in changes) render();
    });
}
export { cleanPlace };
