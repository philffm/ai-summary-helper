// sendSheet.js
// History multi-select + "Send" sheet: pick several summarized articles and send them to a Kindle or a
// LocalSend receiver, either as ONE digest (summaries bundled via buildMagazineArticle) or as separate files.
// Flow: ☑️ Select → tap cards → bar "Send n" → sheet (format, target) → confirm → progress → done.
// Delivery itself is injected (deliverKindle / deliverLocalSend from articleManager), so this module
// has no knowledge of the Kindle API or the LocalSend protocol.
import StorageManager from './storageManager.js';
import { buildMagazineArticle } from './digestBuilder.js';
import { T, TN } from './feedI18n.js';
import { generateDigestIntro } from './feedAi.js';

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
    const more = el('button', 'sel-more button-secondary', '⋯');
    more.type = 'button'; more.title = T('Mark as…'); more.setAttribute('aria-label', T('Mark as…'));
    more.addEventListener('click', () => { if (sel.size) openSheet(viewMark); });
    const send = el('button', 'sel-send button-primary');
    send.type = 'button';
    send.addEventListener('click', () => { if (sel.size) openSheet(); });
    bar.append(x, info, all, more, send);
    (screenEl() || document.body).append(bar);
}

function paintBar() {
    if (!bar) return;
    const n = sel.size;
    bar.querySelector('.sel-count').textContent = n ? T('{n} selected', { n }) : T('Select summaries');
    const send = bar.querySelector('.sel-send');
    send.textContent = n ? T('📤 Send {n}', { n }) : T('📤 Send');
    send.disabled = n === 0;
    bar.querySelector('.sel-more').disabled = n === 0;
}

// ───────────────────────────── sheet ─────────────────────────────

const state = { format: 'digest', include: 'summary', intro: 'off', introStyle: 'briefing' };

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

function segmented(body, key, options, onChange) {
    const seg = el('div', 'sendsheet-seg');
    seg.setAttribute('role', 'radiogroup');
    options.forEach(([v, label]) => {
        const b = el('button', 'sendsheet-seg-btn' + (state[key] === v ? ' on' : ''), label);
        b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(state[key] === v));
        b.addEventListener('click', () => { state[key] = v; seg.querySelectorAll('.sendsheet-seg-btn').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); }); if (onChange) onChange(); });
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

function openSheet(view) {
    closeSheet();
    sheet = el('div', 'sendsheet');
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true');
    const scrim = el('div', 'sendsheet-scrim');
    scrim.addEventListener('click', () => { if (!sheet.dataset.busy) closeSheet(); });
    const panel = el('div', 'sendsheet-panel');
    panel.append(el('div', 'sendsheet-grab'), el('div', 'sendsheet-body'));
    sheet.append(scrim, panel);
    document.body.append(sheet);
    (view || viewChoose)();
}

async function viewChoose() {
    const list = selected();
    const n = list.length;
    const names = list.slice(0, 2).map(a => a.title || T('Untitled')).join(', ') + (n > 2 ? ' ' + T('and {n} more', { n: n - 2 }) : '');
    const body = shell(TN(n, 'Send {n} summary', 'Send {n} summaries'), names);
    const intro = introBlock();
    if (n > 1) segmented(body, 'format', [['digest', T('One digest')], ['files', T('Separate files')]], () => intro.paint()); else state.format = 'files';
    segmented(body, 'include', [['summary', T('Summary only')], ['full', T('Summary + full article')]]);
    body.append(intro);
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

/** Optional AI intro for a digest: toggle (A) and, when on, the style chips (C). Only for "One digest". */
function introBlock() {
    const wrap = el('div', 'sendsheet-intro');
    const paint = () => {
        wrap.textContent = '';
        if (state.format !== 'digest' || selected().length < 2) return;
        const on = state.intro === 'on';
        const tg = el('button', 'sendsheet-row sendsheet-toggle' + (on ? ' on' : ''));
        tg.type = 'button'; tg.setAttribute('role', 'switch'); tg.setAttribute('aria-checked', String(on));
        const tx = el('span', 'sendsheet-row-tx');
        tx.append(el('span', 'sendsheet-row-t', T('✨ Write a short intro')),
            el('span', 'sendsheet-row-s sendsheet-wrap', on ? T('Uses your AI model · one extra call · in your app language') : T('AI adds 2–3 sentences on top of the digest')));
        const sw = el('span', 'sendsheet-switch'); sw.append(el('span', 'sendsheet-knob'));
        tg.append(tx, sw);
        tg.addEventListener('click', () => { state.intro = on ? 'off' : 'on'; paint(); });
        wrap.append(tg);
        if (on) {
            const chips = el('div', 'sendsheet-seg'); chips.setAttribute('role', 'radiogroup');
            [['short', T('Short')], ['briefing', T('Briefing')], ['personal', T('Personal')]].forEach(([v, label]) => {
                const b = el('button', 'sendsheet-seg-btn' + (state.introStyle === v ? ' on' : ''), label);
                b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(state.introStyle === v));
                b.addEventListener('click', () => { state.introStyle = v; paint(); });
                chips.append(b);
            });
            const hint = { short: T('One sentence'), briefing: T('2–3 sentences'), personal: T('A friendly note to yourself') }[state.introStyle];
            wrap.append(chips, el('div', 'sendsheet-row-s sendsheet-hint', hint));
        }
    };
    wrap.paint = paint;
    paint();
    return wrap;
}

