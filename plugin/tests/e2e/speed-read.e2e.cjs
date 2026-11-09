// Speed-Read end to end in Chromium (dev build): a local page and a fake Ollama server; the right-click path starts the
// reader, the summary streams in, the reader reads it, pause shows the paragraph, the end card offers to close the tab,
// and the tab really closes. Usage: node plugin/tests/e2e/speed-read.e2e.cjs plugin/dev/aish-extension-chrome [shotDir]
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright');
const http = require('http'), path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert');
const SUMMARY = '## Key points\n\nSleep sorts the memories of the day. Deep sleep matters most for word pairs.\n\nThe study was small; whether it helps in daily life is open.\n\nTags: sleep, memory';
const PAGE = `<!doctype html><html lang="en"><head><title>How sleep sorts memory</title></head><body><article><h1>How sleep sorts memory</h1>${'<p>In deep sleep the brain replays the day and strengthens connections between nerve cells. Researchers in Tübingen gave volunteers word pairs to learn in the evening.</p>'.repeat(12)}</article></body></html>`;
(async () => {
  const ext = path.resolve(process.argv[2] || 'plugin/dev/aish-extension-chrome');
  const shots = process.argv[3];
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/chat') || req.url.startsWith('/api/tags')) {
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }); res.end(); return; }
      if (req.url.startsWith('/api/tags')) { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ models: [{ name: 'test' }] })); return; }
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'access-control-allow-origin': '*' });
      const parts = SUMMARY.match(/.{1,12}/gs);
      let i = 0;
      const t = setInterval(() => {
        if (i < parts.length) res.write(JSON.stringify({ model: 'test', message: { role: 'assistant', content: parts[i++] }, done: false }) + '\n');
        else { res.end(JSON.stringify({ model: 'test', message: { role: 'assistant', content: '' }, done: true }) + '\n'); clearInterval(t); }
      }, 40);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-sr-')), { headless: false, args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox'], viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 });
  let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent('serviceworker');
  await sw.evaluate(async (port) => {
    await chrome.storage.sync.set({ connectionMode: 'local', activeService: 'ollama', selectedLanguage: 'English', speedRead: { wpm: 600 } });
    await chrome.storage.local.set({ 'config:services': { ollama: { endpoint: `http://127.0.0.1:${port}/api/chat`, activeModelId: { id: 'test' } } } });
  }, port);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${port}/article`); await p.waitForTimeout(800);
  // right-click entry: the background sends { action: 'speedRead' } to the tab (injecting the content script first)
  await sw.evaluate(async () => { const [tab] = await chrome.tabs.query({ url: 'http://127.0.0.1/*' }); await sendToTab(tab.id, { action: 'speedRead' }); });
  const sr = (fn) => p.evaluate(fn);
  await p.waitForFunction(() => { const h = document.getElementById('aish-speedread-host'); return h && h.classList.contains('sr-ready'); }, null, { timeout: 8000 });
  const writing = await sr(() => document.getElementById('aish-speedread-host').shadowRoot.querySelector('.sr-status-title')?.textContent);
  if (shots) await p.screenshot({ path: path.join(shots, 'sr-1-writing.png') });
  await p.waitForFunction(() => document.getElementById('aish-speedread-host')?.shadowRoot.querySelector('.sr-word'), null, { timeout: 15000 });
  await p.waitForTimeout(600);
  if (shots) await p.screenshot({ path: path.join(shots, 'sr-2-reading.png') });
  const reading = await sr(() => { const r = document.getElementById('aish-speedread-host').shadowRoot; return { word: r.querySelector('.sr-word').textContent, pivot: !!r.querySelector('.sr-pivot'), sentence: r.querySelector('.sr-sentence').textContent, progress: r.querySelector('.sr-progress-text').textContent, bg: getComputedStyle(r.querySelector('.sr')).backgroundColor, size: getComputedStyle(r.querySelector('.sr-word')).fontSize }; });
  await p.keyboard.press('Space'); await p.waitForTimeout(200);
  if (shots) await p.screenshot({ path: path.join(shots, 'sr-3-paused.png') });
  const paused = await sr(() => { const r = document.getElementById('aish-speedread-host').shadowRoot; return { ctx: [...r.querySelectorAll('.sr-ctx')].map((b) => b.textContent), now: r.querySelector('.sr-ctx--now')?.textContent }; });
  await p.keyboard.press('f'); await p.waitForTimeout(150);
  if (shots) await p.screenshot({ path: path.join(shots, 'sr-4-fullscreen-paused.png') });
  await p.keyboard.press('f'); await p.keyboard.press('Space');
  await p.waitForFunction(() => document.getElementById('aish-speedread-host')?.shadowRoot.querySelector('.sr-done'), null, { timeout: 20000 });
  if (shots) await p.screenshot({ path: path.join(shots, 'sr-5-done.png') });
  const saved = await sw.evaluate(async () => (await chrome.storage.local.get('articles:index'))['articles:index'].map((a) => a.title));
  const closed = new Promise((r) => p.on('close', () => r(true)));
  const closedInTime = await Promise.race([closed, new Promise((r) => setTimeout(() => r(false), 8000))]);
  console.log(JSON.stringify({ writing, reading, paused, saved, closedInTime, errs }, null, 1));
  assert(reading.pivot && /Sentence 1 of/.test(reading.progress), 'reading');
  assert(paused.ctx.length >= 1 && paused.now, 'paused context');
  assert(saved.length === 1, 'article saved');
  assert(closedInTime, 'the tab closed after the countdown');
  assert.deepEqual(errs, []);
  await ctx.close(); server.close();
  console.log('E2E speed-read OK');
})().catch((e) => { console.error(e); process.exit(1); });
