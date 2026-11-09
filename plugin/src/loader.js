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
  // copy of modules/archiveUrl.js: highlights on an archive.ph / Wayback copy belong to the original article
  const ARCHIVE = [/^archive\.(ph|today|is|li|vn|fo|md)$/, /^(web\.|wayback\.)?archive\.org$/, /^wayback\.archive-it\.org$/, /^webcache\.googleusercontent\.com$/,
    /^(www\.)?12ft\.io$/, /^(www\.)?removepaywall\.com$/, /^(www\.)?ghostarchive\.org$/];
  const isArchive = (h) => { const x = String(h || '').toLowerCase().replace(/^www\.(?=archive\.)/, ''); return ARCHIVE.some(re => re.test(x)); };
  const unwrap = (url) => {
    const raw = String(url || '').trim();
    let u;
    try { u = new URL(raw); } catch (_) { return raw; }
    if (!isArchive(u.hostname)) return raw;
    const m = raw.slice(u.origin.length).match(/https?:\/\/?[^\s]+/i) || raw.slice(u.origin.length).match(/https?%3A%2F%2F[^\s&]+/i);
    if (!m) return raw;
    let inner = m[0];
    if (/%3A%2F%2F/i.test(inner)) { try { inner = decodeURIComponent(inner); } catch (_) { return raw; } }
    inner = inner.replace(/^(https?):\/(?!\/)/i, '$1://');
    try { const out = new URL(inner); return !/^https?:$/.test(out.protocol) || isArchive(out.hostname) ? raw : out.href; } catch (_) { return raw; }
  };
  const keyFor = (href) => {
    try {
      const u = new URL(unwrap(href));
      const keep = KEEP.filter(k => u.searchParams.get(k)).sort().map(k => `${k}=${u.searchParams.get(k)}`);
      return `${u.origin}${u.pathname}${keep.length ? '?' + keep.join('&') : ''}`;
    } catch (_) { return String(href || '').split('#')[0].split('?')[0]; }
  };

  window.__AISH_LOADER = { keyFor };         // truthy guard; keyFor is exposed so test80 can check it against pageKey.js

  // keep in sync with modules/storageKeys.js (SK.annotations, SK.hlSchema, HL_PAGE); test80 checks the parity
  const ANN = 'hl:all';                      // the old single list (before the migration)
  const SCHEMA = 'hl:schema';                // 2 = one key per page
  const PAGE = 'hl:page:';                   // + page key: this page's highlights
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

  // Does this page have saved highlights? Then the full script has to paint them. Reads this page's key only
  // (the old single list only until the migration has run).
  const check = () => {
    if (full() || loading || !highlightingOn()) return;
    try {
      const key = keyFor(location.href);
      api.storage.local.get([SCHEMA, PAGE + key, ANN], (res) => {
        void (api.runtime.lastError);
        if (!res) return;
        const list = res[SCHEMA] === 2 ? res[PAGE + key] : res[ANN];
        if (!Array.isArray(list) || !list.length) return;
        if (list.some(a => a && !a.dismissed && typeof a.url === 'string' && keyFor(a.url) === key)) load();
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
    if (area === 'local' && (changes[PAGE + keyFor(location.href)] || changes[ANN] || changes[SCHEMA])) check();
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

  // A link waiting in the phone inbox: once its page is open, tell the extension the real title and description.
  const INBOX = 'inbox:pending';              // keep in sync with SK.inboxPending (modules/storageKeys.js)
  const reportInboxMeta = () => {
    try {
      api.storage.local.get([INBOX], (res) => {
        void (api.runtime.lastError);
        const list = res && res[INBOX];
        if (!Array.isArray(list) || !list.length) return;
        const key = keyFor(location.href);
        if (!list.some(e => e && typeof e.url === 'string' && keyFor(e.url) === key)) return;
        const content = (sel) => { const el = document.querySelector(sel); return el ? String(el.getAttribute('content') || '').trim() : ''; };
        const title = (content('meta[property="og:title"]') || document.title || '').slice(0, 200);
        const description = (content('meta[property="og:description"]') || content('meta[name="description"]')).slice(0, 300);
        if (!title && !description) return;
        const p = api.runtime.sendMessage({ action: 'inboxMeta', url: location.href, title, description });
        if (p && typeof p.catch === 'function') p.catch(() => {});
      });
    } catch (_) { /* context gone */ }
  };
  reportInboxMeta();

  try {
    api.storage.sync.get(['userHighlightingEnabled', 'aiHighlightingEnabled', 'highlightingEnabled'], (r) => {
      void (api.runtime.lastError);
      flags = r || {};
      check();
    });
  } catch (_) { check(); }
})();
