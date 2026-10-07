// tabbar.js — shared underline tab bar with a sliding brand indicator (History: Inbox/Read/Sent/Archive,
// Feeds: Feed/Day/Week/Month). Filter pills stay separate pills on purpose.
//
// Markup contract (styles: styles.css › "Tab bar"):
//   <div class="tabbar" data-tabbar="unique-key"> <button class="tabbar-btn on">…</button> … </div>
// The active button carries `.on` (or `.active`). Call syncTabbar(el) after building the bar or after
// switching the active button. The indicator uses the same brand gradient as the bottom-nav blob.
// A bar that is rebuilt on every render keeps its animation: the last position is remembered per
// data-tabbar key, so a fresh element starts where the previous one ended and slides from there.

const INSET = 14;                       // underline is a little narrower than the tab
const lastPos = new Map();
const watchers = new WeakMap();

function indicator(bar) {
    for (const c of bar.children) if (c.classList && c.classList.contains('tabbar-ind')) return c;
    const ind = document.createElement('span');
    ind.className = 'tabbar-ind';
    ind.setAttribute('aria-hidden', 'true');
    bar.insertBefore(ind, bar.firstChild);
    return ind;
}

const setPos = (bar, x, w) => { bar.style.setProperty('--tb-x', x + 'px'); bar.style.setProperty('--tb-w', w + 'px'); };
const commit = (ind) => { void ind.offsetWidth; };

export function syncTabbar(bar, { animate = true } = {}) {
    if (!bar) return;
    const key = bar.dataset.tabbar || '';
    const ind = indicator(bar);
    const active = bar.querySelector('.tabbar-btn.on, .tabbar-btn.active');
    if (!active) { bar.classList.remove('tb-ready'); return; }
    const inset = active.offsetWidth > INSET * 3 ? INSET : 4;
    const x = active.offsetLeft + inset, w = active.offsetWidth - inset * 2;
    if (!(w > 0)) { watch(bar); return; }                   // hidden / detached: measured once it has a size
    const fresh = !ind.dataset.init;
    const prev = key ? lastPos.get(key) : null;
    if (fresh) {
        ind.dataset.init = '1';
        bar.classList.add('tb-nomove');
        setPos(bar, prev && animate ? prev.x : x, prev && animate ? prev.w : w);   // start where the old bar ended
        bar.classList.add('tb-ready');
        commit(ind);
        bar.classList.remove('tb-nomove');
        if (!(prev && animate)) { if (key) lastPos.set(key, { x, w }); watch(bar); return; }
    }
    if (!animate) bar.classList.add('tb-nomove');
    setPos(bar, x, w);
    if (!animate) { commit(ind); bar.classList.remove('tb-nomove'); }
    if (key) lastPos.set(key, { x, w });
    watch(bar);
}

/** Keep the indicator aligned when the bar or a label changes size (language, counts) — without animating. */
function watch(bar) {
    if (watchers.has(bar) || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { if (bar.isConnected) syncTabbar(bar, { animate: false }); });
    ro.observe(bar);
    bar.querySelectorAll('.tabbar-btn').forEach(b => ro.observe(b));
    watchers.set(bar, ro);
}

/** Sync once the bar is attached and laid out (next frame). */
export function syncTabbarLater(bar) {
    const run = () => syncTabbar(bar);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else setTimeout(run, 0);
}
