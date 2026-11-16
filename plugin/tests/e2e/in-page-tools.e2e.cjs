// In-page tools on brand (Figma AISH-039) in Chromium (dev build): the ✏️ n | ✨ Summarize button, the highlights panel, the
// selection toolbar, the composer and the mark menu read the design tokens (inPage.css) and the theme setting.
// Usage: node plugin/tests/e2e/in-page-tools.e2e.cjs plugin/dev/aish-extension-chrome [shotDir] [--dark]
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright');
const http = require('http'), path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert');
const dark = process.argv.includes('--dark');
const P = ['Developers can use it now with open-source renderer SDKs for the web, Android, and iOS, so teams can ship the same interface everywhere.',
  'A2UI reliably binds to your data and child components on the server, so sensitive values never reach the model at any point.',
  'Version 1.0 adds bidirectional function calls, so a flight or reservation picker can check availability on the spot without a round trip.',
  'The rest of this article talks about migration, versioning and the roadmap for the next releases in some detail.'];
const page = () => `<!doctype html><html><head><title>A2UI 1.0</title></head><body style="font:18px/1.6 Georgia,serif;margin:40px auto;max-width:640px;${dark ? 'background:#16181d;color:#e6e6e6' : ''}"><article><h1>A2UI 1.0</h1>${P.map((t, i) => `<p id="p${i}">${t}</p>`).join('')}${'<p>Filler paragraph to make the page long enough to scroll and show the ticks on the right.</p>'.repeat(14)}</article></body></html>`;
(async () => {
  const ext = path.resolve(process.argv[2] || 'plugin/dev/aish-extension-chrome');
  const shots = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;
  const sfx = dark ? '-dark' : '';
  const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(page()); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-ip-')), { headless: false, colorScheme: dark ? 'dark' : 'light',
    args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox'], viewport: { width: 1000, height: 720 }, deviceScaleFactor: 2 });
  let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(1500);
  await sw.evaluate(async ({ base, P, dark }) => {
    const k = base + '/a2ui';
    const mk = (id, i, type) => ({ id, url: k, text: P[i].split(',')[0], type, timestamp: '2026-11-16T10:00:00Z', v: 2, quote: { exact: P[i].split(',')[0], prefix: '', suffix: ',' } });
    await chrome.storage.local.set({ ['hl:page:' + k]: [mk('g1', 0, 'ghost'), mk('g2', 1, 'ghost'), mk('u1', 2, 'user')], 'hl:index': [{ k, n: 3, d: 0, t: '2026-11-16T10:00:00Z' }], 'hl:schema': 2 });
    await chrome.storage.sync.set({ theme: dark ? 'dark' : 'light' });
  }, { base, P, dark });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base + '/a2ui'); await wait(2500);
  const host = p.locator('#aish-hl-host');
  const split = await p.evaluate(() => { const r = document.getElementById('aish-hl-host').shadowRoot; const pill = r.querySelector('.hlp-pill'), sum = r.querySelector('.hlp-sum');
    return { pill: pill.textContent.trim(), font: getComputedStyle(pill).fontFamily, pillBg: getComputedStyle(pill).backgroundColor, sumBg: getComputedStyle(sum).backgroundColor, theme: r.host.dataset.theme, adopted: r.adoptedStyleSheets.length, visible: getComputedStyle(r.host).visibility }; });
  if (shots) await p.screenshot({ path: path.join(shots, `ip-1-split${sfx}.png`), clip: { x: 560, y: 520, width: 440, height: 200 } });
  await host.locator('.hlp-pill').click(); await wait(400);
  const panel = await p.evaluate(() => { const r = document.getElementById('aish-hl-host').shadowRoot; const pn = r.querySelector('.hlp-panel');
    return { radios: [...r.querySelectorAll('.hlp-seg [role=radio]')].map((b) => b.textContent), cards: [...r.querySelectorAll('.hlp-card')].map((c) => c.className), bg: getComputedStyle(pn).backgroundColor,
      summarize: r.querySelectorAll('[data-act=summarize]').length, radius: getComputedStyle(pn).borderRadius, ticks: r.querySelectorAll('.hlp-tick').length }; });
  if (shots) await p.screenshot({ path: path.join(shots, `ip-2-panel${sfx}.png`), clip: { x: 560, y: 40, width: 440, height: 680 } });
  // switching All → Yours → AI keeps the panel's height (Yours has 1 card, All 3)
  const heights = [];
  for (const f of ['all', 'user', 'ghost']) {
    await host.locator(`[data-filter="${f}"]`).click(); await wait(150);
    heights.push(await p.evaluate((f) => { const r = document.getElementById('aish-hl-host').shadowRoot; return { f, h: Math.round(r.querySelector('.hlp-panel').getBoundingClientRect().height), cards: r.querySelectorAll('.hlp-list:not(.hlp-sizer) .hlp-card').length, clickable: r.querySelectorAll('.hlp-sizer [data-act]').length }; }, f));
  }
  await host.locator('[data-filter="all"]').click(); await wait(150);
  await p.keyboard.press('Escape'); await wait(200);
  const closed = await p.evaluate(() => !document.getElementById('aish-hl-host').shadowRoot.querySelector('.hlp-panel'));
  // selection toolbar on the last paragraph, then the composer
  await p.click('#p3', { clickCount: 3 }); await wait(900);
  const bar = await p.evaluate(() => { const r = document.getElementById('aish-np-host')?.shadowRoot; const b = r && r.querySelector('.np-bar'); return b ? { bg: getComputedStyle(b).backgroundColor, n: b.querySelectorAll('button').length } : null; });
  if (shots) { const bb = await p.locator('#p3').boundingBox(); await p.screenshot({ path: path.join(shots, `ip-3-toolbar${sfx}.png`), clip: { x: 40, y: Math.max(0, bb.y - 90), width: 900, height: bb.height + 140 } }); }
  await p.locator('#aish-np-host').locator('button[aria-label="Highlight and comment"]').click(); await wait(400);
  const card = await p.evaluate(() => { const r = document.getElementById('aish-np-host')?.shadowRoot; const c = r && r.querySelector('.np-card'); return c ? { bg: getComputedStyle(c).backgroundColor, font: getComputedStyle(c).fontFamily } : null; });
  if (shots) { const bb = await p.locator('#aish-np-host').locator('.np-card').boundingBox(); await p.screenshot({ path: path.join(shots, `ip-4-composer${sfx}.png`), clip: { x: Math.max(0, bb.x - 30), y: Math.max(0, bb.y - 60), width: 400, height: bb.height + 90 } }); }
  await p.keyboard.press('Escape'); await wait(300);
  // click an AI mark → Keep / Dismiss
  const mark = await p.evaluate(() => { const h = CSS.highlights && CSS.highlights.get('aish-ghost'); if (!h) return null; const r = [...h][0].getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
  let menu = null;
  if (mark) { await p.mouse.click(mark.x, mark.y); await wait(400);
    menu = await p.evaluate(() => { const r = document.getElementById('aish-np-host')?.shadowRoot; const m = r && r.querySelector('.np-bar--text'); return m ? [...m.querySelectorAll('button')].map((b) => b.textContent) : null; });
    if (shots) await p.screenshot({ path: path.join(shots, `ip-5-markmenu${sfx}.png`), clip: { x: 40, y: Math.max(0, mark.y - 110), width: 900, height: 220 } }); }
  const marks = await p.evaluate(() => { const st = document.getElementById('aish-hl-styles'); return st ? st.textContent.match(/#[0-9a-f]{6}/gi) : null; });
  console.log(JSON.stringify({ heights }));
  assert(heights.every(x => Math.abs(x.h - heights[0].h) <= 1), 'the panel keeps the height of All: ' + JSON.stringify(heights));
  assert.deepEqual(heights.map(x => x.cards), [3, 1, 2], 'only the chosen cards are shown');
  assert(heights.every(x => x.clickable === 0), 'the sizer copy has no actions');
  console.log(JSON.stringify({ split, panel, closed, bar, card, menu, marks, errs }, null, 1));
  assert(split.adopted >= 1 && split.visible === 'visible', 'inPage.css adopted and the host is shown');
  assert.equal(split.theme, dark ? 'dark' : 'light', 'theme from the settings');
  assert(/Hanken Grotesk/.test(split.font), 'brand font stack');
  assert.deepEqual(panel.radios, ['All · 3', 'Yours · 1', 'AI · 2']);
  assert.equal(panel.cards.length, 3); assert.equal(panel.summarize, 1, 'one Summarize');
  assert(closed, 'Esc closes'); assert(bar && bar.n === 3, 'selection toolbar'); assert(card, 'composer');
  assert.deepEqual(menu, ['⭐ Keep', '✕ Dismiss'], 'mark menu');
  assert.deepEqual([...new Set(marks.map((m) => m.toLowerCase()))].sort(), ['#0284c7', '#0c4a6e', '#713f12', '#e0f2fe', '#eab308', '#fef9c3'], 'marks use the token colours');
  assert.deepEqual(errs, []);
  await ctx.close(); srv.close();
  console.log('E2E in-page-tools OK');
})().catch((e) => { console.error(e); process.exit(1); });
