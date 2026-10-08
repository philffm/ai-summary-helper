// Real-Chromium check of the lazy content script (loader.js). Not part of `npm test` (needs Playwright + Chromium).
//   node plugin/scripts/build.js chrome
//   node plugin/tests/e2e/lazy-content.e2e.cjs [path/to/unpacked/extension]   (default: plugin/dev/aish-extension-chrome)
let pw; try { pw = require('playwright'); } catch (_) { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium } = pw;
const http = require('http'); const path = require('path'); const fs = require('fs'); const os = require('os');
const html = (t) => `<!doctype html><html><head><title>${t}</title></head><body style="font:18px sans-serif;margin:40px"><article><h1>${t}</h1><p id="p1">Sleep consolidates memory by replaying the day's experiences during slow wave sleep, which strengthens connections between neurons.</p><p id="p2">A second paragraph about something else entirely so the page has enough text to pass any length checks the extension might do.</p></article></body></html>`;
const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(html(q.url)); }).listen(8123);
(async () => {
  const ext = path.resolve(process.argv[2] || path.join(__dirname, '../../dev/aish-extension-chrome'));
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-')), {
    headless: false, args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox'], viewport: { width: 1000, height: 700 } });
  let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = sw.url().split('/')[2]; console.log('extension', extId);
  const states = async (page) => {
    const cdp = await ctx.newCDPSession(page); const ctxs = [];
    cdp.on('Runtime.executionContextCreated', (e) => ctxs.push(e.context));
    await cdp.send('Runtime.enable'); await new Promise(r => setTimeout(r, 250));
    const iso = ctxs.filter(c => (c.origin || '').includes(extId));
    let out = { isolated: iso.length, loader: false, full: false, hl: 0, ui: [] };
    for (const c of iso) {
      const r = await cdp.send('Runtime.evaluate', { contextId: c.id, returnByValue: true, expression: `({ loader: !!window.__AISH_LOADER, full: !!window.__AISH_CONTENT_LOADED, hl: (CSS.highlights ? CSS.highlights.size : -1), ui: [...document.querySelectorAll('[id^=aish],[id^=ai-summary],[class*=aish-hl],[class*=aish]')].map(e => e.id || e.className).slice(0,8) })` });
      const v = r.result.value || {}; out.loader ||= v.loader; out.full ||= v.full; out.hl = Math.max(out.hl, v.hl); out.ui = out.ui.concat(v.ui);
    }
    await cdp.detach(); return out;
  };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  let ok = true; const check = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + JSON.stringify(extra) : '')); if (!cond) ok = false; };

  // A: plain page → loader only
  const a = await ctx.newPage(); await a.goto('http://localhost:8123/a'); await wait(800);
  let s = await states(a); check('A plain page: loader yes, full script no', s.loader && !s.full, s);

  // C: select text → injection + tooltip
  await a.click('#p1', { clickCount: 3 }); await wait(1200);
  s = await states(a); check('C selection injects the full script', s.full, s);
  const tip = await a.evaluate(() => !!document.querySelector('#aish-hl-tooltip, .aish-hl-tooltip, [id*=tooltip]'));
  const tipShadow = await a.evaluate(() => [...document.querySelectorAll('div')].some(d => /Highlight/.test(d.textContent || '') && d.children.length < 3 && getComputedStyle(d).position === 'absolute'));
  check('C highlight tooltip is visible after the replayed mouseup', tip || tipShadow, { tip, tipShadow });
  await a.screenshot({ path: '/tmp/aish-e2e-selection.png' });

  // B: stored highlight for /b → full script injected on load and painted
  await sw.evaluate(() => chrome.storage.local.set({ 'hl:all': [{ id: 'hl_t1', url: 'http://localhost:8123/b', text: 'Sleep consolidates memory', type: 'user', quote: { exact: 'Sleep consolidates memory', prefix: '', suffix: ' by replaying' }, pos: 0, v: 2 }] }));
  const b = await ctx.newPage(); await b.goto('http://localhost:8123/b'); await wait(2500);
  s = await states(b); check('B page with a saved highlight: full script injected and painted', s.full && s.hl > 0, s);
  await b.screenshot({ path: '/tmp/aish-e2e-highlight.png' });

  // D: background sender (context menu / shortcut path) injects on demand
  const c = await ctx.newPage(); await c.goto('http://localhost:8123/c'); await wait(800);
  s = await states(c); check('D before: loader only', s.loader && !s.full, s);
  const tabId = await sw.evaluate(async () => { const t = await chrome.tabs.query({ url: 'http://localhost:8123/c' }); return t[0].id; });
  const res = await sw.evaluate(async (id) => { try { return await sendToTab(id, { action: 'ping' }); } catch (e) { return 'ERR ' + e.message; } }, tabId);
  await wait(500); s = await states(c);
  check('D sendToTab injects and the ping is answered', s.full && res && res.status === 'pong', { res, s });

  // E: highlight added later while the page is open (e.g. from the popup) → injection via storage change
  const d = await ctx.newPage(); await d.goto('http://localhost:8123/d'); await wait(800);
  s = await states(d); check('E before: loader only', s.loader && !s.full, s);
  await sw.evaluate(() => chrome.storage.local.set({ 'hl:all': [{ id: 'hl_t2', url: 'http://localhost:8123/d', text: 'Sleep consolidates memory', type: 'user', quote: { exact: 'Sleep consolidates memory', prefix: '', suffix: ' by replaying' }, pos: 0, v: 2 }] }));
  await wait(2000); s = await states(d); check('E highlight saved elsewhere → injected and painted', s.full && s.hl > 0, s);


  // F: popup-side sender (sendMessageToTab) injects on demand, but probes (getSummaryState) do not
  const f = await ctx.newPage(); await f.goto('http://localhost:8123/f'); await wait(800);
  const tabF = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'http://localhost:8123/f' }))[0].id);
  const pop = await ctx.newPage(); await pop.goto(`chrome-extension://${extId}/popup.html`); await wait(1500);
  const probe = await pop.evaluate(async (id) => { const m = await import('./modules/mainScreen.js'); try { await m.sendMessageToTab(id, { action: 'getSummaryState' }); return 'ok'; } catch (e) { return 'rejected: ' + e.message; } }, tabF);
  s = await states(f); check('F probe (getSummaryState) does not inject', !s.full, { probe, s });
  const real = await pop.evaluate(async (id) => { const m = await import('./modules/mainScreen.js'); try { const r = await m.sendMessageToTab(id, { action: 'getSummaryState' }); return r; } catch (e) { return 'rejected'; } }, tabF);
  const act = await pop.evaluate(async (id) => { const m = await import('./modules/mainScreen.js'); try { return await m.sendMessageToTab(id, { action: 'contextMenuClearHighlights' }); } catch (e) { return 'rejected: ' + e.message; } }, tabF);
  await wait(500); s = await states(f); check('F real message injects the full script and gets answered', s.full && act && act.status === 'ok', { act, s });

  await ctx.close(); srv.close(); console.log(ok ? 'ALL PASS' : 'SOME FAILED'); process.exit(ok ? 0 : 1);
})().catch(e => { console.error('ERR', e); process.exit(2); });
