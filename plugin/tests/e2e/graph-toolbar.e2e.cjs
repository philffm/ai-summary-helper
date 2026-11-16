// Graph toolbar (Figma AISH-038 D) in Chromium (dev build): one row (Graph | List | Gaps · Research · Adjust), canvas tools
// on the right, the color legend pill, the Adjust panel (Unread + Time), path mode. Usage:
// node plugin/tests/e2e/graph-toolbar.e2e.cjs plugin/dev/aish-extension-chrome [shotDir]
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert');
const TAGS = [['sleep', 'memory', 'research'], ['sleep', 'health'], ['memory', 'learning'], ['learning', 'school', 'research'], ['health', 'food'], ['food', 'climate'], ['climate', 'energy'], ['energy', 'policy'], ['policy', 'school'], ['memory', 'sleep', 'health']];
(async () => {
  const ext = path.resolve(process.argv[2] || 'plugin/dev/aish-extension-chrome');
  const shots = process.argv[3];
  const dark = process.argv.includes('--dark');
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-gt-')), { headless: false, args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox'], viewport: { width: 760, height: 640 }, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light' });
  let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  await sw.evaluate(async (TAGS) => {
    const now = Date.now();
    const arts = TAGS.map((tags, i) => ({ id: 'a' + i, title: 'Article ' + (i + 1) + ' about ' + tags[0], url: 'https://example.com/' + i, summary: '<p>Summary ' + i + '</p>', tags, timestamp: new Date(now - i * 20 * 864e5).toISOString(), opened: i % 3 === 0, ...(i < 3 ? { paperOverride: 'yes' } : {}) }));
    await chrome.storage.local.set({ 'articles:index': arts });
    for (const a of arts) await chrome.storage.local.set({ ['article:' + a.id]: a });
    await chrome.storage.sync.set({ onboardingComplete: true, onboardingDone: true, iconStyle: 'icons' });
  }, TAGS);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`chrome-extension://${id}/popup.html`); await p.waitForTimeout(1200);
  await p.evaluate(() => { document.querySelector('[data-screen="history"], #historyTab, #tabHistory')?.click(); });
  await p.waitForTimeout(600);
  await p.evaluate(() => document.getElementById('graphToggleBtn')?.click());
  await p.waitForSelector('#graphContainer .graph-tools', { timeout: 8000 });
  await p.waitForTimeout(1500);
  const g = (fn) => p.evaluate(fn);
  const row = await g(() => {
    const c = document.getElementById('graphContainer');
    return { segs: [...c.querySelectorAll('.graph-layout-toggle button, [role=radiogroup] button, .graph-mode button')].map((b) => b.textContent.trim()).slice(0, 4),
      research: c.querySelector('.graph-research-chip')?.textContent.trim(), adjust: c.querySelector('.graph-adjust-btn')?.textContent.trim(),
      tools: [...c.querySelectorAll('.graph-tools .graph-tool')].map((b) => b.getAttribute('aria-label')),
      pill: c.querySelector('.graph-color-pill')?.textContent.trim(), oldChips: c.querySelectorAll('.graph-path-chip,.graph-save-chip,.graph-unread-chip,.graph-color-chip,.graph-time-chip').length };
  });
  if (shots) await p.screenshot({ path: path.join(shots, `gt-1-toolbar${dark ? '-dark' : ''}.png`) });
  await p.click('#graphContainer .graph-research-chip'); await p.waitForTimeout(500);
  const researchOn = await g(() => document.querySelector('#graphContainer .graph-research-chip')?.textContent.trim());
  await p.click('#graphContainer .graph-research-chip'); await p.waitForTimeout(500);
  await p.click('#graphContainer .graph-adjust-btn'); await p.waitForTimeout(250);
  const adj = await g(() => { const pn = document.querySelector('#graphContainer .graph-adjust'); return { open: !pn.hidden, text: pn.textContent.replace(/\s+/g, ' ').trim().slice(0, 200), unread: !!pn.querySelector('.graph-unread-toggle'), time: !!pn.querySelector('.graph-time-track') }; });
  await p.click('#graphContainer .graph-unread-toggle + .slider-toggle').catch(() => p.evaluate(() => document.querySelector('#graphContainer .graph-unread-toggle').click()));
  await p.waitForTimeout(400);
  if (shots) await p.screenshot({ path: path.join(shots, `gt-2-adjust${dark ? '-dark' : ''}.png`) });
  const adjLabel = await g(() => document.querySelector('#graphContainer .graph-adjust-btn').textContent.trim());
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  const closed = await g(() => document.querySelector('#graphContainer .graph-adjust').hidden);
  await p.click('#graphContainer .graph-color-pill'); await p.waitForTimeout(200);
  if (shots) await p.screenshot({ path: path.join(shots, `gt-3-color${dark ? '-dark' : ''}.png`) });
  const colorOpen = await g(() => !document.querySelector('#graphContainer .graph-color-pop')?.hidden);
  await p.keyboard.press('Escape');
  await p.click('#graphContainer .graph-tool--route'); await p.waitForTimeout(250);
  if (shots) await p.screenshot({ path: path.join(shots, `gt-4-path${dark ? '-dark' : ''}.png`) });
  const pathBar = await g(() => { const b = document.querySelector('#graphContainer .graph-pathbar'); return b && getComputedStyle(b).display !== 'none' ? b.textContent.trim() : null; });
  await p.click('#graphContainer .graph-pathbar-cancel'); await p.waitForTimeout(150);
  const pathOff = await g(() => getComputedStyle(document.querySelector('#graphContainer .graph-pathbar')).display === 'none');
  await p.click('#graphContainer .graph-tool--plus'); await p.click('#graphContainer .graph-tool--maximize');
  console.log(JSON.stringify({ researchOn, row, adj, adjLabel, closed, colorOpen, pathBar, pathOff, errs }, null, 1));
  assert.equal(row.tools.length, 7, 'seven canvas tools'); assert.equal(row.oldChips, 0, 'old chips gone');
  assert(row.research === '🎓 Research' && /Research · 3/.test(researchOn) && row.adjust && row.pill, 'research, adjust, color pill');
  assert(adj.open && adj.unread && adj.time, 'Adjust has Unread and Time'); assert(/·\s*1/.test(adjLabel), 'Adjust counts the filter');
  assert(closed && colorOpen && pathBar && pathOff);
  assert.deepEqual(errs, []);
  await ctx.close();
  console.log('E2E graph-toolbar OK');
})().catch((e) => { console.error(e); process.exit(1); });
