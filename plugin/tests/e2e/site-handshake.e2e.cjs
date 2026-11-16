// Real-Chromium check of the website handshake: on our own site the loader marks <html data-aish="installed">, the store
// buttons turn into "Open AISH" and open the extension; on any other site nothing changes and the message is refused.
// Not part of `npm test` (needs Playwright + Chromium + openssl).
//   node plugin/scripts/build.js chrome
//   node plugin/tests/e2e/site-handshake.e2e.cjs [path/to/unpacked/extension]   (default: plugin/dev/aish-extension-chrome)
// The real site in docs/ is served over HTTPS (self-signed) and Chromium maps ai-summary-helper.byphil.eu to it
// (--no-proxy-server: behind a proxy the mapping would be skipped and the live site loaded instead).
let pw; try { pw = require('playwright'); } catch (_) { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium } = pw;
const https = require('https'); const http = require('http'); const path = require('path'); const fs = require('fs'); const os = require('os');
const { execFileSync } = require('child_process');

const DOCS = path.resolve(__dirname, '../../../docs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aish-hs-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=ai-summary-helper.byphil.eu',
  '-keyout', path.join(tmp, 'k.pem'), '-out', path.join(tmp, 'c.pem')], { stdio: 'ignore' });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json' };
const serve = (q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(DOCS, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); }
  r.setHeader('content-type', TYPES[path.extname(f)] || 'application/octet-stream'); fs.createReadStream(f).pipe(r);
};
const own = https.createServer({ key: fs.readFileSync(path.join(tmp, 'k.pem')), cert: fs.readFileSync(path.join(tmp, 'c.pem')) }, serve).listen(8443);
const other = http.createServer(serve).listen(8125);

(async () => {
  const ext = path.resolve(process.argv[2] || path.join(__dirname, '../../dev/aish-extension-chrome'));
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-')), {
    headless: false, ignoreHTTPSErrors: true,
    args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox', '--ignore-certificate-errors',
      '--host-resolver-rules=MAP ai-summary-helper.byphil.eu:443 127.0.0.1:8443', '--no-proxy-server'],
    viewport: { width: 1200, height: 800 } });
  let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = sw.url().split('/')[2];
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  let ok = true; const check = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); if (!cond) ok = false; };
  const buttons = (page) => page.evaluate(() => [...document.querySelectorAll('.pill-cta, .btn-primary, .btn-secondary, .tier-cta')]
    .filter(a => a.hasAttribute('data-aish-open') || /chromewebstore|addons\.mozilla/.test(a.href)).map(a => ({ text: a.textContent.trim(), href: a.getAttribute('href'), open: a.hasAttribute('data-aish-open') })));

  // 1. Our own site, as installed users see it
  const a = await ctx.newPage(); a.on('pageerror', (e) => console.log('     page error: ' + e.message));
  await a.goto('https://ai-summary-helper.byphil.eu/'); await wait(1500);
  check('1 own site: <html data-aish="installed">', (await a.evaluate(() => document.documentElement.getAttribute('data-aish'))) === 'installed');
  const btnA = await buttons(a);
  check('1 own site: every store button reads "Open AISH"', btnA.length > 0 && btnA.every(b => b.open && b.text === 'Open AISH' && b.href === '#open-aish'), btnA.slice(0, 3));
  const textLinks = await a.evaluate(() => [...document.querySelectorAll('a[href*="chromewebstore.google.com"]')].filter(x => !x.hasAttribute('data-aish-open')).length);
  console.log('     (store text links left as they are: ' + textLinks + ')');

  // 2. Clicking it opens AISH (toolbar popup, or the app in a tab where the popup can't open)
  // Playwright doesn't list the toolbar popup as a page; the extension's own context list does (POPUP, or TAB for the fallback).
  const opened = () => sw.evaluate(async () => (await chrome.runtime.getContexts({})).filter(c => /popup\.html/.test(c.documentUrl || '')).map(c => c.contextType));
  const before = (await opened()).length;
  await a.locator('[data-aish-open]:visible').first().click(); await wait(1500);
  const after = await opened();
  check('2 click opens AISH (popup, or a tab where the popup cannot open)', after.length > before, after);
  check('2 the page did not navigate to the store', a.url().startsWith('https://ai-summary-helper.byphil.eu/'), a.url());

  // 3. The same page on another host: nothing marked, nothing swapped
  const b = await ctx.newPage(); await b.goto('http://localhost:8125/'); await wait(1500);
  check('3 other site: no data-aish attribute', (await b.evaluate(() => document.documentElement.hasAttribute('data-aish'))) === false);
  const btnB = await buttons(b);
  check('3 other site: store buttons unchanged', btnB.length > 0 && btnB.every(x => !x.open && x.href !== '#open-aish'), btnB.slice(0, 2));

  // 4. A forged message from a content script on another site is refused
  const cdp = await ctx.newCDPSession(b); const ctxs = [];
  cdp.on('Runtime.executionContextCreated', (e) => ctxs.push(e.context)); await cdp.send('Runtime.enable'); await wait(300);
  const iso = ctxs.find(x => (x.origin || '').includes(extId) && x.auxData && x.auxData.type === 'isolated');
  const n0 = (await opened()).length;
  const res = await cdp.send('Runtime.evaluate', { contextId: iso.id, awaitPromise: true, returnByValue: true,
    expression: `new Promise((r) => { try { chrome.runtime.sendMessage({ action: 'aish:openFromSite' }, (x) => { void chrome.runtime.lastError; r(x === undefined ? 'no answer' : x); }); } catch (e) { r(String(e)); } })` });
  await wait(1200);
  check('4 forged message from another site: refused, nothing opened', (await opened()).length === n0 && res.result.value === 'no answer', res.result.value);

  await ctx.close(); own.close(); other.close();
  console.log(ok ? '\nALL PASS' : '\nSOME FAILED'); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
