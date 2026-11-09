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

  const userOn = () => {
    if (!flags) return true;
    const legacy = flags.highlightingEnabled !== false;
    return flags.userHighlightingEnabled !== undefined ? flags.userHighlightingEnabled !== false : legacy;
  };
  // copy of modules/pageKey.js isNoisePage (feeds, inboxes, sites the user excluded): no selection toolbar there
  const NOISE = [
    [/(^|\.)linkedin\.com$/, /^\/(feed|messaging|notifications|mynetwork|jobs\/(search|collections)(\/.*)?)\/?$/],
    [/^(www\.)?(x|twitter)\.com$/, /^\/(home|notifications|messages|explore|i\/.*)?\/?$/],
    [/(^|\.)facebook\.com$/, /^\/(watch|messages|marketplace|groups\/feed|reel|stories)?(\/.*)?$/],
    [/(^|\.)instagram\.com$/, /^\/(explore|reels|direct)?(\/.*)?$/],
    [/(^|\.)youtube\.com$/, /^\/(feed|results|shorts)?(\/.*)?$/],
  ];
  const isNoise = (href) => {
    try {
      const u = new URL(href), host = u.hostname.toLowerCase();
      const excluded = (flags && Array.isArray(flags.highlightExcludedSites)) ? flags.highlightExcludedSites : [];
      if (excluded.some(h => h && (host === h || host.endsWith('.' + h)))) return true;
      if (KEEP.some(k => u.searchParams.get(k))) return false;
      return NOISE.some(([h, p]) => h.test(host) && p.test(u.pathname));
    } catch (_) { return false; }
  };

  const detach = () => {
    hideBar();
    document.removeEventListener('mousedown', onMouseDown, true);
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

  // ── Selection toolbar ──
  // A text selection shows a small toolbar drawn by this script. The full content script (~200 KB) is injected only when
  // one of its buttons is pressed, and then runs that action on the same selection. Plain selecting (to copy, or a click
  // that leaves an old selection behind) loads nothing. Only a real selection gesture counts: a drag of a few pixels or a
  // double / triple click, starting outside fields, editable areas and controls, with at least three letters selected.
  const BAR_ID = 'aish-sel-host';
  let down = null;            // where the mouse went down: { x, y, inField }
  let lastShown = '';         // the selection the toolbar was last shown for (a dismissed one does not come back)
  const EDITABLE = 'input, textarea, select, button, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="button"], #ai-summary-hybrid-sidebar, [data-aish-ui]';
  const inEditable = (node) => {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return !!(el && (el.closest(EDITABLE) || el.isContentEditable));
  };
  const selectionKey = (sel) => {
    const r = sel.getRangeAt(0);
    return `${String(sel).trim()}|${r.startOffset}|${r.endOffset}`;
  };
  /** The selection a mouse-up just made, or null when it is not a real selection gesture. Exposed for test80. */
  const qualify = (e) => {
    if (!e || e.button !== 0 || !down || down.inField) return null;
    const sel = window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    const text = String(sel).replace(/\s+/g, ' ').trim();
    if (text.replace(/[^\p{L}\p{N}]/gu, '').length < 3) return null;
    if (inEditable(sel.anchorNode) || inEditable(sel.focusNode)) return null;
    const moved = Math.hypot((e.clientX || 0) - down.x, (e.clientY || 0) - down.y) >= 5;
    if (!moved && !(e.detail >= 2)) return null;            // a plain click: whatever is selected was selected before
    const key = selectionKey(sel);
    if (key === lastShown) return null;
    return { sel, key };
  };
  window.__AISH_LOADER.qualify = qualify;

  function hideBar() {
    const h = document.getElementById(BAR_ID);
    if (h) h.remove();
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  }
  function onOutside(e) { const h = document.getElementById(BAR_ID); if (h && !(e.composedPath && e.composedPath().includes(h))) hideBar(); }
  function onKey(e) { if (e.key === 'Escape') hideBar(); }

  function showBar(x, y) {
    hideBar();
    const host = document.createElement('div');
    host.id = BAR_ID;
    host.setAttribute('data-aish-ui', '1');
    host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483646;';
    const root = host.attachShadow({ mode: 'open' });
    const css = document.createElement('style');
    // same look as the full script's toolbar (content/notesPopover.js), so nothing changes when it takes over
    css.textContent = ':host{all:initial}*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}'
      + '.bar{position:absolute;display:flex;gap:2px;padding:3px;background:#111827;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.3)}'
      + '.bar button{all:unset;box-sizing:border-box;cursor:pointer;padding:6px 10px;font-size:15px;line-height:1;border-radius:8px;color:#fff}'
      + '.bar button:hover,.bar button:focus-visible{background:#1f2937;outline:2px solid #60a5fa;outline-offset:-2px}'
      + '.bar[aria-busy="true"]{opacity:.7}';
    const bar = document.createElement('div');
    bar.className = 'bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Highlight, comment or note on the selection');
    for (const [glyph, label, which] of [['✏️', 'Highlight', 'highlight'], ['💬', 'Highlight and comment', 'comment'], ['📝', 'Note with this quote', 'note']]) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = glyph; b.title = label; b.setAttribute('aria-label', label);
      b.addEventListener('mousedown', (ev) => ev.preventDefault());   // keep the page's selection while pressing
      b.addEventListener('click', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        bar.setAttribute('aria-busy', 'true');
        load().then((ok) => {
          hideBar();
          const run = window.__AISH_SELECTION_ACTION;
          if (ok && typeof run === 'function') run(which, { pageX: x, pageY: y });
        });
      });
      bar.appendChild(b);
    }
    const left = Math.max(window.scrollX + 8, Math.min(x - 40, window.scrollX + window.innerWidth - 134));
    bar.style.left = left + 'px'; bar.style.top = Math.max(window.scrollY + 8, y - 46) + 'px';
    for (const type of ['keydown', 'keyup', 'keypress', 'mouseup']) host.addEventListener(type, (ev) => ev.stopPropagation());
    root.append(css, bar);
    document.documentElement.appendChild(host);
    setTimeout(() => document.addEventListener('mousedown', onOutside, true), 60);
    document.addEventListener('keydown', onKey, true);
  }

  function onMouseDown(e) {
    if (e.composedPath && e.composedPath().some(n => n && n.id === BAR_ID)) return;
    down = { x: e.clientX || 0, y: e.clientY || 0, inField: inEditable(e.target) };
  }
  function onMouseUp(e) {
    if (full() || !userOn() || isNoise(location.href)) return;
    if (e.composedPath && e.composedPath().some(n => n && n.id === BAR_ID)) return;
    const q = qualify(e);
    if (!q) return;
    lastShown = q.key;
    showBar(e.pageX, e.pageY);
  }

  function onNav() { if (document.visibilityState !== 'hidden') check(); }
  function onStorage(changes, area) {
    if (area === 'local' && (changes[PAGE + keyFor(location.href)] || changes[ANN] || changes[SCHEMA])) check();
    const FLAG_KEYS = ['userHighlightingEnabled', 'aiHighlightingEnabled', 'highlightingEnabled', 'highlightExcludedSites'];
    if (area === 'sync' && FLAG_KEYS.some(k => changes[k])) {
      flags = Object.assign({}, flags, ...FLAG_KEYS.filter(k => changes[k]).map(k => ({ [k]: changes[k].newValue })));
      check();
    }
  }

  document.addEventListener('mousedown', onMouseDown, true);
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
    api.storage.sync.get(['userHighlightingEnabled', 'aiHighlightingEnabled', 'highlightingEnabled', 'highlightExcludedSites'], (r) => {
      void (api.runtime.lastError);
      flags = r || {};
      check();
    });
  } catch (_) { check(); }
})();
