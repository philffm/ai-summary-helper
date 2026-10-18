// Fake `chrome` for the in-site demo: in-memory storage + mock background replaying a recorded summary.
(() => {
  const mk = () => { const d = {}, ls = new Set(); const area = {
    get: (k, cb) => { let o = {}; if (k == null) o = { ...d }; else if (typeof k === 'string') { if (k in d) o[k] = d[k]; } else if (Array.isArray(k)) k.forEach(x => { if (x in d) o[x] = d[x]; }); else Object.keys(k).forEach(x => { o[x] = x in d ? d[x] : k[x]; }); o = JSON.parse(JSON.stringify(o)); if (cb) { cb(o); return; } return Promise.resolve(o); },
    set: (o, cb) => { const ch = {}; for (const k in o) { ch[k] = { oldValue: d[k], newValue: o[k] }; d[k] = JSON.parse(JSON.stringify(o[k])); } ls.forEach(f => f(ch)); if (cb) { cb(); return; } return Promise.resolve(); },
    remove: (k, cb) => { [].concat(k).forEach(x => delete d[x]); if (cb) { cb(); return; } return Promise.resolve(); },
    clear: (cb) => { for (const k in d) delete d[k]; if (cb) cb(); return Promise.resolve(); },
    getBytesInUse: (a, cb) => { if (cb) cb(0); return Promise.resolve(0); } };
    area._ls = ls; return area; };
  const local = mk(), sync = mk(), session = mk(); sync.set({ onboardingDismissed: true });
  const storageL = new Set();
  [local, sync, session].forEach((a, i) => a._ls.add(ch => storageL.forEach(f => f(ch, ['local','sync','session'][i]))));
  const msgL = new Set();
  const bc = (m) => setTimeout(() => msgL.forEach(f => { try { f(JSON.parse(JSON.stringify(m)), { id: 'demo' }, () => {}); } catch (e) { console.error(e); } }), 0);
  const TAB = { id: 1, url: 'https://example.com/article', title: 'The quiet comeback of the long read', active: true, windowId: 1 };
  const ANSWER = '<h3>Key points</h3><ul><li>Long-form reading is growing again.</li><li>Readers want <strong>context</strong>, not headlines.</li><li>Summaries help decide what deserves the time.</li></ul>';
  const handle = (m, respond) => {
    switch (m.action) {
      case 'getActiveTab': return respond({ ok: true, tab: TAB, url: TAB.url, title: TAB.title });
      case 'ping': return respond({ ok: true, caps: ['attachment'] });
      case 'queueSummary': respond({ ok: true });
        bc({ action: 'summaryContext', url: TAB.url, title: TAB.title, words: 1240, model: 'Demo model', length: 200 });
        setTimeout(() => bc({ action: 'summaryProgress', phase: 2 }), 600);
        setTimeout(() => bc({ action: 'summaryComplete', summary: ANSWER, title: TAB.title, url: TAB.url, timestamp: new Date().toISOString(), tags: ['reading'], modelId: 'demo', content: '<p>Article</p>' }), 1600);
        return;
      case 'summaryJobs': return respond({ ok: true, jobs: [] });
      default: console.warn('[demo] unmocked action', m.action); return respond({ ok: true });
    }
  };
  window.chrome = {
    storage: { local, sync, session, onChanged: { addListener: f => storageL.add(f), removeListener: f => storageL.delete(f) } },
    runtime: { lastError: undefined, id: 'demo', getURL: p => new URL('./' + p, location.href).href, reload() {},
      sendMessage: (m, cb) => { const p = new Promise(r => handle(m, r)); if (typeof cb === 'function') { p.then(cb); return; } return p; },
      onMessage: { addListener: f => msgL.add(f), removeListener: f => msgL.delete(f) },
      getManifest: () => ({ version: 'demo' }) },
    tabs: { query: (q, cb) => { const r = [TAB]; if (cb) { cb(r); return; } return Promise.resolve(r); }, create: () => {}, sendMessage: (id, m, cb) => { const r = (m && m.action === 'ping') ? { status: 'pong' } : { ok: true }; if (cb) { cb(r); return; } return Promise.resolve(r); }, onUpdated: { addListener() {} }, onActivated: { addListener() {} } },
    scripting: { executeScript: async () => [{ result: null }] },
    permissions: { contains: (p, cb) => { if (cb) cb(true); return Promise.resolve(true); }, request: (p, cb) => { if (cb) cb(true); return Promise.resolve(true); } },
    windows: { getCurrent: (cb) => { const w = { id: 1 }; if (cb) cb(w); return Promise.resolve(w); } },
    alarms: { create() {}, onAlarm: { addListener() {} } }, notifications: { create() {} },
    i18n: { getMessage: () => '', getUILanguage: () => 'en' }
  };
})();
