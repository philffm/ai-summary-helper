// backToTop.js — a floating "back to top" button for the Feeds and History lists.
// One button for both screens: it follows whichever list panel is being scrolled, shows once the list is
// scrolled past a screen or so, and scrolls that panel back to the top. The long-text reading tools in the
// History detail view keep their own pill, so this one stays out of the way there.
import { T } from './feedI18n.js';

const SCREENS = ['feeds', 'history'];

export function initBackToTop(doc = document) {
    if (doc.getElementById('backToTopBtn')) return;
    const win = doc.defaultView || window;
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.id = 'backToTopBtn';
    btn.className = 'back-to-top';
    btn.setAttribute('aria-label', T('Back to top'));
    btn.title = T('Back to top');
    btn.setAttribute('aria-hidden', 'true');
    btn.tabIndex = -1;
    const arrow = doc.createElement('span');
    arrow.className = 'back-to-top-ic';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '↑';
    btn.append(arrow);
    doc.body.append(btn);

    let scroller = null, on = false;
    const reduce = () => { try { return !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; } };
    const set = (show) => {
        if (show === on) return;
        on = show;
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-hidden', on ? 'false' : 'true');
        btn.tabIndex = on ? 0 : -1;
    };
    const detailOpen = () => {
        const d = doc.getElementById('articleDetail');
        return !!d && d.style.display !== 'none' && d.getClientRects().length > 0;
    };
    // Only the list panels themselves: the screen element, or a direct child of it (split view panels).
    const isListPanel = (el) => {
        if (!el || el.nodeType !== 1) return false;
        const screen = el.closest('#feedsScreen, #historyScreen');
        return !!screen && (el === screen || el.parentElement === screen);
    };
    const update = () => {
        if (!scroller || !SCREENS.includes(doc.body.dataset.screen) || detailOpen()) { set(false); return; }
        const top = scroller.scrollTop || 0, h = scroller.clientHeight || 0;
        set(top > Math.max(240, h * 0.6));
    };
    doc.addEventListener('scroll', (e) => {
        if (!isListPanel(e.target)) return;
        scroller = e.target;
        update();
    }, { capture: true, passive: true });
    btn.addEventListener('click', () => {
        if (!scroller) return;
        try { scroller.scrollTo({ top: 0, behavior: reduce() ? 'auto' : 'smooth' }); } catch (_) { scroller.scrollTop = 0; }
    });
    // Another screen or a different list: forget the old panel so the button never scrolls something unseen.
    try {
        new win.MutationObserver(() => { scroller = null; set(false); }).observe(doc.body, { attributes: true, attributeFilter: ['data-screen'] });
    } catch (_) { /* no observer: update() still checks the screen */ }
}
