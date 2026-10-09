// Real-Chromium check of the sidebar postMessage token and the background sender gate. Not part of `npm test` (needs Playwright + Chromium).
//   node plugin/scripts/build.js chrome
//   node plugin/tests/e2e/sidebar-channel.e2e.cjs [path/to/unpacked/extension]   (default: plugin/dev/aish-extension-chrome)
let pw; try { pw = require('playwright'); } catch (_) { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium } = pw;
const http = require('http'); const path = require('path'); const fs = require('fs'); const os = require('os');
const srv = http.createServer((q, r) => {
  if (q.url === '/feed') { r.setHeader('content-type', 'application/rss+xml'); return r.end('<rss version="2.0"><channel><title>F</title></channel></rss>'); }
  r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>Page</title><body><article><h1>Page</h1><p>Some article text.</p></article></body>');
}).listen(8124);
(async () => {
  const ext = path.resolve(process.argv[2] || path.join(__dirname, '../../dev/aish-extension-chrome'));
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-')), {
    headless: false, args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox'], viewport: { width: 1100, height: 760 } });
  let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = sw.url().split('/')[2]; console.log('extension', extId);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  let ok = true; const check = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); if (!cond) ok = false; };
  const forged = (text, token) => ({ action: 'summaryComplete', url: 'http://localhost:8124/a', title: 'T', summary: `<div><p>${text}</p></div>`, content: '', tags: [], questions: ['Q?'], ...(token ? { aishSidebarToken: token } : {}) });
  const extFrame = (page) => page.frames().find(f => f.url().startsWith(`chrome-extension://${extId}/popup.html`));
  const isolated = async (page) => {   // the content script's world on this page
    const cdp = await ctx.newCDPSession(page); const ctxs = [];
    cdp.on('Runtime.executionContextCreated', (e) => ctxs.push(e.context));
    await cdp.send('Runtime.enable'); await wait(250);
    const c = ctxs.find(x => (x.origin || '').includes(extId) && x.auxData && x.auxData.type === 'isolated');
    return { run: async (expression) => (await cdp.send('Runtime.evaluate', { contextId: c.id, expression, awaitPromise: true, returnByValue: true })).result.value };
  };

  // A: a site frames popup.html itself and posts a fake summary → ignored
  const a = await ctx.newPage(); await a.goto('http://localhost:8124/attacker');
  await a.evaluate((src) => new Promise((res) => { const f = document.createElement('iframe'); f.src = src; f.style.cssText = 'width:420px;height:600px'; f.onload = res; document.body.appendChild(f); }), `chrome-extension://${extId}/popup.html`);
  await wait(1500);
  await a.evaluate((m) => { const f = document.querySelector('iframe'); f.contentWindow.postMessage(m, '*'); }, forged('FORGED-NO-TOKEN'));
  await a.evaluate((m) => { const f = document.querySelector('iframe'); f.contentWindow.postMessage(m, '*'); }, forged('FORGED-GUESS', '00000000-0000-4000-8000-000000000000'));
  await wait(800);
  const fa = extFrame(a); check('A framed popup.html loaded', !!fa);
  check('A forged summaries from a framing site are ignored', fa && !(await fa.evaluate(() => /FORGED/.test(document.body.textContent))));

  // B: the real in-page sidebar opened by the content script
  const b = await ctx.newPage(); await b.goto('http://localhost:8124/article'); await wait(600);
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'http://localhost:8124/article' }))[0].id);
  await sw.evaluate(async (id) => { await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] }); }, tabId);
  await wait(400);
  await sw.evaluate(async (id) => { await chrome.tabs.sendMessage(id, { action: 'toggleHybridSidebar' }); }, tabId);
  await wait(2000);
  const src = await b.evaluate(() => (document.getElementById('ai-summary-hybrid-sidebar') || {}).src || '');
  const token = (src.match(/#aish-sidebar=([0-9a-f-]{36})/) || [])[1];
  check('B sidebar iframe carries a token', !!token, src);
  const fb = extFrame(b);
  await b.evaluate((m) => document.getElementById('ai-summary-hybrid-sidebar').contentWindow.postMessage(m, '*'), forged('PAGE-NO-TOKEN'));
  const iso = await isolated(b);
  await iso.run(`document.getElementById('ai-summary-hybrid-sidebar').contentWindow.postMessage(${JSON.stringify(forged('CONTENT-SCRIPT-REAL', token))}, '*'); true`);
  await wait(1000);
  const txt = await fb.evaluate(() => document.body.textContent);
  check('B the page without the token is ignored', !/PAGE-NO-TOKEN/.test(txt));
  check('B the content script message with the token renders', /CONTENT-SCRIPT-REAL/.test(txt));

  // C: background sender gate
  const fromSidebar = await fb.evaluate(() => new Promise(r => chrome.runtime.sendMessage({ action: 'fetchFeedText', url: 'http://localhost:8124/feed' }, r)));
  check('C sidebar (extension page in a tab) may fetch feeds', fromSidebar && fromSidebar.ok === true, fromSidebar);
  const fromCs = await iso.run(`new Promise(r => chrome.runtime.sendMessage({ action: 'fetchFeedText', url: 'http://localhost:8124/feed' }, r))`);
  check('C content script may not', fromCs && fromCs.ok === false && /Not allowed/.test(fromCs.error), fromCs);
  const aiCs = await iso.run(`new Promise(r => chrome.runtime.sendMessage({ action: 'aiComplete', user: 'hi' }, r))`);
  check('C content script may not use aiComplete', aiCs && /Not allowed/.test(aiCs.error), aiCs);
  const wake = await iso.run(`new Promise(r => chrome.runtime.sendMessage({ action: 'wakeup' }, r))`);
  check('C content-script actions still work', wake && wake.status === 'awake', wake);
  const popup = await ctx.newPage(); await popup.goto(`chrome-extension://${extId}/popup.html`); await wait(800);
  const fromPopup = await popup.evaluate(() => new Promise(r => chrome.runtime.sendMessage({ action: 'fetchFeedText', url: 'http://localhost:8124/feed' }, r)));
  check('C popup may fetch feeds', fromPopup && fromPopup.ok === true, fromPopup);

  await b.screenshot({ path: path.join(os.tmpdir(), 'aish-e2e-sidebar.png') });
  await ctx.close(); srv.close();
  console.log(ok ? '\nALL PASS' : '\nSOME FAILED'); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
