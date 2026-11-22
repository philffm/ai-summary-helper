// webSearch.js — "Search the web for …": hands the typed words to the browser's own default search engine (chrome.search / browser.search),
// so the user's engine is used and the extension never learns which one it is. `search` is an optional permission: the browser asks the
// first time the user picks it (call from a click), never at install.
import { T } from './feedI18n.js';

const hasApi = () => !!(globalThis.browser && browser.search && browser.search.search) || !!(globalThis.chrome && chrome.search && chrome.search.query);
export const webSearchPossible = () => hasApi() || !!(globalThis.chrome && chrome.permissions && typeof chrome.permissions.request === 'function');

/** → { ok: true } when the permission is there (asks when it is not), else { ok: false, why } with the browser's own words. */
export async function ensureSearchAccess() {
  const api = globalThis.chrome;
  if (!(api && api.permissions)) return { ok: false, why: 'no permissions API' };
  if (hasApi()) return { ok: true };   // the API only exists once the permission is granted; checking it asynchronously first would cost Firefox's user-gesture window
  let granted = false;
  try { granted = !!(await api.permissions.request({ permissions: ['search'] })); }
  catch (e) { return { ok: false, why: String((e && e.message) || e) }; }   // e.g. "must be called during a user gesture", "not in optional_permissions"
  if (!granted) return { ok: false, why: 'permission declined' };
  return hasApi() ? { ok: true } : { ok: false, why: 'search API missing after the permission was granted (reload the extension)' };
}

/** Opens the results in a new tab with the browser's default engine. → { ok: true } | { ok: false, why } */
export async function searchWeb(text) {
  const q = String(text || '').trim(); if (!q) return { ok: false, why: 'empty' };
  const access = await ensureSearchAccess();
  if (!access.ok) return access;
  try {
    if (globalThis.browser && browser.search && browser.search.search) await browser.search.search({ query: q, disposition: 'NEW_TAB' });
    else await chrome.search.query({ text: q, disposition: 'NEW_TAB' });
    return { ok: true };
  } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
}

/** The palette entry: always last, so Enter on a query that matches nothing searches the web. */
export function webSearchCommand(query, search = searchWeb, notify = () => {}) {
  const q = String(query || '').trim();
  return { id: 'web', group: T('Web'), title: T('Search the web for “{q}”', { q }), keywords: '', run: async () => {
    const r = await search(q);
    if (r && r.ok === false) { console.warn('[web search]', r.why); notify(T('Web search did not start: {why}', { why: r.why })); }
  } };
}
