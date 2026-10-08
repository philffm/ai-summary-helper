/**
 * recapStatus.js — live status card for recap generation (same idea as the summarize-mode status bubble).
 * Stages: collect → send → wait (elapsed timer) → write/parse → done. Driven by feedAi's `onStage` callback.
 */
import { modelEmoji } from './modelBadge.js';
import { el } from './dom.js';
import { T } from './feedI18n.js';
import StorageManager from './storageManager.js';

export async function activeModelLabel() {
    try {
        const s = await chrome.storage.sync.get(['connectionMode', 'activeService']);
        if (s.connectionMode !== 'local') return T('AISH cloud');
        const m = await StorageManager.getActiveModel(s.activeService);
        return `${modelEmoji({ connectionMode: 'local', service: s.activeService })} ${m && m.id ? m.id : s.activeService}`;
    } catch (e) { return ''; }
}

const STAGES = ['prepare', 'send', 'wait', 'write', 'parse'];

/**
 * @param {{title:string, detail?:string, items?:number}} o  title = headline ("✨ Updating recap…"), detail = what is sent
 * @returns {{node, onStage, stop, signal}}  signal aborts when the user presses Cancel; onCancel runs afterwards
 */
export function createRecapStatus({ title, detail = '', onCancel }) {
    const node = el('div', 'recap-status');
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    const head = el('p', 'feed-recap-loading', title);
    const list = el('ul', 'recap-steps');
    const rows = {};
    const labels = {
        prepare: T('Collected the items'),
        send: T('Sent to your AI connection'),
        wait: T('Waiting for the model'),
        write: T('Model is writing'),
        parse: T('Reading the answer'),
    };
    STAGES.forEach(k => { rows[k] = el('li', 'recap-step', labels[k]); list.append(rows[k]); });
    const meta = el('p', 'feed-muted recap-meta', detail);
    const ac = new AbortController();
    const cancel = el('button', 'btn-sm recap-cancel', T('Cancel'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => { cancel.disabled = true; ac.abort(); clearInterval(timer); if (onCancel) onCancel(); });
    node.append(head, list, meta, cancel);

    const t0 = Date.now();
    let prog = null, lastMove = Date.now();
    let model = '', cur = '';
    const paint = () => {
        const secs = Math.floor((Date.now() - t0) / 1000);
        const at = STAGES.indexOf(cur);
        STAGES.forEach((k, i) => {
            const r = rows[k];
            r.className = 'recap-step' + (i < at ? ' done' : i === at ? ' active' : '');
        });
        rows.wait.textContent = labels.wait + (cur === 'wait' ? ` · ${secs}s` : '');
        if (prog) {
            const bits = [];
            if (prog.chars) bits.push(T('{n} characters', { n: prog.chars }));
            if (prog.think) bits.push(T('thinking: {n} characters', { n: prog.think }));
            rows.write.textContent = (prog.think && !prog.chars ? T('Model is thinking') : labels.write) + (bits.length ? ' · ' + bits.join(' · ') : '') + (cur === 'write' && prog.tail ? ` — “…${prog.tail.replace(/\s+/g, ' ')}”` : '');
        }
        const idle = Math.floor((Date.now() - lastMove) / 1000);
        rows.send.textContent = labels.send + (model ? ` · ${model}` : '');
        if ((cur === 'wait' || cur === 'write') && idle >= 20) meta.textContent = (detail ? detail + ' ' : '') + T('Nothing received for {s}s. There is no time limit — Cancel if it looks stuck.', { s: idle });
        else meta.textContent = detail;
    };
    const timer = setInterval(paint, 1000);
    activeModelLabel().then(m => { model = m; paint(); });
    const onProgress = (m) => { if (m.chars !== prog?.chars || m.think !== prog?.think || m.phase !== prog?.phase) lastMove = Date.now(); prog = m; paint(); };
    const onStage = (s) => { if (STAGES.includes(s) && STAGES.indexOf(s) >= STAGES.indexOf(cur)) { cur = s; paint(); } };
    onStage('prepare');
    return { node, onStage, onProgress, stop: () => clearInterval(timer), signal: ac.signal };
}