/** Small toast with an Undo action (used after archiving). */
export function undoToast(msg, onUndo) {
    document.querySelectorAll('.undo-toast').forEach(n => n.remove());
    const t = el('div', 'undo-toast');
    t.append(el('span', null, msg));
    const u = el('button', 'undo-toast-btn', T('Undo'));
    u.type = 'button';
    u.addEventListener('click', () => { t.remove(); onUndo(); });
    t.append(u);
    document.body.append(t);
    setTimeout(() => t.remove(), 7000);
}

/** Bulk status change for the selection: Read / Unread / Sent / Archived (or Restore in the Archive tab). */
function viewMark() {
    const list = selected();
    const ids = list.map(a => a.id);
    const body = shell(TN(list.length, 'Mark {n} summary as…', 'Mark {n} summaries as…'), T('Also automatic: opening marks Read, sending marks Sent'));
    const inArchive = deps.currentTab() === 'archive';
    const opts = [
        ['👀', T('Read'), { read: true }],
        ['🆕', T('Unread'), { read: false }],
        ['✅', T('Sent'), { sent: { kind: 'manual', label: '' } }],
        inArchive ? ['↩', T('Restore to Inbox'), { archived: false }] : ['🗄️', T('Archived'), { archived: true }],
    ];
    opts.forEach(([ic, label, patch]) => body.append(row(ic, label, '', async () => {
        await deps.applyStatus(ids, patch);
        closeSheet(); setActive(false);
        if (patch.archived === true) undoToast(TN(ids.length, '🗄️ {n} archived', '🗄️ {n} archived'), () => deps.applyStatus(ids, { archived: false }));
    }, '')));
    body.append(btn(T('Cancel'), false, closeSheet));
}

/** Jobs to run: one digest, or one file per article. */
async function buildJobs(intro = '') {
    const list = selected();
    const full = state.include === 'full';
    const load = async (a) => {
        if (!full) return { ...a, content: '' };            // index entries carry the summary only
        try { const f = await StorageManager.getArticleFull(a.id); if (f) return { ...a, ...f }; } catch (_) { /* summary only */ }
        return { ...a, content: '' };
    };
    const items = [];
    for (const a of list) items.push(await load(a));
    if (state.format === 'digest' && list.length > 1) {
        return [{ label: T('Digest of {n} summaries', { n: list.length }), ids: list.map(a => a.id), article: buildMagazineArticle(items, { includeContent: full, intro }) }];
    }
    return items.map(a => ({ label: a.title || T('Untitled'), ids: [a.id], article: a }));
}

/** Everything that really went out is marked Sent (with target and date) — also on a partial failure. */
async function markSent(kind, device, ids) {
    if (!ids.length) return;
    try { await deps.applyStatus(ids, { sent: { kind, label: device.label || '' } }); } catch (_) { /* status is a nicety */ }
}

