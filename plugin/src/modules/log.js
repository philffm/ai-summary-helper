// log.js — leveled logging. `debug` is silent unless enabled (set globalThis.__AISH_DEBUG__ = true in the
// extension's DevTools console, or run localStorage.aishDebug = '1' on the popup). Never pass API keys,
// request URLs with keys, or article text to any logger.
const on = () => {
    try { if (globalThis.__AISH_DEBUG__ === true) return true; } catch (_) { /* ignore */ }
    try { return globalThis.localStorage && globalThis.localStorage.getItem('aishDebug') === '1'; } catch (_) { return false; }
};
export const debug = (...a) => { if (on()) console.debug('[aish]', ...a); };
export const warn = (...a) => console.warn('[aish]', ...a);
export const error = (...a) => console.error('[aish]', ...a);
