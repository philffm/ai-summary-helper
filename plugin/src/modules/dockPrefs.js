// dockPrefs.js — the bottom dock: order of the tabs and which are shown (the AISH-006.3 pattern applied to the dock).
// Preference `dockTabs` in chrome.storage.sync: { order: [all tab ids], hidden: [ids] }. Summarize ('main') is always shown
// (it is the start screen), and at least two tabs stay visible. The screen slide follows the dock order.
import { T } from './feedI18n.js';
import { makeReorderable, reorderGrip } from './reorder.js';

export const DOCK_PREF = 'dockTabs';
export const DOCK_TABS = ['feeds', 'main', 'history', 'notes'];
const LOCKED = 'main';

/** Any stored value → a valid { order, hidden }. New tabs (added in a later version) join at the end, visible. */
export function normalizeDock(v) {
    const order = (v && Array.isArray(v.order) ? v.order : []).filter((x, i, a) => DOCK_TABS.includes(x) && a.indexOf(x) === i);
    DOCK_TABS.forEach(x => { if (!order.includes(x)) order.push(x); });
    let hidden = (v && Array.isArray(v.hidden) ? v.hidden : []).filter((x, i, a) => DOCK_TABS.includes(x) && x !== LOCKED && a.indexOf(x) === i);
    if (DOCK_TABS.length - hidden.length < 2) hidden = [];
    return { order, hidden };
}
export const visibleTabs = (d) => d.order.filter(x => !d.hidden.includes(x));

let current = normalizeDock(null), uiRef = null;
const navItem = (id) => document.querySelector(`#bottomNav .nav-item[data-screen="${id}"]`);
const tabName = (id) => { const n = navItem(id); const l = n && n.querySelector('.nav-label'); return (l && l.textContent.trim()) || id; };

/** Puts the nav buttons in order, hides the hidden ones, and tells the screen slider the new order. */
export function applyDock(d) {
    current = normalizeDock(d);
    const nav = document.getElementById('bottomNav');
    if (nav) current.order.forEach(id => { const b = navItem(id); if (b) { b.hidden = current.hidden.includes(id); nav.append(b); } });
    if (nav) nav.dataset.tabs = String(visibleTabs(current).length);
    if (uiRef && typeof uiRef.setScreenOrder === 'function') uiRef.setScreenOrder([...visibleTabs(current), ...current.hidden, 'settings']);
    paintEditor();
}

async function save(d) {
    applyDock(d);
    try { await chrome.storage.sync.set({ [DOCK_PREF]: current }); } catch (_) { /* this session still follows */ }
}

export async function initDock(ui) {
    uiRef = ui || uiRef;
    let stored = null;
    try { stored = (await chrome.storage.sync.get(DOCK_PREF))[DOCK_PREF]; } catch (_) { /* defaults */ }
    applyDock(stored);
    try {
        chrome.storage.onChanged.addListener((ch, area) => { if (area === 'sync' && ch[DOCK_PREF]) applyDock(ch[DOCK_PREF].newValue); });
    } catch (_) { /* no storage events (tests) */ }
}

/** Settings › Appearance: one row per tab — ⋮⋮ to reorder, a switch to show or hide it. */
function paintEditor() {
    const host = document.getElementById('dockEditor');
    if (!host) return;
    host.textContent = '';
    const head = document.createElement('div'); head.className = 'dock-ed-head';
    const h = document.createElement('span'); h.className = 'setting-label-inline'; h.id = 'dockEditorLabel'; h.textContent = T('Bottom dock');
    head.append(h);
    const list = document.createElement('div'); list.className = 'dock-ed-list'; list.setAttribute('role', 'list'); list.setAttribute('aria-labelledby', 'dockEditorLabel');
    const visible = visibleTabs(current).length;
    current.order.forEach(id => {
        const name = tabName(id), on = !current.hidden.includes(id);
        const row = document.createElement('div'); row.className = 'dock-ed-row' + (on ? '' : ' is-off'); row.setAttribute('role', 'listitem');
        row.dataset.reorderId = id; row.dataset.reorderName = name;
        const ic = document.createElement('span'); ic.className = 'dock-ed-ic'; ic.setAttribute('aria-hidden', 'true');
        const src = navItem(id) && navItem(id).querySelector('.nav-icon'); if (src) ic.append(src.cloneNode(true));
        const lab = document.createElement('span'); lab.className = 'dock-ed-name'; lab.textContent = name;
        const sw = document.createElement('label'); sw.className = 'switch';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = on;
        cb.setAttribute('aria-label', T('Show “{name}” in the dock', { name }));
        const locked = id === LOCKED || (on && visible <= 2);
        cb.disabled = locked;
        if (locked) { row.title = id === LOCKED ? T('Summarize is always in the dock.') : T('At least two tabs stay in the dock.'); }
        cb.addEventListener('change', () => {
            const hidden = cb.checked ? current.hidden.filter(x => x !== id) : [...current.hidden, id];
            save({ order: current.order, hidden }).then(() => { const again = document.querySelector(`#dockEditor [data-reorder-id="${id}"] input`); if (again) again.focus(); });
        });
        const slider = document.createElement('span'); slider.className = 'slider-toggle';
        sw.append(cb, slider);
        row.append(reorderGrip(name), ic, lab, sw);
        list.append(row);
    });
    const hint = document.createElement('p'); hint.className = 'a11y-hint';
    hint.textContent = T('Drag ⋮⋮ to change the order. Screens slide in the same order.');
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'button-secondary btn-sm dock-ed-reset'; reset.textContent = T('Reset dock');
    reset.disabled = current.order.join() === DOCK_TABS.join() && !current.hidden.length;
    reset.addEventListener('click', () => save(null));
    host.append(head, list, hint, reset);
    makeReorderable(list, { scope: 'dock-editor', onMove: async (id, i) => {
        const order = current.order.filter(x => x !== id); order.splice(i, 0, id);
        await save({ order, hidden: current.hidden });
    } });
}
