// panelDock.js — attach the popup to Chrome's side panel, or detach it back to a popup.
// "Attached" is the useNativeSidePanel setting (also in Settings › Appearance): the background turns it into
// sidePanel.setPanelBehavior({ openPanelOnActionClick }), so the toolbar icon opens the panel instead of the popup.
// The side panel loads popup.html?surface=sidepanel (platforms/chrome/manifest.json), which is how the page knows
// where it runs. Firefox has its own sidebar and Safari no side panel API: there this module reports "unavailable".

/**
 * Where this page runs: 'sidepanel' (Chrome's side panel), 'inpage' (the sidebar iframe the content script puts
 * into the page; its #hash carries the sidebarChannel token) or 'popup'.
 */
export function currentSurface(search = (typeof location !== 'undefined' ? location.search : ''), hash = (typeof location !== 'undefined' ? location.hash : '')) {
    try {
        if (new URLSearchParams(search).get('surface') === 'sidepanel') return 'sidepanel';
        if (/(^|[#&])aish-sidebar=/.test(String(hash || ''))) return 'inpage';
    } catch (_) { /* fall through */ }
    return 'popup';
}

/** Can this browser attach to a native side panel at all? */
export function sidePanelAvailable(api = (typeof chrome !== 'undefined' ? chrome : null)) {
    return !!(api && api.sidePanel && typeof api.sidePanel.open === 'function' && typeof api.sidePanel.setPanelBehavior === 'function');
}

/**
 * Popup → side panel. sidePanel.open must run inside the click (user gesture), so the window id is looked up
 * beforehand and passed in; the setting is saved after the panel is open.
 */
export async function attachToSidePanel(windowId, api = chrome) {
    await api.sidePanel.open({ windowId });
    await api.storage.sync.set({ useNativeSidePanel: true });
}

/**
 * Side panel → popup. The setting is saved first: the popup that opens next reads it on start, and must not
 * attach itself again. Opening the popup can fail (window not focused, Chrome < 127); the toolbar icon then
 * opens it on the next click. Closing the panel uses sidePanel.close (Chrome 141+) or window.close().
 */
export async function detachToPopup(windowId, api = chrome, win = window) {
    await api.storage.sync.set({ useNativeSidePanel: false });
    try { await api.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }); } catch (_) { /* background applies it on the storage change too */ }
    let popupOpened = false;
    try { if (api.action && typeof api.action.openPopup === 'function') { await api.action.openPopup(); popupOpened = true; } } catch (_) { /* the icon opens it next time */ }
    try {
        if (typeof api.sidePanel.close === 'function') await api.sidePanel.close({ windowId });
        else win.close();
    } catch (_) { win.close(); }
    return { popupOpened };
}
