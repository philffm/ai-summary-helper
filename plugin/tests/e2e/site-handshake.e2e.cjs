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
// Fake api.byphil.eu for the thank-you page claims (section 5).
const apiCalls = [];
const jwt = (exp) => 'h.' + Buffer.from(JSON.stringify({ exp })).toString('base64url') + '.s';
const fakeApi = https.createServer({ key: fs.readFileSync(path.join(tmp, 'k.pem')), cert: fs.readFileSync(path.join(tmp, 'c.pem')) }, (q, r) => {
  let body = ''; q.on('data', (d) => { body += d; }); q.on('end', () => {
    const b = body ? JSON.parse(body) : {}; apiCalls.push({ url: q.url, auth: q.headers.authorization || '', body: b });
    r.setHeader('content-type', 'application/json'); r.setHeader('access-control-allow-origin', '*');
    if (q.method === 'OPTIONS') { r.setHeader('access-control-allow-headers', 'authorization,content-type'); return r.end(); }
    let out = { success: false, code: 'not_found' };
    if (q.url === '/v1/auth/claim-checkout' && b.session_id === 'cs_test_newbuyer0001') out = { success: true, state: 'signed_in', token: jwt(Math.floor(Date.now() / 1000) + 86400), record: { id: 'newbuyer0000001', email: 'new@example.com', subscription_status: 'active', license_key: 'sub_e2e' } };
    if (q.url === '/v1/auth/claim-checkout' && b.session_id === 'cs_test_confirm00001') out = b.confirm === 'signed_in' ? { success: true, state: 'active', record: { id: 'newbuyer0000001', email: 'new@example.com', subscription_status: 'active' } } : { success: true, state: 'confirm', paid_email: 'phil@work.example', account_email: 'new@example.com' };
    r.end(JSON.stringify(out));
  });
}).listen(8444);

(async () => {
  const ext = path.resolve(process.argv[2] || path.join(__dirname, '../../dev/aish-extension-chrome'));
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-')), {
    headless: false, ignoreHTTPSErrors: true,
    args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox', '--ignore-certificate-errors',
      '--host-resolver-rules=MAP ai-summary-helper.byphil.eu:443 127.0.0.1:8443, MAP api.byphil.eu:443 127.0.0.1:8444', '--no-proxy-server'],
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

  // 2b. …/#open-aish typed or linked as an address opens AISH too, and the hash is removed
  const opened2 = async () => (await sw.evaluate(async () => (await chrome.runtime.getContexts({})).filter(c => /popup\.html/.test(c.documentUrl || '')).length));
  const n2 = await opened2();
  const h = await ctx.newPage(); await h.goto('https://ai-summary-helper.byphil.eu/#open-aish'); await wait(2000);
  check('2b the #open-aish address opens AISH', n2 === 0 && (await opened2()) > n2, { before: n2, after: await opened2() });
  check('2b the hash is removed from the address bar', !(await h.evaluate(() => location.hash)), await h.evaluate(() => location.href));

  // 2. Clicking it opens AISH (toolbar popup, or the app in a tab where the popup can't open)
  // Playwright doesn't list the toolbar popup as a page; the extension's own context list does (POPUP, or TAB for the fallback).
  const opened = () => sw.evaluate(async () => (await chrome.runtime.getContexts({})).filter(c => /popup\.html/.test(c.documentUrl || '')).map(c => c.contextType));
  await h.close(); await a.bringToFront(); await wait(500);   // the popup from 2b closes when the page gets focus
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

  // 5. Support Pass thank-you page: the extension claims the payment (fake API), the page shows the result
  const t1 = await ctx.newPage(); await t1.goto('https://ai-summary-helper.byphil.eu/thanks.html?session_id=cs_test_newbuyer0001');
  await t1.waitForFunction(() => document.documentElement.getAttribute('data-aish-claim') === 'signed_in', null, { timeout: 15000 }).catch(() => {});
  const s1 = await t1.evaluate(() => ({ state: document.documentElement.getAttribute('data-aish-claim'), h1: [...document.querySelectorAll('.ty-state')].find((x) => getComputedStyle(x).display !== 'none')?.querySelector('h1')?.textContent, url: location.href, email: document.querySelector('[data-for~="signed_in"] [data-fill="email"]')?.textContent }));
  check('5 new buyer: signed in and the pass shown as on', s1.state === 'signed_in' && /Support Pass is on/.test(s1.h1 || '') && s1.email === 'new@example.com', s1);
  check('5 the session id is gone from the address bar', !/session_id/.test(s1.url), s1.url);
  const stored = await sw.evaluate(async () => { const r = await chrome.storage.local.get(['account:token', 'account:user', 'account:licenseKey']); return { token: !!r['account:token'], email: r['account:user'] && r['account:user'].email, key: r['account:licenseKey'] }; });
  check('5 the login is stored in the extension', stored.token && stored.email === 'new@example.com' && stored.key === 'sub_e2e', stored);
  // signed in now → a second payment with another email asks first, then moves the pass on one tap
  const t2 = await ctx.newPage(); await t2.goto('https://ai-summary-helper.byphil.eu/thanks.html?session_id=cs_test_confirm00001');
  await t2.waitForFunction(() => document.documentElement.getAttribute('data-aish-claim') === 'confirm', null, { timeout: 15000 }).catch(() => {});
  const s2 = await t2.evaluate(() => ({ state: document.documentElement.getAttribute('data-aish-claim'), text: document.querySelector('[data-for="confirm"] .post-sub')?.textContent.replace(/\s+/g, ' ') }));
  check('5 other email: the page asks which account', s2.state === 'confirm' && /phil@work\.example/.test(s2.text) && /new@example\.com/.test(s2.text), s2);
  await t2.locator('[data-aish-claim-confirm="signed_in"]').click();
  await t2.waitForFunction(() => document.documentElement.getAttribute('data-aish-claim') === 'active', null, { timeout: 15000 }).catch(() => {});
  const confirmCall = apiCalls.filter((c) => c.body.session_id === 'cs_test_confirm00001').pop();
  check('5 one tap: pass on the signed-in account (token + confirm sent)', (await t2.evaluate(() => document.documentElement.getAttribute('data-aish-claim'))) === 'active' && confirmCall && confirmCall.body.confirm === 'signed_in' && /^Bearer /.test(confirmCall.auth), confirmCall && { confirm: confirmCall.body.confirm, auth: !!confirmCall.auth });
  // the same page on another host claims nothing
  const before5 = apiCalls.length;
  const t3 = await ctx.newPage(); await t3.goto('http://localhost:8125/thanks.html?session_id=cs_test_newbuyer0001'); await wait(1500);
  check('5 other site: no claim, nothing sent', (await t3.evaluate(() => document.documentElement.hasAttribute('data-aish-claim'))) === false && apiCalls.length === before5);
  fakeApi.close();
  await ctx.close(); own.close(); other.close();
  console.log(ok ? '\nALL PASS' : '\nSOME FAILED'); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
