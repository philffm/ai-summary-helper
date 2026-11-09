// Real-Chromium check of the per-page highlight storage (claude/dev-brief-highlights-per-page.md). Not part of `npm test`.
//   node plugin/scripts/build.js chrome
//   node plugin/tests/e2e/highlights-per-page.e2e.cjs [path/to/unpacked/extension]   (default: plugin/dev/aish-extension-chrome)
// Checks: the migration from the old single list, a highlight on a page with ?id= survives (it vanished up to 2.2.44),
// highlights made at the same moment in two tabs of one page are both kept, the context-menu clear works with tracking params.
let pw; try { pw = require('playwright'); } catch (_) { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium } = pw;
const http = require('http'); const path = require('path'); const fs = require('fs'); const os = require('os');
const html = (t) => `<!doctype html><html><head><title>${t}</title></head><body style="font:18px sans-serif;margin:40px"><article><h1>Thread ${t}</h1><p id="p1">Sleep consolidates memory by replaying the day's experiences during slow wave sleep, which strengthens connections between neurons.</p><p id="p2">A second paragraph about something else entirely so the page has enough text to pass any length checks the extension might do.</p><p id="p3">A third paragraph that talks about rivers, mountains and the slow movement of glaciers across the northern landscapes.</p></article></body></html>`;
const PORT = 8124;
const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(html(q.url)); }).listen(PORT);
const base = `http://localhost:${PORT}`;
(async () => {
  const ext = path.resolve(process.argv[2] || path.join(__dirname, '../../dev/aish-extension-chrome'));
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-')), {
    headless: false, args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox'], viewport: { width: 1000, height: 700 } });
  let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const local = () => sw.evaluate(() => chrome.storage.local.get(null));
  let ok = true; const check = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); if (!cond) ok = false; };
  await wait(1500);   // the worker's own start migration (empty profile)

  // 1. migration from the old single list (as written by 2.2.44)
  await sw.evaluate(async (b) => {
    const all = await chrome.storage.local.get(null);
    await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('hl:')));
    await chrome.storage.local.set({ 'hl:all': [
      { id: 'old1', url: b + '/item?id=1', text: 'Sleep consolidates memory', type: 'user', timestamp: '2026-11-01T00:00:00Z', quote: { exact: 'Sleep consolidates memory', prefix: '', suffix: ' by replaying' }, pos: 0, v: 2 },
      { url: b + '/plain', text: 'third paragraph', type: 'user', timestamp: '2026-11-01T00:00:00Z' },
    ] });
  }, base);
  const res = await sw.evaluate(() => hlStore.migrate());   // eslint-disable-line no-undef -- the worker's global
  let st = await local();
  check('1 migration ran', res && res.ran && res.highlights === 2 && res.ids === 1, res);
  check('1 old list removed, schema 2', !('hl:all' in st) && st['hl:schema'] === 2);
  check('1 one key per page, keeps ?id=', Array.isArray(st[`hl:page:${base}/item?id=1`]) && Array.isArray(st[`hl:page:${base}/plain`]), Object.keys(st).filter((k) => k.startsWith('hl:')));

  // 2. a migrated highlight is painted on its page (tracking parameter in the address)
  const a = await ctx.newPage(); await a.goto(`${base}/item?id=1&utm_source=feed`); await wait(2500);
  const painted = await a.evaluate(() => document.querySelectorAll('mark.ai-user-highlight').length + (CSS.highlights ? [...CSS.highlights.values()].reduce((n, h) => n + h.size, 0) : 0));
  check('2 migrated highlight painted on item?id=1', painted > 0, painted);

  // 3. a new highlight on a page with ?id= is saved under that key and still there a moment later (the 2.2.44 bug)
  const select = async (page, sel) => { await page.click(sel, { clickCount: 3 }); await wait(900); };
  const b = await ctx.newPage(); await b.goto(`${base}/item?id=2`); await wait(800);
  await select(b, '#p2');
  await b.locator('button[aria-label="Highlight"]').first().click(); await wait(1500);
  st = await local();
  const p2 = st[`hl:page:${base}/item?id=2`] || [];
  check('3 new highlight saved under item?id=2', p2.length === 1 && p2[0].url === `${base}/item?id=2`, p2.map((h) => h.url));
  await b.reload(); await wait(2500);
  const kept = await b.evaluate(() => document.querySelectorAll('mark.ai-user-highlight').length + (CSS.highlights ? [...CSS.highlights.values()].reduce((n, h) => n + h.size, 0) : 0));
  check('3 still painted after a reload', kept > 0, kept);
  check('3 index row', (st['hl:index'] || []).some((r) => r.k === `${base}/item?id=2` && r.n === 1), st['hl:index']);

  // 4. two tabs of the same page highlight at the same moment: both kept (the old list lost one)
  const c1 = await ctx.newPage(); await c1.goto(`${base}/same`); await wait(800);
  const c2 = await ctx.newPage(); await c2.goto(`${base}/same`); await wait(800);
  await select(c1, '#p1'); await select(c2, '#p3');
  await Promise.all([c1.locator('button[aria-label="Highlight"]').first().click(), c2.locator('button[aria-label="Highlight"]').first().click()]);
  await wait(1500);
  st = await local();
  const same = st[`hl:page:${base}/same`] || [];
  check('4 both highlights kept', same.length === 2, same.map((h) => h.text.slice(0, 20)));

  // 5. context-menu clear on a page opened with a tracking parameter
  await b.goto(`${base}/item?id=2&utm_source=x`); await wait(1500);
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u).id, `${base}/item?id=2&utm_source=x`);
  await sw.evaluate((id) => chrome.tabs.sendMessage(id, { action: 'contextMenuClearHighlights' }), tabId); await wait(1200);
  st = await local();
  check('5 clear removed the page key', !(`hl:page:${base}/item?id=2` in st), Object.keys(st).filter((k) => k.startsWith('hl:page:')));
  check('5 other pages untouched', Array.isArray(st[`hl:page:${base}/same`]) && st[`hl:page:${base}/same`].length === 2);

  await a.screenshot({ path: '/tmp/aish-e2e-hl-page.png' });
  await ctx.close(); srv.close();
  console.log(ok ? 'ALL PASS' : 'SOME FAILED'); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); srv.close(); process.exit(1); });
