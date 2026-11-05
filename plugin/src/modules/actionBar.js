// actionBar.js — the article toolbar (AISH-006.3) as a building block for other views (collections, graph topics, …).
// A joined bar of actions; what does not fit or is not chosen sits in ⋯; “Customize toolbar…” in ⋯ turns the bar into
// its own editor (drag ⋮⋮ / Alt+←→ to reorder, Delete or drag to the tray to move an action into ⋯, click a tray chip to
// add it). Same classes as the article bar (.detail-toolbar, .detail-tool, .toolbar-tray), so it looks and works the same.
//
//   const bar = createActionBar({ pref: 'collectionToolbarItems', label: T('Collection actions'), catalog, defaults,
//                                 menuOnly: () => [{ icon, label, run, danger?, sep? }] });   // e.g. Rename, Delete: never in the bar
//   host.append(bar.el); bar.refresh();
import { T } from './feedI18n.js';
import { iconEl } from './icons.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const prefs = new Map();   // pref key → saved order (shared by every bar of that kind in this page)

export function normalizeBar(v, catalog, defaults) {
    const out = (Array.isArray(v) ? v : defaults).filter((id, i, a) => catalog[id] && a.indexOf(id) === i);
    return out;   // an empty bar is allowed: everything lives in ⋯
}

export async function loadBarPref(pref, catalog, defaults) {
    if (prefs.has(pref)) return prefs.get(pref);
    let v = null;
    try { v = (await chrome.storage.sync.get(pref))[pref]; } catch (_) { /* defaults */ }
    const items = Array.isArray(v) ? normalizeBar(v, catalog, defaults) : defaults.slice();
    prefs.set(pref, items);
    return items;
}

/**
 * catalog: id → { icon, label(), short?(), run(button), available?(), cls? }. defaults: ids in the bar at first.
 * menuOnly(): items always in ⋯ after the catalog's leftovers (destructive and rare actions).
 */
