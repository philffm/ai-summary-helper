// loader.js — tiny content script that runs on every page instead of the full content.js (~200 KB).
// The full script is injected (by the background, via scripting.executeScript) only when it is needed:
//   • this page has saved highlights to paint,
//   • the user selects text (highlight tooltip),
//   • or the extension talks to the page (summarize, context menu, shortcuts) — those senders inject on demand.
// Classic script, no imports: keep it small and keep pageKeyForUrl in sync with modules/pageKey.js (test80 checks the parity).
(() => {
  const api = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
  if (!api || !api.runtime || !api.storage) return;
  if (window.__AISH_LOADER) return;

  const KEEP = ['currentJobId', 'v', 'id', 'item', 'story_fbid', 'pid', 'postId', 'article'];
  const keyFor = (href) => {
    try {
      const u = new URL(href);
      const keep = KEEP.filter(k => u.searchParams.get(k)).sort().map(k => `${k}=${u.searchParams.get(k)}`);
      return `${u.origin}${u.pathname}${keep.length ? '?' + keep.join('&') : ''}`;
    } catch (_) { return String(href || '').split('#')[0].split('?')[0]; }
  };

  window.__AISH_LOADER = { keyFor };         // truthy guard; keyFor is exposed so test80 can check it against pageKey.js

  const ANN = 'hl:all';                      // keep in sync with SK.annotations (modules/storageKeys.js)
  let loading = false;
  const full = () => !!window.__AISH_CONTENT_LOADED || !!window.aishContentScriptInitialized;
  let flags = null;                          // highlighting switches (sync storage), read once and kept fresh below

  const highlightingOn = () => {
    if (!flags) return true;                 // unknown yet: assume on, the full script re-checks
    const legacy = flags.highlightingEnabled !== false;
    const user = flags.userHighlightingEnabled !== undefined ? flags.userHighlightingEnabled !== false : legacy;
    const ai = flags.aiHighlightingEnabled !== undefined ? flags.aiHighlightingEnabled !== false : legacy;
    return user || ai;
  };

  const detach = () => {
    document.removeEventListener('mouseup', onMouseUp, true);
    document.removeEventListener('visibilitychange', onNav);
    window.removeEventListener('popstate', onNav);
    window.removeEventListener('hashchange', onNav);
    try { if (window.navigation) window.navigation.removeEventListener('navigatesuccess', onNav); } catch (_) { /* optional API */ }
    try { api.storage.onChanged.removeListener(onStorage); } catch (_) { /* gone */ }
  };

  // Ask the background to inject the full script; resolves once it is in the page.
  const load = () => {
    if (full()) { detach(); return Promise.resolve(true); }
    if (loading) return Promise.resolve(false);
    loading = true;
    return new Promise((resolve) => {
      try {
        const p = api.runtime.sendMessage({ action: 'aish:injectContent' }, (res) => {
          void (api.runtime.lastError);
          loading = false;
          if (res && res.ok) detach();
          resolve(!!(res && res.ok));
        });
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (_) { loading = false; resolve(false); }
    });
  };

  // Does this page have saved highlights? Then the full script has to paint them.
  const check = () => {
    if (full() || loading || !highlightingOn()) return;
    try {
      api.storage.local.get([ANN], (res) => {
        void (api.runtime.lastError);
        const all = res && res[ANN];
        if (!Array.isArray(all) || !all.length) return;
        const key = keyFor(location.href);
        if (all.some(a => a && !a.dismissed && typeof a.url === 'string' && keyFor(a.url) === key)) load();
      });
    } catch (_) { /* context gone */ }
  };

  // A text selection: hand it to the full script, then replay the mouseup so its highlight tooltip appears.
  function onMouseUp(e) {
    if (full() || !highlightingOn()) return;
    const sel = window.getSelection && window.getSelection();
    const text = sel && sel.rangeCount ? String(sel).trim() : '';
    if (text.length < 3) return;
    const target = e.target || document;
    const init = { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, button: e.button, view: window };
    load().then((ok) => { if (ok) setTimeout(() => { try { target.dispatchEvent(new MouseEvent('mouseup', init)); } catch (_) { /* detached */ } }, 0); });
  }

  function onNav() { if (document.visibilityState !== 'hidden') check(); }
  function onStorage(changes, area) {
    if (area === 'local' && changes[ANN]) check();
    if (area === 'sync' && (changes.userHighlightingEnabled || changes.aiHighlightingEnabled || changes.highlightingEnabled)) {
      flags = Object.assign({}, flags, ...['userHighlightingEnabled', 'aiHighlightingEnabled', 'highlightingEnabled'].filter(k => changes[k]).map(k => ({ [k]: changes[k].newValue })));
      check();
    }
  }

  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('visibilitychange', onNav);
  window.addEventListener('popstate', onNav);
  window.addEventListener('hashchange', onNav);
  try { if (window.navigation) window.navigation.addEventListener('navigatesuccess', onNav); } catch (_) { /* optional API */ }
  try { api.storage.onChanged.addListener(onStorage); } catch (_) { /* gone */ }

  try {
    api.storage.sync.get(['userHighlightingEnabled', 'aiHighlightingEnabled', 'highlightingEnabled'], (r) => {
      void (api.runtime.lastError);
      flags = r || {};
      check();
    });
  } catch (_) { check(); }
})();
