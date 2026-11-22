// webSearch.js — "Search the web for …": hands the typed words to the browser's own default search engine (chrome.search / browser.search),
// so the user's engine is used and the extension never learns which one it is. `search` is an optional permission: the browser asks the
// first time the user picks it (call from a click), never at install.
import { T } from './feedI18n.js';

const hasApi = () => !!(globalThis.browser && browser.search && browser.search.search) || !!(globalThis.chrome && chrome.search && chrome.search.query);
export const webSearchPossible = () => hasApi() || !!(globalThis.chrome && chrome.permissions && typeof chrome.permissions.request === 'function');

/** → true when the permission is there (asks when it is not). */
export async function ensureSearchAccess() {
  try { if (hasApi() && await chrome.permissions.contains({ permissions: ['search'] })) return true; } catch (_) { /* ask below */ }
  try { return !!(await chrome.permissions.request({ permissions: ['search'] })) && hasApi(); } catch (_) { return false; }
}

/** Opens the results in a new tab with the browser's default engine. → true when it was started. */
export async function searchWeb(text) {
  const q = String(text || '').trim(); if (!q) return false;
  if (!(await ensureSearchAccess())) return false;
  try {
    if (globalThis.browser && browser.search && browser.search.search) await browser.search.search({ query: q, disposition: 'NEW_TAB' });
    else await chrome.search.query({ text: q, disposition: 'NEW_TAB' });
    return true;
  } catch (_) { return false; }
}

/** The palette entry: always last, so Enter on a query that matches nothing searches the web. */
export function webSearchCommand(query, search = searchWeb) {
  const q = String(query || '').trim();
  return { id: 'web', group: T('Web'), title: T('Search the web for “{q}”', { q }), keywords: '', run: () => search(q) };
}
