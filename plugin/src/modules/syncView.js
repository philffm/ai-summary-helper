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
let draft = null;             // the place being edited: { name, root, scope, filter, include, connectionId }
let serverDraft = null;       // a new server, or the changes to an existing one: { name, url, username }
let draftSecret = '';
let editServer = false;       // the fields of the selected server are open for changes
let busy = false;
let testMsg = null;           // { ok, text }
let formError = '';
let previewToken = 0;

const blankDraft = (connectionId = '') => ({ name: '', root: 'public', connectionId, scope: 'tag', filter: { tag: 'public' }, include: { highlights: true, qa: false } });
const blankServer = () => ({ name: '', url: '', username: '' });

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
// A run that stopped writing progress (the worker was killed) stops looking "running" after 90 seconds.
export function runningOf(st, now = Date.now()) { return st && st.running && now - (st.running.at || 0) < 90000 ? st.running : null; }
export function phaseText(r) {
    switch (r && r.phase) {
        case 'checking': return T('Checking your library…');
        case 'removing': return T('Removing {done} of {total}', { done: r.done, total: r.total });
        case 'uploading': return T('Uploading {done} of {total}', { done: r.done, total: r.total });
        case 'list': return T('Updating the list…');
        default: return T('Starting…');
    }
}
function statusSub(place, st, count) {
    if (place.enabled === false) return T('Paused');
    const run = runningOf(st);
    if (run) return phaseText(run);
    if (!st) return T('Not published yet');
    if (st.ok && st.more) return TN(st.remaining || 0, 'Continuing… {n} file left', 'Continuing… {n} files left');
    if (!st.ok) return (st.error && st.error.message) || T('Could not reach the server');
    return TN(count, '{n} article', '{n} articles') + ' · ' + T('published {t} ago', { t: timeAgo(Date.parse(st.at)) });
}