export function createActionBar({ pref, label, catalog, defaults, menuOnly = () => [] }) {
    const holder = el('div', 'detail-toolbar action-bar');
    holder.setAttribute('role', 'toolbar'); holder.setAttribute('aria-label', label);
    holder.dataset.bar = pref;
    const wrap = el('div', 'action-bar-wrap'); wrap.append(holder);
    let items = prefs.get(pref) || defaults.slice();
    let editing = false;
    const avail = (id) => catalog[id] && (!catalog[id].available || catalog[id].available());

    const save = (next) => {
        items = normalizeBar(next, catalog, defaults); prefs.set(pref, items);
        try { chrome.storage.sync.set({ [pref]: items }); } catch (_) { /* this page still follows */ }
        paint();
    };
    const move = (id, index) => {   // index < 0 → into ⋯
        const next = items.filter(x => x !== id);
        if (index >= 0) next.splice(Math.min(index, next.length), 0, id);
        save(next);
        const again = holder.querySelector(`[data-tool-id="${id}"]`) || wrap.querySelector(`.toolbar-chip[data-tool-id="${id}"]`);
        if (again) again.focus();
    };

    const slots = (n) => {
        const w = (wrap.getBoundingClientRect().width || 400) - 52;
        const labels = n > 0 && w / Math.min(n, 3) >= 104;
        return { labels, count: editing ? n : Math.max(Math.min(1, n), Math.min(n, Math.floor(w / (labels ? 104 : 48)))) };
    };

    const openMenu = async (btn, hiddenIds) => {
        const { openItems } = await import('./cardMenu.js');
        const list = hiddenIds.map((id, i) => ({ icon: catalog[id].icon, label: catalog[id].label(), run: () => catalog[id].run() }));
        list.push({ icon: 'sliders-horizontal', label: T('Customize toolbar…'), run: () => { editing = true; paint(); const f = holder.querySelector('.is-editable'); if (f) f.focus(); }, sep: hiddenIds.length > 0 });
        menuOnly().forEach((it, i) => list.push({ ...it, sep: it.sep || i === 0 }));
        openItems(btn, list);
    };

    function paint() {
        const ids = items.filter(avail);
        const { labels, count } = slots(ids.length);
        holder.replaceChildren();
        holder.classList.toggle('with-labels', labels || editing);
        holder.classList.toggle('is-editing', editing);
        ids.slice(0, count).forEach(id => {
            const def = catalog[id];
            const b = el('button', 'detail-tool' + (def.cls ? ' ' + def.cls : '')); b.type = 'button'; b.dataset.toolId = id;
            b.title = def.label(); b.setAttribute('aria-label', def.label());
            b.append(iconEl(def.icon), el('span', 'act-label', (def.short || def.label)()));
            if (editing) {
                b.classList.add('is-editable'); b.draggable = true;
                const g = el('span', 'tool-grip', '⋮⋮'); g.setAttribute('aria-hidden', 'true'); b.prepend(g);
                b.setAttribute('aria-roledescription', T('reorder handle'));
                b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; b.classList.add('is-dragging'); });
                b.addEventListener('dragend', () => b.classList.remove('is-dragging'));
                b.addEventListener('keydown', (e) => {
                    const i = items.indexOf(id);
                    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); e.stopPropagation(); move(id, Math.max(0, i + (e.key === 'ArrowRight' ? 1 : -1))); }
                    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); move(id, -1); }
                });
            } else b.addEventListener('click', () => def.run(b));
            holder.append(b);
        });
        const more = el('button', 'card-menu-btn'); more.type = 'button'; more.append(iconEl('ellipsis'));
        more.title = T('More actions'); more.setAttribute('aria-label', T('More actions'));
        more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
        more.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (more.getAttribute('aria-expanded') === 'true') { (await import('./cardMenu.js')).closeMenu(); return; }
            openMenu(more, Object.keys(catalog).filter(id => avail(id) && !ids.slice(0, count).includes(id)));
        });
        if (!editing) holder.append(more);
        paintTray(ids);
    }

    function paintTray(ids) {
        let tray = wrap.querySelector('.toolbar-tray');
        if (!editing) { if (tray) tray.remove(); return; }
        if (!tray) {
            tray = el('div', 'toolbar-tray'); tray.setAttribute('role', 'group'); wrap.append(tray);
            tray.addEventListener('dragover', (e) => { e.preventDefault(); tray.classList.add('is-drop'); });
            tray.addEventListener('dragleave', (e) => { if (!tray.contains(e.relatedTarget)) tray.classList.remove('is-drop'); });
            tray.addEventListener('drop', (e) => { e.preventDefault(); tray.classList.remove('is-drop'); const id = e.dataTransfer.getData('text/plain'); if (catalog[id]) move(id, -1); });
        }
        tray.setAttribute('aria-label', T('Customize toolbar…'));
        tray.replaceChildren();
        tray.append(el('div', 'toolbar-tray-t', T('Other actions: drag into the bar')));
        const chips = el('div', 'toolbar-tray-chips'); tray.append(chips);
        Object.keys(catalog).filter(id => avail(id) && !ids.includes(id)).forEach(id => {
            const def = catalog[id];
            const c = el('button', 'toolbar-chip'); c.type = 'button'; c.draggable = true; c.dataset.toolId = id; c.title = def.label();
            const g = el('span', 'tool-grip', '⋮⋮'); g.setAttribute('aria-hidden', 'true');
            c.append(g, iconEl(def.icon), el('span', '', (def.short || def.label)()));
            c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; c.classList.add('is-dragging'); });
            c.addEventListener('dragend', () => c.classList.remove('is-dragging'));
            c.addEventListener('click', () => move(id, items.length));
            chips.append(c);
        });
        if (!chips.children.length) chips.append(el('span', 'toolbar-tray-empty', T('Everything is in the bar.')));
        const row = el('div', 'toolbar-tray-row');
        const reset = el('button', 'button-secondary btn-sm', T('Reset toolbar')); reset.type = 'button';
        reset.addEventListener('click', () => save(defaults.slice()));
        const done = el('button', 'button-primary btn-sm', T('Done')); done.type = 'button';
        done.addEventListener('click', () => { editing = false; paint(); const m = holder.querySelector('.card-menu-btn'); if (m) m.focus(); });
        row.append(reset, el('span', 'source-sp'), done);
        tray.append(row);
    }

    // drop into the bar: position from the pointer
    holder.addEventListener('dragover', (e) => { if (!editing) return; e.preventDefault(); holder.classList.add('is-drop'); });
    holder.addEventListener('dragleave', (e) => { if (!holder.contains(e.relatedTarget)) holder.classList.remove('is-drop'); });
    holder.addEventListener('drop', (e) => {
        if (!editing) return; e.preventDefault(); holder.classList.remove('is-drop');
        const id = e.dataTransfer.getData('text/plain'); if (!catalog[id]) return;
        const tools = [...holder.querySelectorAll('.is-editable')].filter(t => t.dataset.toolId !== id);
        let i = 0; for (const t of tools) { const r = t.getBoundingClientRect(); if (e.clientX > r.left + r.width / 2) i++; else break; }
        move(id, i);
    });
    // arrow keys move along the bar (one tab stop), like the article bar
    holder.addEventListener('keydown', (e) => {
        if (e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
        const l = [...holder.querySelectorAll('button')]; const i = l.indexOf(document.activeElement); if (i < 0) return;
        e.preventDefault(); l[(i + (e.key === 'ArrowRight' ? 1 : l.length - 1)) % l.length].focus();
    });
    if (typeof ResizeObserver !== 'undefined') { let w = 0; new ResizeObserver(() => { const nw = Math.round(wrap.getBoundingClientRect().width); if (nw !== w && wrap.isConnected) { w = nw; paint(); } }).observe(wrap); }

    paint();   // at once (defaults or what this page already loaded); refresh() applies the saved order
    return {
        el: wrap,
        refresh: async () => { items = await loadBarPref(pref, catalog, defaults); paint(); },
        edit: (on = true) => { editing = on; paint(); },
    };
}
