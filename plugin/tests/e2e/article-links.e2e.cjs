// Links in this article (Figma AISH-041 B) in Chromium (dev build): the section lists the article's links (sources first, with their
// sentence), "Summarize" opens the linked page in a background tab through the summary queue, a saved linked article shows its summary
// and Open, ticking it offers Collection / Quiz. (No AI here: the saved summary is written into storage, as the content script would.)
// Usage: node plugin/tests/e2e/article-links.e2e.cjs plugin/dev/aish-extension-chrome [shotDir] [--dark]
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright');
const http = require('http'), path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert');
const dark = process.argv.includes('--dark');
(async () => {
  const ext = path.resolve(process.argv[2] || 'plugin/dev/aish-extension-chrome');
  const shots = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;
  const sfx = dark ? '-dark' : '';
  const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(`<!doctype html><title>${q.url}</title><article><h1>Page ${q.url}</h1><p>${'Some text about the trials and what they found. '.repeat(30)}</p></article>`); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const B = `http://127.0.0.1:${srv.address().port}`;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-links-')), { headless: false, colorScheme: dark ? 'dark' : 'light',
    args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox'], viewport: { width: 420, height: 760 }, deviceScaleFactor: 2 });
  let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(1200);
  const content = `
    <p>Two years of trials are in. According to the <a href="${B}/reports/final-report">final report of the UK pilot</a>, 92 % of firms kept the four-day week.</p>
    <p>A study of the Icelandic trials found output stayed the same, as <a href="${B}/iceland-shorter-week">this summary</a> explains in detail.</p>
    <p>Critics point to <a href="${B}/review.pdf">a recent review</a> that calls the evidence thin and the samples small.</p>
    <p>Japan is trying it too, as <a href="${B}/news/japan">the BBC wrote</a> last month in a long piece.</p>
    <ul><li><a href="${B}/related/one">Related: what employers say</a></li></ul>
    <p><a href="https://twitter.com/intent/tweet?text=x">Share</a> <a href="${B}/subscribe">Subscribe</a></p>`;
  await sw.evaluate(async ({ content, dark }) => {
    await chrome.storage.local.set({
      'articles:index': [{ id: 'p1', title: 'Is the four-day week working? What two years of trials show', url: 'https://news.example/four-day-week', summary: '<ul><li>Trials kept output stable with fewer hours.</li><li>Most firms kept the model.</li></ul>', timestamp: new Date().toISOString(), tags: ['work'] }],
      'articles:rec:p1': { content, summary: '<ul><li>Trials kept output stable with fewer hours.</li><li>Most firms kept the model.</li></ul>' } });
    await chrome.storage.sync.set({ onboardingComplete: true, onboardingDone: true, theme: dark ? 'dark' : 'light', iconStyle: 'icons' });
  }, { content, dark });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`chrome-extension://${id}/popup.html`); await wait(1400);
  await p.click('[data-screen="history"]'); await p.waitForSelector('#articleList .article-card'); await wait(300);
  await p.locator('#articleList .article-card .article-title, #articleList .article-card h3, #articleList .article-card').first().click({ position: { x: 60, y: 16 } });
  // the detail view opens on Summary; the Links tab appears (with a count) once links are found
  await p.waitForSelector('.detail-tabs [data-tab="links"]:not([hidden])', { timeout: 8000 }); await wait(300);
  if (shots) await p.screenshot({ path: path.join(shots, `ln-0-tabs${sfx}.png`) });
  const tabsInfo = await p.evaluate(() => ({ labels: [...document.querySelectorAll('.detail-tabs [role=tab]:not([hidden])')].map(t => t.textContent), sel: document.querySelector('.detail-tabs [aria-selected=true]')?.dataset.tab }));
  if (!(tabsInfo.sel === 'summary' && tabsInfo.labels.length === 4 && /\d/.test(tabsInfo.labels[1]))) throw new Error('tabs: ' + JSON.stringify(tabsInfo));
  await p.click('.detail-tabs [data-tab="article"]'); await wait(300);
  if (shots) await p.screenshot({ path: path.join(shots, `ln-0-article${sfx}.png`) });
  await p.click('.detail-tabs [data-tab="notes"]'); await wait(300);
  if (shots) await p.screenshot({ path: path.join(shots, `ln-0-notes${sfx}.png`) });
  await p.click('.detail-tabs [data-tab="links"]');
  await p.waitForSelector('#articleLinksMount:not([hidden]) .links-row', { timeout: 8000 }); await wait(300);
  const list = await p.evaluate(() => ({
    caps: [...document.querySelectorAll('.links-cap')].map(c => c.textContent),
    first: document.querySelector('.links-row .links-ctx')?.textContent || '',
    batch: document.querySelector('.links-batch')?.textContent,
    titles: [...document.querySelectorAll('.links-t')].map(t => t.textContent),
  }));
  await p.locator('#articleLinksMount').scrollIntoViewIfNeeded();
  if (shots) await p.screenshot({ path: path.join(shots, `ln-1-list${sfx}.png`) });
  // Summarize the first source: the worker opens it in a background tab
  const tabsBefore = ctx.pages().length;
  await p.locator('.links-row').first().locator('.links-go').click();
  await wait(2500);
  const opened = ctx.pages().map(x => x.url()).filter(u => u.startsWith(B));
  const rowState = await p.evaluate(() => document.querySelector('.links-row').className);
  if (shots) await p.screenshot({ path: path.join(shots, `ln-2-running${sfx}.png`) });
  // the content script would now save the summary: write it like it does
  await sw.evaluate(async (B) => {
    const d = await chrome.storage.local.get('articles:index');
    d['articles:index'].push({ id: 'c1', title: 'UK four-day week pilot: final report', url: B + '/reports/final-report', summary: '<p>61 firms, 6 months. 92 % kept the four-day week; revenue roughly flat; sick days down 65 %.</p>', timestamp: new Date().toISOString() });
    await chrome.storage.local.set({ 'articles:index': d['articles:index'] });
  }, B);
  await p.waitForSelector('.links-row.is-done', { timeout: 8000 }); await wait(300);
  const done = await p.evaluate(() => ({ sum: document.querySelector('.links-row.is-done .links-sum').textContent, open: !!document.querySelector('.links-row.is-done .links-open') }));
  await p.locator('.links-row.is-done .links-pick').check(); await wait(200);
  const bar = await p.evaluate(() => { const b = document.querySelector('.links-selbar'); return b && !b.hidden ? b.textContent : null; });
  await p.locator('.links-row.is-done').scrollIntoViewIfNeeded();
  if (shots) await p.screenshot({ path: path.join(shots, `ln-3-done${sfx}.png`) });
  // Open goes to the linked article (with its own links section, if it has links)
  await p.locator('.links-row.is-done .links-open').click(); await wait(800);
  const openedTitle = await p.evaluate(() => document.querySelector('.detail-title')?.textContent || '');
  console.log(JSON.stringify({ list, tabsBefore, opened, rowState, done, bar, openedTitle, errs }, null, 1));
  assert.deepEqual(list.caps, ['Sources the article cites · 3', 'Mentioned in the text · 1', 'Other links · 1']);
  assert.ok(/According to the final report of the UK pilot, 92 %/.test(list.first), 'context sentence');
  assert.equal(list.batch, '✨ Summarize the 3 sources');
  assert.ok(!list.titles.includes('Share') && !list.titles.includes('Subscribe'), 'no share/subscribe links');
  assert.ok(opened.some(u => u.endsWith('/reports/final-report')), 'the linked page opened in a background tab');
  assert.ok(/is-(running|queued)/.test(rowState), 'row shows it is being summarized');
  assert.ok(/61 firms, 6 months/.test(done.sum) && done.open);
  assert.ok(bar && /1 selected, with this article/.test(bar) && /Quiz/.test(bar));
  assert.ok(/UK four-day week pilot/.test(openedTitle), 'Open shows the linked article');
  assert.deepEqual(errs, []);
  await ctx.close(); srv.close();
  console.log('E2E article-links OK');
})().catch((e) => { console.error(e); process.exit(1); });
