// reorder.js — one way to change the order of things (the AISH-006.3 pattern, beyond the article toolbar):
// every item has a ⋮⋮ grip. Drag the grip (mouse, pen and touch: pointer events, not HTML drag and drop), or focus it and
// press ↑/↓ (←/→ in a horizontal bar); Alt+↑/↓ also works from anywhere inside the item. Home/End jump to the ends.
// Each move is announced to screen readers. The caller owns the data: onMove(id, toIndex) saves and repaints; the grip
// of the moved item gets focus back after the repaint.
//
//   <ul data-reorder-scope="coll-sources"> <li data-reorder-id="a1"> <button class="reorder-grip">…</button> … </li> … </ul>
//   makeReorderable(listEl, { scope: 'coll-sources', onMove: async (id, i) => { … }, name: (item) => 'title' });
import { T } from './feedI18n.js';

let live = null;
function announce(msg) {
    if (!live || !live.isConnected) {
        live = document.createElement('div');
        live.className = 'sr-only'; live.id = 'reorderLive';
        live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
        document.body.append(live);
    }
    live.textContent = '';
    setTimeout(() => { live.textContent = msg; }, 30);
}

/** The ⋮⋮ handle. `name` is what the item is called ("Climate", "Feeds"): it goes into the accessible name. */
export function reorderGrip(name) {
    const g = document.createElement('button');
    g.type = 'button'; g.className = 'reorder-grip';
    g.textContent = '⋮⋮';
    const label = T('Move “{name}”', { name });
    g.title = T('Drag to reorder, or use the arrow keys'); g.setAttribute('aria-label', label);
    g.setAttribute('aria-roledescription', T('reorder handle'));
    return g;
}

/**
 * Wires a list whose direct-or-nested items carry data-reorder-id and contain a .reorder-grip.
 * axis 'y' (a list) or 'x' (a bar). Returns nothing; call it again after every repaint (it is idempotent per element).
 */
export function makeReorderable(list, { scope, onMove, axis = 'y', name = (el) => el.dataset.reorderName || '' } = {}) {
    if (!list || !onMove) return;
    if (scope) list.dataset.reorderScope = scope;
    const items = () => [...list.querySelectorAll('[data-reorder-id]')].filter(x => !x.hidden);
    const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp', fwd = axis === 'x' ? 'ArrowRight' : 'ArrowDown';

    const move = async (id, to) => {
        const all = items(), from = all.findIndex(x => x.dataset.reorderId === id);
        if (from < 0) return;
        to = Math.max(0, Math.min(all.length - 1, to));
        if (to === from) return;
        const label = name(all[from]);
        await onMove(id, to);
        announce(T('{name} moved to position {i} of {n}', { name: label, i: to + 1, n: all.length }));
        setTimeout(() => {
            const root = scope ? document.querySelector(`[data-reorder-scope="${scope}"]`) : list;
            const it = root && [...root.querySelectorAll('[data-reorder-id]')].find(x => x.dataset.reorderId === id);
            const g = it && it.querySelector('.reorder-grip');
            if (g) g.focus({ preventScroll: false });
        }, 0);
    };

    items().forEach(item => {
        if (item.dataset.reorderWired) return;
        item.dataset.reorderWired = '1';
        const id = item.dataset.reorderId;
        const grip = item.querySelector('.reorder-grip');
        // keyboard: arrows on the grip, Alt+arrows anywhere in the item
        item.addEventListener('keydown', (e) => {
            const onGrip = e.target === grip;
            if (!onGrip && !e.altKey) return;
            const all = items(), i = all.indexOf(item);
            let to = null;
            if (e.key === back) to = i - 1; else if (e.key === fwd) to = i + 1;
            else if (onGrip && e.key === 'Home') to = 0; else if (onGrip && e.key === 'End') to = all.length - 1;
            if (to === null) return;
            e.preventDefault(); e.stopPropagation();
            move(id, to);
        });
        if (!grip) return;
        // pointer drag: the item follows the pointer; the drop line shows where it lands
        grip.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const start = axis === 'x' ? e.clientX : e.clientY;
            let to = items().indexOf(item), dragging = false;
            const others = () => items().filter(x => x !== item);
            const clear = () => list.querySelectorAll('.is-drop-before, .is-drop-after').forEach(x => x.classList.remove('is-drop-before', 'is-drop-after'));
            const onMoveP = (ev) => {
                const pos = axis === 'x' ? ev.clientX : ev.clientY;
                if (!dragging && Math.abs(pos - start) < 4) return;
                if (!dragging) { dragging = true; item.classList.add('is-dragging'); list.classList.add('is-reordering'); }
                item.style.transform = axis === 'x' ? `translateX(${pos - start}px)` : `translateY(${pos - start}px)`;
                const os = others(); to = os.length;
                for (let k = 0; k < os.length; k++) { const r = os[k].getBoundingClientRect(); const mid = axis === 'x' ? r.left + r.width / 2 : r.top + r.height / 2; if (pos < mid) { to = k; break; } }
                clear();
                if (os[to]) os[to].classList.add('is-drop-before'); else if (os.length) os[os.length - 1].classList.add('is-drop-after');
            };
            const end = () => {
                grip.removeEventListener('pointermove', onMoveP); grip.removeEventListener('pointerup', end); grip.removeEventListener('pointercancel', end);
                item.style.transform = ''; item.classList.remove('is-dragging'); list.classList.remove('is-reordering'); clear();
                if (dragging) move(id, to);
            };
            try { grip.setPointerCapture(e.pointerId); } catch (_) { /* jsdom */ }
            grip.addEventListener('pointermove', onMoveP); grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
        });
        grip.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });   // a grip never opens the item
    });
}
