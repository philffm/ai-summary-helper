// sendSheet.js
// History multi-select + "Send" sheet: pick several summarized articles and send them to a Kindle or a
// LocalSend receiver, either as ONE digest (summaries bundled via buildMagazineArticle) or as separate files.
// Flow: ☑️ Select → tap cards → bar "Send n" → sheet (format, target) → confirm → progress → done.
// Delivery itself is injected (deliverKindle / deliverLocalSend from articleManager), so this module
// has no knowledge of the Kindle API or the LocalSend protocol.
import StorageManager from './storageManager.js';
import { buildMagazineArticle } from './digestBuilder.js';
import { T, TN } from './feedI18n.js';

let deps = null;
const sel = new Set();                 // selected article ids
const reg = new Map();                 // id -> { article, li }
let active = false;
let bar = null;
let sheet = null;

const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const screenEl = () => document.getElementById('historyScreen');

/** Only articles that really have a summary can be sent (feed stubs are placeholders). */
export const isSendable = (a) => !!(a && !a.feedStub && a.summary && String(a.summary).trim());

export const selectionActive = () => active;

/** Called by the history list for every card it builds. */
export function registerCard(article, li) {
    reg.set(article.id, { article, li });
    li.dataset.id = article.id;
    li.prepend(el('span', 'sel-box'));
    if (!isSendable(article)) li.classList.add('not-selectable');
    li.classList.toggle('sel-on', sel.has(article.id));
}

export function toggleCard(article) {
    if (!isSendable(article)) { deps.toast(T('Only summarized articles can be sent')); return; }
    if (sel.has(article.id)) sel.delete(article.id); else sel.add(article.id);
    const r = reg.get(article.id);
    if (r) r.li.classList.toggle('sel-on', sel.has(article.id));
    paintBar();
}

function visibleSendable() {
    return [...reg.values()].filter(r => r.li.isConnected && r.li.style.display !== 'none' && isSendable(r.article)).map(r => r.article);
}

function setActive(on) {
    active = on;
    const s = screenEl();
    if (s) s.classList.toggle('selecting', on);
    const b = document.getElementById('selectModeBtn');
    if (b) b.setAttribute('aria-pressed', String(on));
    if (!on) { sel.clear(); reg.forEach(r => r.li.classList.remove('sel-on')); }
    if (on) buildBar(); else if (bar) { bar.remove(); bar = null; }
    paintBar();
}

function buildBar() {
    if (bar) return;
    bar = el('div', 'sel-bar');
    const x = el('button', 'sel-x button-secondary', '✕');
    x.type = 'button'; x.setAttribute('aria-label', T('Cancel'));
    x.addEventListener('click', () => setActive(false));
    const info = el('div', 'sel-info');
    info.append(el('div', 'sel-count'), el('div', 'sel-sub', T('Only summarized articles can be sent')));
    const all = el('button', 'sel-all button-secondary', T('Select all'));
    all.type = 'button';
    all.addEventListener('click', () => {
        const list = visibleSendable();
        const every = list.length > 0 && list.every(a => sel.has(a.id));
        list.forEach(a => { if (every) sel.delete(a.id); else sel.add(a.id); const r = reg.get(a.id); if (r) r.li.classList.toggle('sel-on', !every); });
        paintBar();
    });
    const send = el('button', 'sel-send button-primary');
    send.type = 'button';
    send.addEventListener('click', () => { if (sel.size) openSheet(); });
    bar.append(x, info, all, send);
    (screenEl() || document.body).append(bar);
}

function paintBar() {
    if (!bar) return;
    const n = sel.size;
    bar.querySelector('.sel-count').textContent = n ? T('{n} selected', { n }) : T('Select summaries');
    const send = bar.querySelector('.sel-send');
    send.textContent = n ? T('📤 Send {n}', { n }) : T('📤 Send');
    send.disabled = n === 0;
}

// ───────────────────────────── sheet ─────────────────────────────

const state = { format: 'digest' };

function closeSheet() { if (sheet) { sheet.remove(); sheet = null; } }

function selected() {
    return [...sel].map(id => reg.get(id)?.article).filter(Boolean)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function shell(title, subtitle) {
    const body = sheet.querySelector('.sendsheet-body');
    body.textContent = '';
    if (title) {
        const h = el('div', 'sendsheet-head');
        h.append(el('div', 'sendsheet-title', title));
        if (subtitle) h.append(el('div', 'sendsheet-sub', subtitle));
        body.append(h);
    }
    return body;
}

function segmented(body) {
    const seg = el('div', 'sendsheet-seg');
    seg.setAttribute('role', 'radiogroup');
    [['digest', T('One digest')], ['files', T('Separate files')]].forEach(([v, label]) => {
        const b = el('button', 'sendsheet-seg-btn' + (state.format === v ? ' on' : ''), label);
        b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(state.format === v));
        b.addEventListener('click', () => { state.format = v; seg.querySelectorAll('.sendsheet-seg-btn').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); }); });
        seg.append(b);
    });
    body.append(seg);
}

