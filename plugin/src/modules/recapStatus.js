/**
 * recapStatus.js — live status card for recap generation (same idea as the summarize-mode status bubble).
 * Stages: collect → send → wait (elapsed timer) → write/parse → done. Driven by feedAi's `onStage` callback.
 */
import { el } from './dom.js';
import { T } from './feedI18n.js';
import StorageManager from './storageManager.js';

export async function activeModelLabel() {
    try {
        const s = await chrome.storage.sync.get(['connectionMode', 'activeService']);
        if (s.connectionMode !== 'local') return T('AISH cloud');
        const m = await StorageManager.getActiveModel(s.activeService);
        return `💻 ${m && m.id ? m.id : s.activeService}`;
    } catch (e) { return ''; }
}

const STAGES = ['prepare', 'send', 'wait', 'parse'];

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
    let model = '', cur = '';
    const paint = () => {
        const secs = Math.floor((Date.now() - t0) / 1000);
        const at = STAGES.indexOf(cur);
        STAGES.forEach((k, i) => {
            const r = rows[k];
            r.className = 'recap-step' + (i < at ? ' done' : i === at ? ' active' : '');
        });
        rows.wait.textContent = labels.wait + (cur === 'wait' ? ` · ${secs}s` : '');
        rows.send.textContent = labels.send + (model ? ` · ${model}` : '');
        if (secs >= 25 && cur === 'wait') meta.textContent = (detail ? detail + ' ' : '') + T('No time limit — slow local models can take minutes. Cancel if nothing seems to happen.');
    };
    const timer = setInterval(paint, 1000);
    activeModelLabel().then(m => { model = m; paint(); });
    const onStage = (s) => { if (STAGES.includes(s)) { cur = s; paint(); } };
    onStage('prepare');
    return { node, onStage, stop: () => clearInterval(timer), signal: ac.signal };
}
