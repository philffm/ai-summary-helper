// segmented.js — shared sliding "segmented control" (History tabs, Feed status, Prompt tabs, Send sheet …).
//
// Markup contract (styles live in styles.css › "Segmented control"):
//   <div class="seg" data-seg="unique-key"> <button class="seg-btn on">…</button> … </div>
// Call syncSeg(el) after building the control or after changing which button has `.on`.
// The brand-coloured indicator (.seg-ind, same gradient as the bottom nav blob) slides to the active
// button. Controls that are rebuilt on every render keep their animation: the last position is
// remembered per data-seg key, so a fresh element starts where the old one ended and slides from there.

const lastPos = new Map();
const watchers = new WeakMap();

function indicator(seg) {
    let ind = null;
    for (const c of seg.children) if (c.classList && c.classList.contains('seg-ind')) { ind = c; break; }
    if (!ind) {
        ind = document.createElement('span');
        ind.className = 'seg-ind';
        ind.setAttribute('aria-hidden', 'true');
        seg.insertBefore(ind, seg.firstChild);
    }
    return ind;
}

const setPos = (seg, x, w) => { seg.style.setProperty('--seg-x', x + 'px'); seg.style.setProperty('--seg-w', w + 'px'); };

export function syncSeg(seg, { animate = true } = {}) {
    if (!seg) return;
    const key = seg.dataset.seg || '';
    const ind = indicator(seg);
    const active = seg.querySelector('.seg-btn.on');
    if (!active) { seg.classList.remove('seg-ready'); return; }
    const x = active.offsetLeft, w = active.offsetWidth;
    if (!w) { watch(seg); return; }           // hidden or detached — measured once it gets a size
    const fresh = !ind.dataset.init;
    const prev = key ? lastPos.get(key) : null;
    if (fresh) {
        ind.dataset.init = '1';
        if (prev && animate) {                // start where the previous element ended, then slide
            seg.classList.add('seg-nomove');
            setPos(seg, prev.x, prev.w);
            seg.classList.add('seg-ready');
            void ind.offsetWidth;             // commit the start position
            seg.classList.remove('seg-nomove');
        } else {
            seg.classList.add('seg-nomove');
            setPos(seg, x, w);
            seg.classList.add('seg-ready');
            void ind.offsetWidth;
            seg.classList.remove('seg-nomove');
            if (key) lastPos.set(key, { x, w });
            watch(seg);
            return;
        }
    }
    if (!animate) seg.classList.add('seg-nomove');
    setPos(seg, x, w);
    if (!animate) { void ind.offsetWidth; seg.classList.remove('seg-nomove'); }
    if (key) lastPos.set(key, { x, w });
    watch(seg);
}

/** Keep the indicator aligned when the control (or a label) changes size — without animating. */
function watch(seg) {
    if (watchers.has(seg) || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { if (seg.isConnected) syncSeg(seg, { animate: false }); });
    ro.observe(seg);
    seg.querySelectorAll('.seg-btn').forEach(b => ro.observe(b));
    watchers.set(seg, ro);
}

/** Sync every control below root (default: whole document). */
export function syncAllSegs(root = document) {
    root.querySelectorAll('.seg').forEach(s => syncSeg(s));
}

/** Make `btn` the only active button of its control and slide to it. */
export function activateSeg(seg, btn) {
    seg.querySelectorAll('.seg-btn').forEach(b => {
        const on = b === btn;
        b.classList.toggle('on', on);
        if (b.hasAttribute('aria-selected')) b.setAttribute('aria-selected', String(on));
        if (b.hasAttribute('aria-checked')) b.setAttribute('aria-checked', String(on));
        if (b.hasAttribute('aria-pressed')) b.setAttribute('aria-pressed', String(on));
    });
    syncSeg(seg);
}

/** Sync once the control is attached and laid out (next frame). */
export function syncSegLater(seg) {
    const run = () => syncSeg(seg);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else setTimeout(run, 0);
}
