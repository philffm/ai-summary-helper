// In-site demo: a fake `chrome` (in-memory storage + a mock background that replays recorded content).
// Loaded before the real popup.js, so everything else (rendering, i18n, finalize, storage logic) is production code.
(() => {
  const D = window.AISH_DEMO;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const mk = () => { const d = {}, ls = new Set(); const area = {
    get: (k, cb) => { let o = {}; if (k == null) o = { ...d }; else if (typeof k === 'string') { if (k in d) o[k] = d[k]; } else if (Array.isArray(k)) k.forEach(x => { if (x in d) o[x] = d[x]; }); else Object.keys(k).forEach(x => { o[x] = x in d ? d[x] : k[x]; }); o = clone(o); if (cb) { cb(o); return; } return Promise.resolve(o); },
    set: (o, cb) => { const ch = {}; for (const k in o) { ch[k] = { oldValue: d[k], newValue: o[k] }; d[k] = clone(o[k]); } ls.forEach(f => f(ch)); if (cb) { cb(); return; } return Promise.resolve(); },
    remove: (k, cb) => { [].concat(k).forEach(x => delete d[x]); if (cb) { cb(); return; } return Promise.resolve(); },
    clear: (cb) => { for (const k in d) delete d[k]; if (cb) cb(); return Promise.resolve(); },
    getBytesInUse: (a, cb) => { if (cb) cb(0); return Promise.resolve(0); } };
    area._ls = ls; return area; };
  const local = mk(), sync = mk(), session = mk();
  // Language and theme come from the page that embeds the demo (?lang=de&theme=dark): UI language, summary language, light/dark.
  const Q = new URLSearchParams(location.search), LOC = D.locale, THEME = Q.get('theme');
  sync.set({ onboardingDismissed: true, demo: true, ...(LOC ? { uiLanguage: LOC.ui, selectedLanguage: LOC.sel } : {}) });
  const setTheme = (th) => { if (th !== 'light' && th !== 'dark') return; document.documentElement.setAttribute('data-theme', th); local.set({ theme: th }); sync.set({ theme: th }); };
  setTheme(THEME);
  (() => { const b64 = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
    local.set({ 'inbox:config': { inboxId: b64(16), encKey: b64(32), writeToken: b64(32), readToken: b64(32), createdAt: Date.now() - 6 * 864e5, v: 1, toPhone: { inboxId: b64(16), writeToken: b64(32) } } }); })();
  // Docking the panel makes no sense inside a page: only Settings stays in the header.
  // Everything that would break or confuse inside a page is hidden: dangerous resets, settings import/export, licence, model and
  // phone-pairing setup, storage tools and the export formats that need a real browser download.
  document.addEventListener('DOMContentLoaded', () => {
    const ids = ['popoutButton', 'openTabButton', 'deleteSettingsButton', 'deleteHistoryButton', 'deleteAllButton', 'exportSettingsButton', 'importSettingsButton', 'verifyLicenseButton',
      'storageImagesButton', 'storageTextButton', 'storageReviewButton', 'cleanupTagsButton', 'nameTagsButton', 'libraryToolButton', 'exportMarkdownButton'];
    const st = document.createElement('style');
    st.textContent = ids.map(i => '#' + i).join(',') + ',.settings-row[data-panel=account],.settings-row[data-panel=models],.settings-row[data-panel=phoneinbox]{display:none !important}';
    document.head.appendChild(st);
    const drop = new Set(['folders', 'file-text', 'newspaper']);   // Obsidian, ODT/DOCX, PDF
    new MutationObserver(() => document.querySelectorAll('.card-menu-item').forEach((b) => {
      const u = b.querySelector('use'); const n = u && (u.getAttribute('href') || '').replace('#i-', '');
      if (drop.has(n)) b.remove();
    })).observe(document.body, { childList: true, subtree: true });
  });
  // A Kindle and a LocalSend receiver are "already set up", so Send to Kindle / LocalSend run end to end against the mock.
  local.set({ 'send:devices': [{ id: 'demo-kindle', type: 'kindle', label: 'Kindle', addresses: ['you@kindle.com'] }, { id: 'demo-ls', type: 'localsend', label: 'E-reader', addresses: ['192.168.1.42'] }] });
  window.confirm = () => true;
  addEventListener('message', (e) => { const m = e.data; if (m && m.aishDemo && m.type === 'theme') setTheme(m.theme); });
  // A believable reading history, so History, Graph and Analytics have something to show. Dates are relative to "now".
  (() => {
    const idx = [], recs = {}, slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    (D.library || []).forEach((a, i) => {
      const d = new Date(); d.setDate(d.getDate() - a.daysAgo); d.setHours(a.hour, (i * 7) % 60, 0, 0);
      const ts = d.toISOString(), id = 'article_demo_' + i;
      const summary = '<h3>Key points</h3><ul><li>' + a.title + '.</li><li>Context, evidence and what to read next.</li></ul>';
      idx.push({ id, title: a.title, url: 'https://' + a.host + '/' + slug(a.title), timestamp: ts, tags: a.tags, modelId: 'demo', summaryLength: 200, summary,
        contentWordCount: a.words, summaryWordCount: 60, archived: false, lastOpened: ts, moodScore: a.mood });
      recs['articles:rec:' + id] = { content: '<p>' + a.title + '</p>', summary, description: '' };
    });
    idx.sort((x, y) => x.timestamp < y.timestamp ? -1 : 1);
    local.set({ 'articles:index': idx, ...recs });
  })();
  // A few subscriptions with recent items, so Feeds has something to read.
  (() => {
    const F = D.feeds; if (!F) return;
    const hash = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return 'f' + (h >>> 0).toString(36); };
    const now = Date.now();
    const subs = F.subs.map(s => ({ id: hash('https://' + s.host + '/feed.xml'), url: 'https://' + s.host + '/feed.xml', title: s.title, siteUrl: 'https://' + s.host + '/', tags: s.tags, addedAt: now - 30 * 864e5, lastFetched: now, error: '' }));
    const items = F.items.map((it, i) => { const sub = subs[it.feed]; return { id: hash(sub.id + it.title), feedId: sub.id, title: it.title, link: 'https://' + F.subs[it.feed].host + '/p/' + i, published: now - it.hoursAgo * 36e5, snippet: it.snippet, audio: '', dur: 0, img: '', ai: false, read: i > 12 }; }).sort((a, b) => b.published - a.published);
    local.set({ 'feeds:subs': subs, 'feeds:items': items });
  })();
  const storageL = new Set();
  [local, sync, session].forEach((a, i) => a._ls.add(ch => storageL.forEach(f => f(ch, ['local', 'sync', 'session'][i]))));
  const msgL = new Set();
  const bc = (m) => setTimeout(() => msgL.forEach(f => { try { f(clone(m), { id: 'demo' }, () => {}); } catch (e) { console.error(e); } }), 0);
  const later = (ms, fn) => setTimeout(fn, ms);
  const toParent = (m) => { try { parent !== window && parent.postMessage({ aishDemo: true, ...m }, '*'); } catch (_) { /* standalone */ } };
  const TAB = D.tab;
  let timers = [];
  const stream = (text, html, question) => {
    timers.forEach(clearTimeout); timers = [];
    const T = (ms, fn) => timers.push(later(ms, fn));
    bc({ action: 'summaryContext', url: TAB.url, title: TAB.title, words: D.words, length: 200, model: 'Demo model', pageTokens: 1600 });
    T(350, () => bc({ action: 'summaryProgress', chunk: 'Connected' }));
    T(800, () => bc({ action: 'summaryProgress', chunk: 'Receiving data' }));
    const words = text.split(' '); let i = 0;
    const tick = () => { i = Math.min(words.length, i + 3); bc({ action: 'summaryProgress', chunk: i + ' words', preview: words.slice(0, i).join(' ') }); if (i < words.length) T(110, tick); else T(250, done); };
    const done = () => bc({ action: 'summaryComplete', summary: html, title: TAB.title, url: TAB.url, timestamp: new Date().toISOString(), tags: D.summary.tags, modelId: 'demo', questions: D.summary.questions, content: D.article.paragraphs.map(p => '<p>' + p + '</p>').join('') });
    T(1100, tick);
  };
  const handle = (m, respond) => {
    switch (m.action) {
      case 'getActiveTab': return respond({ ok: true, tab: TAB, url: TAB.url, title: TAB.title });
      case 'ping': return respond({ ok: true, caps: ['attachment'] });
      case 'summaryJobs': return respond({ ok: true, jobs: [], running: false });
      case 'queueSummary': {
        respond({ ok: true });
        stream(D.summary.stream, D.summary.html); return;
      }
      case 'aiComplete': {   // follow-up answers: streamed as aiProgress deltas, then returned whole with SOURCES / QUESTIONS like a real model
        const q = String(m.user || '').split(/Question:\s*/i).pop() || '';
        const a = D.asks.find(x => x.match.test(q)) || D.asks[D.asks.length - 1];
        const full = a.text + '\nSOURCES: ' + a.sources.map(x => '"' + x + '"').join(' ') + '\nQUESTIONS: ' + JSON.stringify(a.questions);
        let n = 0; const id = m.id;
        const tick = () => { const part = a.text.slice(n, n + 14); if (!part) return respond({ ok: true, text: full }); bc({ action: 'aiProgress', id, from: n, delta: part, phase: 'stream' }); n += part.length; later(60, tick); };
        later(500, tick); return;
      }
      case 'revealQuote': return respond({ ok: true });
      case 'sendLocalSendP2P': return later(700, () => respond({ success: true, ok: true, status: 200, data: /prepare-upload/.test(m.targetUrl || '') ? { sessionId: 'demo', files: {} } : {} }));
      case 'stopSummary': case 'cancelQueuedSummary': timers.forEach(clearTimeout); return respond({ ok: true });
      default: return respond({ ok: true });
    }
  };
  // Feeds, AI helpers, reader and side-panel plumbing are not part of the demo: acknowledged, nothing happens.
  const quiet = new Set(['ttsCmd', 'audioCmd', 'feedPollConfig', 'audioEnsure', 'feedBadgeClear', 'aiCancel', 'aiResync', 'fetchFeedText', 'inboxMeta', 'openFeedItem', 'openNativeSidePanel', 'relayToActiveTab', 'saveFeedItem', 'closeTabSelf', 'fetchImageAsDataUrl', 'fetchPdfBytes']);
  window.chrome = {
    storage: { local, sync, session, onChanged: { addListener: f => storageL.add(f), removeListener: f => storageL.delete(f) } },
    runtime: { lastError: undefined, id: 'demo', getURL: p => new URL('./' + p, location.href).href, reload() {},
      sendMessage: (m, cb) => { const p = new Promise(r => handle(m, r)); if (typeof cb === 'function') { p.then(cb); return; } return p; },
      onMessage: { addListener: f => msgL.add(f), removeListener: f => msgL.delete(f) },
      getManifest: () => ({ version: 'demo' }) },
    tabs: { query: (q, cb) => { const r = [TAB]; if (cb) { cb(r); return; } return Promise.resolve(r); }, create: () => {},
      sendMessage: (id, m, cb) => { if (m && m.action === 'revealQuote') toParent({ type: 'highlight', quote: m.quote || '' }); const r = (m && m.action === 'ping') ? { status: 'pong' } : { ok: true }; if (cb) { cb(r); return; } return Promise.resolve(r); },
      onUpdated: { addListener() {} }, onActivated: { addListener() {} } },
    scripting: { executeScript: async () => [{ result: null }] },
    permissions: { contains: (p, cb) => { if (cb) cb(true); return Promise.resolve(true); }, request: (p, cb) => { if (cb) cb(true); return Promise.resolve(true); } },
    windows: { getCurrent: (cb) => { const w = { id: 1 }; if (cb) cb(w); return Promise.resolve(w); } },
    alarms: { create() {}, onAlarm: { addListener() {} } }, notifications: { create() {} },
    i18n: { getMessage: () => '', getUILanguage: () => 'en' }
  };
  // The popup asks for the model roster over the network; the demo has no network.
  const realFetch = window.fetch.bind(window);
  // A phone that is "already paired": sending an article works end to end (really encrypted), the server answers 202.
  window.fetch = (u, o, ...a) => {
    const url = String(u);
    if (/api\.byphil\.eu\/.*\/aish_inboxes\/[^/]+\/items/.test(url) && o && o.method === 'POST') return new Promise(r => setTimeout(() => r(new Response('{}', { status: 202, headers: { 'Content-Type': 'application/json' } })), 700));
    if (/\/kindle$/.test(url) && o && o.method === 'POST') return new Promise(r => setTimeout(() => r(new Response('{"success":true}', { status: 200, headers: { 'Content-Type': 'application/json' } })), 900));
    if (/^https?:/.test(url) && !url.startsWith(location.origin)) return Promise.reject(new TypeError('offline demo'));
    return realFetch(u, o, ...a);
  };
  window.AISH_DEMO_ACTIONS = { handle, quiet };
})();

// The popup reads the stored summary language synchronously here, before popup.js has attached its listener, so the chip
// would stay on "EN". Nudge it once everything is wired.
addEventListener('load', () => { setTimeout(() => { const s = document.getElementById('languageSelect'); if (s) s.dispatchEvent(new Event('change')); }, 600); });