async function run(kind, device) {
    sheet.dataset.busy = '1';
    const target = kind === 'kindle' ? (device.label || 'Kindle') : (device.label || device.addresses?.[0] || T('Device'));
    const body = shell(kind === 'kindle' ? T('Sending to Kindle…') : T('Sending to {name}…', { name: target }),
        kind === 'kindle' ? T('Please keep this window open') : T('Waiting for the other device to accept'));
    const track = el('div', 'sendsheet-track'); const fillEl = el('div', 'sendsheet-fill'); track.append(fillEl);
    const steps = el('div', 'sendsheet-steps');
    body.append(track, steps);
    let intro = '';
    let introFailed = false;
    const wantIntro = state.intro === 'on' && state.format === 'digest' && selected().length > 1;
    if (wantIntro) {
        const il = el('div', 'sendsheet-step', T('✨ Writing intro…'));
        steps.append(il);
        try { intro = await generateDigestIntro(selected(), state.introStyle); il.textContent = T('✨ Intro written'); }
        catch (e) { introFailed = true; il.textContent = T('⚠️ Intro skipped — the digest goes out without it'); }
        if (!sheet) return;
    }
    const jobs = await buildJobs(intro);
    const lines = jobs.map(j => { const d = el('div', 'sendsheet-step', '○ ' + j.label); steps.append(d); return d; });
    let cancelled = false;
    body.append(btn(T('Cancel'), false, () => { cancelled = true; }));
    const paint = (done, cur) => { fillEl.style.width = Math.max(4, Math.round(((done + (cur ? 0.5 : 0)) / jobs.length) * 100)) + '%'; };
    paint(0, true);
    let done = 0;
    const deliveredIds = [];
    for (let i = 0; i < jobs.length; i++) {
        if (cancelled) break;
        lines[i].textContent = '⏳ ' + jobs[i].label; paint(done, true);
        let res;
        try { res = kind === 'kindle' ? await deps.deliverKindle(jobs[i].article, device) : await deps.deliverLocalSend(jobs[i].article, device); }
        catch (e) { res = { ok: false, error: e?.message || String(e) }; }
        if (!sheet) return;
        if (!res || !res.ok) {
            lines[i].textContent = '⚠️ ' + jobs[i].label;
            await markSent(kind, device, deliveredIds);
            return finish(false, { kind, target, done, total: jobs.length, error: res?.error });
        }
        lines[i].textContent = '✅ ' + jobs[i].label; done++; paint(done, false);
        deliveredIds.push(...jobs[i].ids);
    }
    await markSent(kind, device, deliveredIds);
    if (cancelled && done < jobs.length) return finish(false, { kind, target, done, total: jobs.length, error: T('Cancelled') });
    StorageManager.setActiveDevice(kind, device.id);
    finish(true, { kind, target, done, total: jobs.length, ids: deliveredIds, introFailed });
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
    if (ok && r.introFailed) body.append(el('div', 'sendsheet-note', T('⚠️ Intro skipped — the digest goes out without it')));
    if (ok) {
        const note = el('div', 'sendsheet-note', T('Status updated automatically:') + ' ' + (r.kind === 'kindle' ? T('📚 Sent to Kindle') : T('📡 Sent via LocalSend')));
        body.append(note);
        let archive = false;
        const tg = el('button', 'sendsheet-row sendsheet-toggle');
        tg.type = 'button'; tg.setAttribute('role', 'switch'); tg.setAttribute('aria-checked', 'false');
        const tx = el('span', 'sendsheet-row-tx');
        tx.append(el('span', 'sendsheet-row-t', T('🗄️ Archive them too')), el('span', 'sendsheet-row-s', T('Keep them in your inbox as “Sent”')));
        const sw = el('span', 'sendsheet-switch'); sw.append(el('span', 'sendsheet-knob'));
        tg.append(tx, sw);
        tg.addEventListener('click', () => {
            archive = !archive; tg.setAttribute('aria-checked', String(archive)); tg.classList.toggle('on', archive);
            tx.lastChild.textContent = archive ? T('Moves them to Archive — find them there anytime') : T('Keep them in your inbox as “Sent”');
        });
        body.append(tg);
        body.append(btn(T('Done'), true, async () => {
            const ids = r.ids || [];
            closeSheet(); setActive(false);
            if (archive && ids.length) {
                await deps.applyStatus(ids, { archived: true });
                undoToast(TN(ids.length, '🗄️ {n} archived', '🗄️ {n} archived'), () => deps.applyStatus(ids, { archived: false }));
            }
        }));
    }
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
