// sheet.js — shared dialog behaviour for bottom sheets and modals:
// focus moves into the dialog, Tab/Shift+Tab stay inside it, and focus returns to the opener on close.
// Escape: pass `onEscape` to close on Esc (owners that already handle Esc themselves can omit it).
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function focusableIn(root) {
    return [...root.querySelectorAll(FOCUSABLE)].filter(el => !el.hidden && !el.closest('[hidden]') && el.getClientRects().length > 0 && el.ownerDocument.defaultView.getComputedStyle(el).visibility !== 'hidden');
}

/**
 * Trap focus in `root` (the dialog element). Returns { release(restore = true) }.
 * Initial focus: [autofocus], else the first focusable, else the dialog itself.
 */
export function trapFocus(root, { label, onEscape } = {}) {
    if (!root) return { release() {} };
    if (label) root.setAttribute('aria-label', label);
    if (!root.hasAttribute('role')) root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    const opener = document.activeElement;
    if (!root.hasAttribute('tabindex')) root.tabIndex = -1;
    const onKey = (e) => {
        if (e.key === 'Escape' && onEscape && !e.defaultPrevented && root.isConnected) { e.preventDefault(); e.stopPropagation(); onEscape(); return; }
        if (e.key !== 'Tab') return;
        const f = focusableIn(root);
        if (!f.length) { e.preventDefault(); root.focus(); return; }
        const i = f.indexOf(document.activeElement);
        const first = f[0], last = f[f.length - 1];
        if (i === -1 || !root.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    const start = () => {
        const f = focusableIn(root);
        const pref = root.querySelector('[autofocus]');
        (pref && f.includes(pref) ? pref : f[0] || root).focus({ preventScroll: true });
    };
    start();
    // Content that arrives after opening (async sheets): move focus once if nothing inside has it yet.
    const t = setTimeout(() => { if (!root.contains(document.activeElement) || document.activeElement === root) start(); }, 60);
    return {
        release(restore = true) {
            clearTimeout(t);
            document.removeEventListener('keydown', onKey, true);
            if (restore && opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
        }
    };
}