function row(icon, title, sub, onClick, trail = '›') {
    const r = el('button', 'sendsheet-row');
    r.type = 'button';
    const tx = el('span', 'sendsheet-row-tx');
    tx.append(el('span', 'sendsheet-row-t', title));
    if (sub) tx.append(el('span', 'sendsheet-row-s', sub));
    r.append(el('span', 'sendsheet-row-ic', icon), tx, el('span', 'sendsheet-row-go', trail));
    r.addEventListener('click', onClick);
    return r;
}

function btn(label, primary, onClick) {
    const b = el('button', primary ? 'button-primary' : 'button-secondary', label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
}

function openSheet() {
    closeSheet();
    sheet = el('div', 'sendsheet');
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true');
    const scrim = el('div', 'sendsheet-scrim');
    scrim.addEventListener('click', () => { if (!sheet.dataset.busy) closeSheet(); });
    const panel = el('div', 'sendsheet-panel');
    panel.append(el('div', 'sendsheet-grab'), el('div', 'sendsheet-body'));
    sheet.append(scrim, panel);
    document.body.append(sheet);
    viewChoose();
}

async function viewChoose() {
    const list = selected();
    const n = list.length;
    const names = list.slice(0, 2).map(a => a.title || T('Untitled')).join(', ') + (n > 2 ? ' ' + T('and {n} more', { n: n - 2 }) : '');
    const body = shell(TN(n, 'Send {n} summary', 'Send {n} summaries'), names);
    if (n > 1) segmented(body); else state.format = 'files';
    const cfg = await StorageManager.getAll();
    if (!sheet) return;
    const l = (Array.isArray(cfg.devices) ? cfg.devices : []).filter(d => d.type === 'localsend');
    const kd = StorageManager.getActiveDevice(cfg, 'kindle');
    body.append(
        row('📚', T('Send to Kindle'), kd ? (kd.label || kd.addresses?.[0] || '') : T('Not set up yet — add your Kindle in Settings'), () => viewKindle()),
        row('📡', T('LocalSend'), l.length ? TN(l.length, '{n} receiver', '{n} receivers') : T('Not set up yet — add a receiver in Settings'), () => viewLocalSend()),
        btn(T('Cancel'), false, closeSheet));
}

async function viewKindle() {
    const cfg = await StorageManager.getAll();
    if (!sheet) return;
    const devices = (Array.isArray(cfg.devices) ? cfg.devices : []).filter(d => d.type === 'kindle');
    const isPro = cfg.pb_user?.subscription_status === 'active';
    const list = selected();
    const body = shell(T('📚 Send to Kindle'), TN(list.length, '{n} summary', '{n} summaries'));
    if (!devices.length) {
        body.append(el('div', 'sendsheet-note', T('Set your Kindle email in Settings first.')),
            btn(T('Open Settings'), true, () => { closeSheet(); setActive(false); deps.openSettings('send', 'newKindleEmail'); }),
            btn(T('Back'), false, viewChoose));
        return;
    }
    let chosen = StorageManager.getActiveDevice(cfg, 'kindle');
    const note = el('div', 'sendsheet-note', T('Make sure kindle@byphil.eu is on your Amazon “Approved senders” list.')
        + (isPro ? '' : ' ' + T('Free tier: 3 Kindle sends included.')));
    body.append(note);
    const pick = () => {
        body.querySelectorAll('.sendsheet-row.kindle').forEach(r => r.remove());
        devices.forEach(d => {
            const r = row(d.id === chosen.id ? '●' : '○', d.label || 'Kindle', (d.addresses?.[0] || '').replace(/^mailto:/i, ''), () => { chosen = d; pick(); }, '');
            r.classList.add('kindle'); r.classList.toggle('on', d.id === chosen.id);
            body.insertBefore(r, note);
        });
    };
    pick();
    body.append(btn(T('📚 Send {n} to Kindle', { n: list.length }), true, () => run('kindle', chosen)), btn(T('Back'), false, viewChoose));
}

async function viewLocalSend() {
    const cfg = await StorageManager.getAll();
    if (!sheet) return;
    const devices = (Array.isArray(cfg.devices) ? cfg.devices : []).filter(d => d.type === 'localsend');
    const body = shell(T('📡 LocalSend'), T('Pick the receiver. Its app has to be open and on the same Wi‑Fi.'));
    if (!devices.length) {
        body.append(el('div', 'sendsheet-note', T('Please set your LocalSend IP in Settings first.')),
            btn(T('Open Settings'), true, () => { closeSheet(); setActive(false); deps.openSettings('send', 'newLocalSendIp'); }),
            btn(T('Back'), false, viewChoose));
        return;
    }
    const act = StorageManager.getActiveDevice(cfg, 'localsend');
    devices.sort((a, b) => (b.id === act?.id) - (a.id === act?.id)).forEach(d => {
        body.append(row('📱', d.label || T('Device'), (d.addresses?.[0] || '').trim(), () => run('localsend', d)));
    });
    body.append(btn(T('Back'), false, viewChoose));
}

/** Jobs to run: one digest, or one file per article. */
async function buildJobs() {
    const list = selected();
    if (state.format === 'digest' && list.length > 1) {
        return [{ label: T('Digest of {n} summaries', { n: list.length }), article: buildMagazineArticle(list) }];
    }
    const jobs = [];
    for (const a of list) {
        let full = a;
        try { const f = await StorageManager.getArticleFull(a.id); if (f) full = { ...a, ...f }; } catch (_) { /* summary only */ }
        jobs.push({ label: a.title || T('Untitled'), article: full });
    }
    return jobs;
}

async function run(kind, device) {
    sheet.dataset.busy = '1';
    const target = kind === 'kindle' ? (device.label || 'Kindle') : (device.label || device.addresses?.[0] || T('Device'));
    const body = shell(kind === 'kindle' ? T('Sending to Kindle…') : T('Sending to {name}…', { name: target }),
        kind === 'kindle' ? T('Please keep this window open') : T('Waiting for the other device to accept'));
    const track = el('div', 'sendsheet-track'); const fillEl = el('div', 'sendsheet-fill'); track.append(fillEl);
    const steps = el('div', 'sendsheet-steps');
    body.append(track, steps);
    const jobs = await buildJobs();
    const lines = jobs.map(j => { const d = el('div', 'sendsheet-step', '○ ' + j.label); steps.append(d); return d; });
    let cancelled = false;
    body.append(btn(T('Cancel'), false, () => { cancelled = true; }));
    const paint = (done, cur) => { fillEl.style.width = Math.max(4, Math.round(((done + (cur ? 0.5 : 0)) / jobs.length) * 100)) + '%'; };
    paint(0, true);
    let done = 0;
    for (let i = 0; i < jobs.length; i++) {
        if (cancelled) break;
        lines[i].textContent = '⏳ ' + jobs[i].label; paint(done, true);
        let res;
        try { res = kind === 'kindle' ? await deps.deliverKindle(jobs[i].article, device) : await deps.deliverLocalSend(jobs[i].article, device); }
        catch (e) { res = { ok: false, error: e?.message || String(e) }; }
        if (!sheet) return;
        if (!res || !res.ok) {
            lines[i].textContent = '⚠️ ' + jobs[i].label;
            return finish(false, { kind, target, done, total: jobs.length, error: res?.error });
        }
        lines[i].textContent = '✅ ' + jobs[i].label; done++; paint(done, false);
    }
    if (cancelled && done < jobs.length) return finish(false, { kind, target, done, total: jobs.length, error: T('Cancelled') });
    StorageManager.setActiveDevice(kind, device.id);
    finish(true, { kind, target, done, total: jobs.length });
}

function finish(ok, r) {
    delete sheet.dataset.busy;
    const body = shell('', '');
    const box = el('div', 'sendsheet-done');
    box.append(el('div', 'sendsheet-done-ic', ok ? '✅' : '⚠️'),
        el('div', 'sendsheet-title', ok
            ? (r.kind === 'kindle' ? T('Sent to Kindle') : T('Sent to {name}', { name: r.target }))
            : T('Not everything was sent')),
        el('div', 'sendsheet-sub', ok
            ? (r.kind === 'kindle' ? T('It will show up on your Kindle in a few minutes.') : TN(r.done, '{n} file sent', '{n} files sent'))
            : T('{done} of {total} sent. {error}', { done: r.done, total: r.total, error: r.error || '' })));
    body.append(box);
    if (ok) body.append(btn(T('Done'), true, () => { closeSheet(); setActive(false); }));
    else body.append(btn(T('Try again'), true, () => (r.kind === 'kindle' ? viewKindle() : viewLocalSend())), btn(T('Close'), false, closeSheet));
}

/**
 * deps: { deliverKindle(article, device) → {ok,error?}, deliverLocalSend(article, device) → {ok,error?},
 *         openSettings(section, focusId), toast(msg) }
 */
export function initSelection(d) {
    deps = d;
    const b = document.getElementById('selectModeBtn');
    const label = () => { const lab = b && b.querySelector('.btn-label'); if (lab) lab.textContent = T('Select'); if (b) { b.title = T('Select summaries to send'); b.setAttribute('aria-label', T('Select summaries to send')); } };
    if (b) { label(); b.addEventListener('click', () => setActive(!active)); }
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (sheet && !sheet.dataset.busy) closeSheet(); else if (active && !sheet) setActive(false);
    });
    document.addEventListener('aish:translationsApplied', () => {
        label();
        if (bar) { bar.remove(); bar = null; buildBar(); paintBar(); }
    });
}