// ── screens ──
let renderToken = 0;
async function render() {
    const root = $('syncSettings');
    if (!root) return;
    const token = ++renderToken;
    const [places, status, connections] = await Promise.all([svc.placesNow(), svc.statusNow(), svc.connectionsNow()]);
    const counts = {};
    for (const p of places) counts[p.id] = await ledgerCount(p.id);
    if (token !== renderToken) return;
    const frag = document.createDocumentFragment();
    if (view === 'add') frag.append(...addScreen());
    else if (view === 'form') frag.append(...formScreen(places.find((p) => p.id === editId), status[editId], counts[editId], connections, places));
    else frag.append(...listScreen(places, status, counts, connections));
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

function listScreen(places, status, counts, connections) {
    const out = [];
    out.push(el('p', 'setting-note', T('Publish your library to your own server. Each place has its own address, the articles it receives and what goes out. Nothing leaves this device until you add one.')));
    if (places.length) {
        out.push(el('p', 'settings-caption', TU('Places')));
        for (const p of places) { const c = connections.find((x) => x.id === p.connectionId); out.push(listRow(p.mode === 'encrypted' ? 'lock' : 'globe', p.name, (c ? c.name + ' / ' + p.root + ' · ' : '') + statusSub(p, status[p.id], counts[p.id] || 0), () => openForm(p.id))); }
    }
    const add = button('', 'button-secondary w-full', () => { view = 'add'; render(); });
    add.append(iconEl('plus'), document.createTextNode(' ' + T('Add a place')));
    out.push(add);
    if (places.length) {
        out.push(el('p', 'settings-caption', TU('All places')));
        const actions = el('div', 'mcp-actions');
        const running = places.some((p) => runningOf(status[p.id]));
        const now = button(running ? T('Syncing…') : T('Sync now'), 'button-secondary btn-sm', async () => { now.disabled = true; now.textContent = T('Syncing…'); await sendToWorker({ action: 'syncNow' }); render(); });
        now.disabled = running;
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
    editId = id; view = 'form'; testMsg = null; formError = ''; draftSecret = ''; editServer = false; serverDraft = blankServer();
    Promise.all([getL({ [SK.syncPlaces]: [] }), svc.connectionsNow()]).then(([d, conns]) => {
        const p = id ? (d[SK.syncPlaces] || []).find((x) => x.id === id) : null;
        draft = p ? JSON.parse(JSON.stringify(p)) : blankDraft(conns.length ? conns[conns.length - 1].id : '');
        const c = conns.find((x) => x.id === draft.connectionId);
        if (c) serverDraft = { name: c.name, url: c.url, username: c.username };
        render().then(refreshPreview);
    });
}

function heroNode(place, st, count) {
    const hero = el('section', 'mcp-card mcp-hero'); hero.id = 'syncHero';
    const run = runningOf(st);
    const s = el('div', 'mcp-hero-status');
    s.append(el('span', 'mcp-dot' + (run ? ' is-wait' : st && st.ok === false ? ' is-wait' : '')), el('span', null, statusSub(place, st, count)));
    hero.append(s);
    if (run) {
        const bar = document.createElement('progress'); bar.className = 'sync-progress';
        if (run.total > 0) { bar.max = run.total; bar.value = Math.min(run.done, run.total); }
        bar.setAttribute('aria-label', phaseText(run));
        hero.append(bar);
        s.setAttribute('role', 'status'); s.setAttribute('aria-live', 'polite');
    }
    if (st && st.needsConfirm && !run) {
        hero.append(hint(TN(st.needsConfirm, '{n} file is no longer wanted here and would be removed from your server. Check that this is right.', '{n} files are no longer wanted here and would be removed from your server. Check that this is right.')));
        const a = el('div', 'mcp-actions');
        a.append(button(T('Remove them'), 'button-danger-outline btn-sm', async () => { await sendToWorker({ action: 'syncNow', placeId: place.id, confirmRemovals: true }); }));
        hero.append(a);
    }
    const a = el('div', 'mcp-actions');
    const pub = button(run ? T('Publishing…') : T('Publish now'), 'button-secondary btn-sm', async () => { pub.disabled = true; pub.textContent = T('Publishing…'); await sendToWorker({ action: 'syncNow', placeId: place.id }); refreshHero(); });
    pub.disabled = !!run;
    a.append(pub);
    hero.append(a);
    return hero;
}

/** Replaces only the status card while someone edits the form: nothing they typed is touched. */
async function refreshHero() {
    const old = $('syncHero');
    if (!old || view !== 'form' || !editId) return;
    const [places, status] = await Promise.all([svc.placesNow(), svc.statusNow()]);
    const place = places.find((p) => p.id === editId);
    if (!place || !$('syncHero')) return;
    $('syncHero').replaceWith(heroNode(place, status[editId], await ledgerCount(editId)));
}

function formScreen(place, st, count, connections = [], places = []) {
    if (!draft) draft = blankDraft();
    const editing = !!editId && !!place;
    const out = [head(editing ? draft.name : T('Nextcloud / WebDAV'), { label: '‹ ' + T('Sync & backup'), fn: () => { view = 'list'; render(); } })];
    if (editing) out.push(heroNode(place, st, count));

    // the server: pick one you already set up, or add a new one
    out.push(el('p', 'settings-caption', TU('Server')));
    const isNew = !draft.connectionId;
    if (connections.length) {
        const pick = el('div', 'mcp-apps'); pick.setAttribute('role', 'radiogroup'); pick.setAttribute('aria-label', T('Server'));
        for (const c of connections) {
            const b = button(c.name, 'mcp-chip' + (c.id === draft.connectionId ? ' is-selected' : ''), () => { draft.connectionId = c.id; editServer = false; draftSecret = ''; serverDraft = { name: c.name, url: c.url, username: c.username }; render().then(refreshPreview); });
            b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(c.id === draft.connectionId)); pick.append(b);
        }
        const nb = button(T('New server'), 'mcp-chip' + (isNew ? ' is-selected' : ''), () => { draft.connectionId = ''; editServer = false; draftSecret = ''; serverDraft = blankServer(); render(); });
        nb.setAttribute('role', 'radio'); nb.setAttribute('aria-checked', String(isNew)); pick.append(nb);
        out.push(pick);
    }
    const conn = connections.find((c) => c.id === draft.connectionId);
    const showFields = isNew || editServer;
    if (conn && !editServer) {
        const shared = places.filter((p) => p.connectionId === conn.id).length;
        out.push(hint(conn.url + (conn.username ? ' · ' + conn.username : '')));
        out.push(hint(TN(shared, '{n} place uses this server.', '{n} places use this server.') + ' ' + T('The login is saved once for all of them.')));
        out.push(button(T('Edit server'), 'mcp-link-button', () => { editServer = true; render(); }));
    }
    if (showFields) {
        out.push(field('syncServerName', T('Server name'), serverDraft.name, { placeholder: T('My Nextcloud'), onInput: (v) => { serverDraft.name = v; } }));
        out.push(field('syncUrl', T('Server address'), serverDraft.url, { placeholder: 'https://cloud.example.com/remote.php/dav/files/you/', onInput: (v) => { serverDraft.url = v; } }));
        out.push(field('syncUser', T('Username'), serverDraft.username, { onInput: (v) => { serverDraft.username = v; } }));
        out.push(field('syncPass', T('App password'), draftSecret, { type: 'password', placeholder: conn ? T('Unchanged') : '', onInput: (v) => { draftSecret = v; }, help: T('In Nextcloud: Settings → Security → create an app password. Never use your main password.') }));
        if (conn && editServer) {
            out.push(hint(T('Changes here apply to every place on this server.')));
            const row = el('div', 'mcp-actions');
            row.append(button(T('Save server'), 'button-secondary btn-sm', async () => {
                try { await svc.updateServer(conn.id, serverDraft, draftSecret ? { password: draftSecret } : null); editServer = false; draftSecret = ''; testMsg = { ok: true, text: T('Server saved.') }; formError = ''; }
                catch (e) { formError = e.message; }
                render();
            }), button(T('Cancel'), 'mcp-link-button', () => { editServer = false; serverDraft = { name: conn.name, url: conn.url, username: conn.username }; draftSecret = ''; render(); }));
            out.push(row);
        }
    }

    // the folder on that server: one folder per purpose, for example public/ and backup/
    out.push(el('p', 'settings-caption', TU('Folder')));
    out.push(field('syncName', T('Name'), draft.name, { placeholder: T('Website list'), onInput: (v) => { draft.name = v; } }));
    out.push(field('syncRoot', T('Folder on the server'), draft.root, { placeholder: 'public', onInput: (v) => { draft.root = v; }, help: T('Created for you. Use one folder for each purpose, for example public for a website list and backup for a full copy.') }));

    out.push(el('p', 'settings-caption', TU('Who can read it')));
    const tiles = el('div', 'mcp-tiles');
    tiles.append(tile('lock', T('Encrypted'), T('Only you can read it. The provider sees scrambled files.'), 'off', { disabled: true }),
        tile('globe', T('Readable'), T('Plain JSON files for your website or other tools.'), 'on'));
    out.push(tiles);
    out.push(el('div', 'explanatory-card sync-warn', T('Anyone who can open this folder can read these files. Use a folder you control, and keep it private unless you want to publish it.')));
    out.push(hint(T('This place publishes only: this device writes the files and never reads them back. Syncing between your devices is coming.')));

    out.push(el('p', 'settings-caption', TU('Which articles')));
    const scope = draft.scope || 'tag';
    const seg = el('div', 'a11y-seg'); seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', T('Which articles'));
    for (const [id, label] of [['tag', T('With a tag')], ['except', T('All except a tag')], ['all', T('All')]]) {
        const b = button(label, id === scope ? 'on' : '', () => {
            if (id === scope) return;
            draft.scope = id;
            draft.filter = id === 'tag' ? { tag: (draft.lastTag || 'public') } : id === 'except' ? { excludeTag: (draft.lastExcl || 'private') } : {};
            render().then(refreshPreview);
        });
        b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(id === scope));
        seg.append(b);
    }
    out.push(seg);
    if (scope === 'tag') out.push(field('syncTag', T('Only publish articles tagged'), (draft.filter && draft.filter.tag) || '', { placeholder: 'public', onInput: (v) => { draft.filter = { tag: v }; draft.lastTag = v; refreshPreview(); } }));
    if (scope === 'except') out.push(field('syncTag', T('Publish everything except articles tagged'), (draft.filter && draft.filter.excludeTag) || '', { placeholder: 'private', onInput: (v) => { draft.filter = { excludeTag: v }; draft.lastExcl = v; refreshPreview(); } }));
    if (scope === 'all') out.push(el('div', 'explanatory-card sync-warn', T('Every article you saved goes out, including ones you may not want others to read. A backup that only you can read should be encrypted instead.')));
    out.push(el('p', 'settings-caption', TU('What goes out')));
    out.push(switchRow(T('Highlights'), T('Your yellow and AI highlights'), draft.include.highlights, (on) => { draft.include.highlights = on; }));
    out.push(switchRow(T('Pinned Q&A'), T('Questions you pinned, with answers'), draft.include.qa, (on) => { draft.include.qa = on; }));
    out.push(hint(T('Notes, reminders and full article text are never published.')));
    const pv = el('section', 'mcp-card');
    const pvHead = el('div', 'mcp-step-head');
    pvHead.append(el('span', 'mcp-step-title', T('What goes out')), (() => { const c = chip('…', 'is-accent'); c.id = 'syncPreviewCount'; return c; })());
    pv.append(pvHead, hint(T('Each article becomes one file, plus a list for your website (library.json).')));
    out.push(pv);

    if (formError) { const e = el('p', 'setting-note phone-inbox-error', formError); e.setAttribute('role', 'alert'); out.push(e); }
    if (testMsg) { const m = el('p', 'setting-note' + (testMsg.ok ? '' : ' phone-inbox-error'), testMsg.text); m.setAttribute('role', 'status'); out.push(m); }

    const actions = el('div', 'mcp-actions');
    const request = () => ({ connectionId: draft.connectionId, connection: draft.connectionId ? undefined : { ...serverDraft, service: 'webdav' }, place: draft, secret: { password: draftSecret } });
    const test = button(T('Test connection'), 'button-secondary btn-sm', async () => {
        test.disabled = true; testMsg = null; formError = '';
        const r = await svc.test(request());
        testMsg = r.ok ? { ok: true, text: TN(r.count, 'Connected. {n} article matches.', 'Connected. {n} articles match.') } : { ok: false, text: r.error.message };
        render();
    });
    const save = button(editing ? T('Save') : T('Connect and publish'), 'button-primary btn-sm', async () => {
        if (busy) return; busy = true; save.disabled = true; formError = ''; testMsg = null;
        try {
            if (editing) {
                if (editServer) await svc.updateServer(draft.connectionId, serverDraft, draftSecret ? { password: draftSecret } : null);
                await svc.update(editId, draft); await sendToWorker({ action: 'syncNow', placeId: editId });
            } else { const p = await svc.add(request()); await sendToWorker({ action: 'syncNow', placeId: p.id }); }
            view = 'list'; draft = null; draftSecret = ''; editServer = false;
        } catch (e) { formError = e.message || T('Could not save this place.'); }
        busy = false; render();
    });
    actions.append(test, save);
    out.push(actions);

    if (editing) {
        out.push(hint(T('Removing a place stops publishing. The files already on your server stay where they are. A server that no place uses any more is forgotten with its login.')));
        const rm = el('div', 'mcp-actions');
        rm.append(button(T('Remove this place'), 'button-danger-outline btn-sm', async () => {
            if (!window.confirm(T('Remove this place? The files already on your server are not deleted.'))) return;
            await svc.remove(editId); view = 'list'; draft = null; render();
        }));
        out.push(rm);
    }
    return out;
}

async function refreshPreview() {
    const token = ++previewToken;
    const chipEl = $('syncPreviewCount');
    if (!chipEl || !draft) return;
    try {
        const f = draft.filter || {};
        const input = { ...draft, url: draft.url || 'https://example.com/', filter: draft.scope === 'tag' ? { tag: f.tag || '…' } : draft.scope === 'except' ? { excludeTag: f.excludeTag || '…' } : {}, service: 'webdav' };
        const r = await svc.preview(input);
        if (token === previewToken && $('syncPreviewCount')) $('syncPreviewCount').textContent = TN(r.count, '{n} article', '{n} articles');
    } catch (_) { /* an incomplete form has no preview yet */ }
}

export function initSyncView() {
    render();
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (view === 'form') { if (SK.syncStatus in changes) refreshHero(); return; }   // never re-render a form while someone types in it
        if (SK.syncPlaces in changes || SK.syncStatus in changes) render();
    });
}
export { cleanPlace };
