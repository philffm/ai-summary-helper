// adapters.js — registry of target adapters. Step 2 registers none; adapters arrive with their own steps (WebDAV, HTTP, …).
// The contract is documented in plugin/formats/target-adapter.md.
const registry = new Map();

export const DEFAULT_CAPS = { push: true, update: true, check: false, list: false, delete: false };

export function registerAdapter(name, impl) {
    if (!name || !impl || typeof impl.push !== 'function') throw new Error('An adapter needs a name and a push() function.');
    registry.set(String(name), { ...impl, caps: { ...DEFAULT_CAPS, ...(impl.caps || {}) }, accepts: Array.isArray(impl.accepts) ? impl.accepts : ['md'] });
}
export const getAdapter = (name) => registry.get(String(name)) || null;
export const listAdapters = () => [...registry.keys()];
/** Tests only. */
export const clearAdapters = () => registry.clear();
