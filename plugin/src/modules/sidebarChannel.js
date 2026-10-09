// sidebarChannel.js — the postMessage path from the content script into the in-page sidebar (popup.html in an iframe).
// popup.html is web-accessible, so any site can frame it and post to it. The content script gives the sidebar it
// creates a random token in the iframe's #hash; the popup accepts only events from its parent that carry it.

export const SIDEBAR_HASH_KEY = 'aish-sidebar';
export const SIDEBAR_TOKEN_FIELD = 'aishSidebarToken';

/** A fresh unguessable token for one sidebar iframe. */
export function newSidebarToken() {
    return crypto.randomUUID();
}

/** The token from a location.hash like "#aish-sidebar=<token>", or '' when absent. */
export function sidebarTokenFromHash(hash) {
    try { return new URLSearchParams(String(hash || '').replace(/^#/, '')).get(SIDEBAR_HASH_KEY) || ''; } catch (_) { return ''; }
}

/** Should the popup handle this message event? Needs a token, our parent as sender, and the matching token. */
export function acceptSidebarMessage(event, token, parentWin, selfWin) {
    if (!token || !event || parentWin === selfWin || event.source !== parentWin) return false;
    const data = event.data;
    return !!(data && typeof data === 'object' && typeof data.action === 'string' && data[SIDEBAR_TOKEN_FIELD] === token);
}
