// confirmSheet.js — replaces window.confirm() (AISH-032 · A4, used app-wide): a bottom sheet that says what is deleted
// and what stays, focus on Cancel, Escape/scrim cancel. Plus undoToast(): the delete happens only after the Undo window
// (6 s), so “Undo” never has to rebuild data. Everything still waiting is committed when the page goes away.
import { T } from './feedI18n.js';
import { trapFocus } from './sheet.js';
import UIManager from './uiManager.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

/**
 * Resolves true (confirmed) or false. `text`: what happens; `keeps`: what stays (shown with ✓); `danger`: red button.
 * `undo: true` adds “You can undo this for a few seconds.” so people know the toast is coming.
 */
export function confirmSheet({ title, text = '', keeps = '', confirmLabel = T('Delete'), cancelLabel = T('Cancel'), danger = true, undo = false } = {}) {
    return new Promise((resolve) => {
        const sheet = el('div', 'sendsheet confirm-sheet');
        const scrim = el('div', 'sendsheet-scrim');
        const panel = el('div', 'sendsheet-panel');
        const body = el('div', 'sendsheet-body');
        panel.append(el('div', 'sendsheet-grab'), body);
        sheet.append(scrim, panel);
        const head = el('div', 'sendsheet-head');
        const h = el('div', 'sendsheet-title', title); h.id = 'confirmSheetTitle';
        head.append(h);
        body.append(head);
        if (text) body.append(el('p', 'confirm-text', text));
        if (keeps) { const k = el('p', 'confirm-keeps'); const g = el('span', 'confirm-keeps-ic', '✓'); g.setAttribute('aria-hidden', 'true'); k.append(g, el('span', '', keeps)); body.append(k); }
        if (undo) body.append(el('p', 'confirm-undo', T('You can undo this for a few seconds.')));
        const actions = el('div', 'coll-actions coll-actions--split');
        const cancel = el('button', 'button-secondary', cancelLabel); cancel.type = 'button';
        const ok = el('button', danger ? 'button-danger' : 'button-primary', confirmLabel); ok.type = 'button';
        actions.append(cancel, ok);
        body.append(actions);
        document.body.append(sheet);
        let trap = null, done = false;
        const finish = (v) => { if (done) return; done = true; if (trap) trap.release(); sheet.remove(); resolve(v); };
        trap = trapFocus(panel, { label: title, onEscape: () => finish(false) });
        panel.setAttribute('aria-labelledby', 'confirmSheetTitle');
        scrim.addEventListener('click', () => finish(false));
        cancel.addEventListener('click', () => finish(false));
        ok.addEventListener('click', () => finish(true));
        setTimeout(() => cancel.focus(), 0);   // the safe choice has focus
    });
}

export const UNDO_MS = 6000;
const pending = new Set();

/**
 * Shows “message · Undo”. `commit()` runs when the toast runs out (or the page goes away); `undo()` runs instead when
 * Undo is pressed. The caller hides the item at once and only deletes in commit().
 */
export function undoToast(message, { commit, undo = () => {}, ms = UNDO_MS } = {}) {
    let settled = false;
    const job = { run: () => { if (settled) return Promise.resolve(); settled = true; clearTimeout(timer); pending.delete(job); return Promise.resolve().then(commit).catch(() => {}); } };
    const timer = setTimeout(job.run, ms);
    pending.add(job);
    UIManager.prototype.showToast.call(null, message, ms, { label: T('Undo'), onClick: () => {
        if (settled) return; settled = true; clearTimeout(timer); pending.delete(job);
        Promise.resolve().then(undo).catch(() => {});
    } });
    return job;
}

/** Commits every delete still waiting for its Undo window (page hide; tests). */
export function flushUndo() { return Promise.all([...pending].map(j => j.run())); }
if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('pagehide', () => { flushUndo(); });
