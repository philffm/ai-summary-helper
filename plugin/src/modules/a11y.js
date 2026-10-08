// Display & reading preferences (Settings › Appearance & Language).
// Everything defaults to "follow the system"; only explicit choices are stored.
export const TEXT_SCALE_MIN = 85, TEXT_SCALE_MAX = 150;

export function clampScale(v) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return 100;
    return Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, n));
}

/** Applies theme + a11y preferences to <html>. Safe to call repeatedly. */
export function applyA11y(cfg = {}, root = document.documentElement) {
    const theme = cfg.theme;
    if (theme === 'dark' || theme === 'light' || theme === 'contrast') root.setAttribute('data-theme', theme);
    else root.removeAttribute('data-theme');
    const scale = clampScale(cfg.textScale || 100);
    if (scale === 100) root.style.removeProperty('--text-scale'); else root.style.setProperty('--text-scale', String(scale / 100));
    if (cfg.lineSpacing === 'compact' || cfg.lineSpacing === 'relaxed') root.setAttribute('data-line', cfg.lineSpacing); else root.removeAttribute('data-line');
    if (cfg.readableFont) root.setAttribute('data-font', 'readable'); else root.removeAttribute('data-font');
    if (cfg.reduceMotion) root.setAttribute('data-motion', 'reduce'); else root.removeAttribute('data-motion');
}

/** "Light" / "Dark" as the system currently asks for it (for the "following your system" hint). */
export function systemTheme(win = window) {
    try { return win.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (_) { return 'light'; }
}
export function systemReducesMotion(win = window) {
    try { return !!win.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
}
