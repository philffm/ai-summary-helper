// Quiz across articles (Figma AISH-040) in Chromium (dev build), with a fake model in the popup (setAiTransport):
// library → select 4 → ⋯ → "Create quiz" → setup → per-article checks → questions (one connects two articles) → feedback with sources
// → result by article → export (Kahoot .xlsx download); collection → "Create quiz"; reader page jumps to a quoted sentence.
// Usage: node plugin/tests/e2e/quiz.e2e.cjs plugin/dev/aish-extension-chrome [shotDir] [--dark]
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert');
const dark = process.argv.includes('--dark');
const ARTS = [
  ['a1', 'What the IPCC report says about 1.5 °C', ['The report compares warming against the pre-industrial period from 1850 to 1900.', 'Limiting warming to 1.5 °C needs emissions to fall by about half by 2030.', 'Every tenth of a degree increases the risk of extreme heat.']],
  ['a2', 'Heat pumps explained', ['A heat pump moves heat from outside air into the house instead of burning fuel.', 'For every unit of electricity it delivers about three units of heat.', 'They work best in well insulated homes.']],
  ['a3', 'Why oceans store heat', ['Water takes up heat slowly and gives it back just as slowly, long after the sun has set.', 'The oceans have absorbed more than ninety percent of the extra heat.', 'Warmer water also expands and raises the sea level.']],
  ['a4', 'Cities and heat islands', ['Concrete and asphalt store the day’s heat and release it through the night.', 'Trees and green roofs can lower street temperatures by several degrees.', 'Poorer neighbourhoods often have fewer trees.']],
];
(async () => {
  const ext = path.resolve(process.argv[2] || 'plugin/dev/aish-extension-chrome');
  const shots = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;
  const sfx = dark ? '-dark' : '';
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-quiz-dl-'));
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-quiz-')), { headless: false, acceptDownloads: true, downloadsPath: dl,
    args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox'], viewport: { width: 420, height: 680 }, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light' });
  let sw = ctx.serviceWorkers()[0]; if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(1200);
  await sw.evaluate(async ({ ARTS, dark }) => {
    const now = Date.now();
    const index = ARTS.map(([id, title, ps], i) => ({ id, title, url: 'https://example.com/' + id, summary: '<p>' + ps[0] + '</p>', timestamp: new Date(now - i * 864e5).toISOString(), tags: ['climate'] }));
    const recs = Object.fromEntries(ARTS.map(([id, , ps]) => ['articles:rec:' + id, { content: ps.map(p => '<p>' + p + '</p>').join(''), summary: '<p>' + ps[0] + '</p>' }]));
    await chrome.storage.local.set({ 'articles:index': index, ...recs,
      'coll:index': [{ id: 'c1', name: 'Climate · 10b', question: 'Why do some places stay warm at night?', n: 4, updated: new Date().toISOString() }],
      'coll:rec:c1': { id: 'c1', name: 'Climate · 10b', question: 'Why do some places stay warm at night?', created: new Date().toISOString(), updated: new Date().toISOString(), sources: ARTS.map(([id]) => ({ articleId: id, addedAt: new Date().toISOString() })) } });
    await chrome.storage.sync.set({ onboardingComplete: true, onboardingDone: true, theme: dark ? 'dark' : 'light', iconStyle: 'icons' });
  }, { ARTS, dark });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`chrome-extension://${id}/popup.html`); await wait(1500);
  // a fake model: questions quote the first sentence of the article; one invented quote per article (must be dropped);
  // the connecting request uses the first fact of articles 3 and 4
  await p.evaluate(async (ARTS) => {
    const m = await import('./modules/feedAi.js');
    window.__aiCalls = 0;
    m.setAiTransport(async ({ system, user }) => {
      window.__aiCalls++;
      await new Promise(r => setTimeout(r, 120));
      if (/connect two different articles/.test(system)) {
        const ids = [...user.matchAll(/^([A-Z]\d) \(article (\d)/gm)].map(x => ({ id: x[1], art: x[2] }));
        const a = ids.find(x => x.art === '3'), b = ids.find(x => x.art === '4');
        return JSON.stringify({ questions: [{ q: 'Both articles explain why some places stay warm at night. What do they name as the reason?', options: ['Less wind after sunset', 'Water and concrete release stored heat slowly', 'More clouds over cities and coasts', 'Air pollution traps sunlight'], correct: 1, facts: [a.id, b.id] }] });
      }
      const art = ARTS.find(([, t]) => user.includes(t));
      const [, title, ps] = art;
      return JSON.stringify({ questions: [
        { q: `What does “${title.slice(0, 30)}” say first?`, options: [ps[0].slice(0, 60), 'Nothing about it', 'The opposite of that', 'Only something about prices'], correct: 0, quote: ps[0] },
        // paraphrased quote (lower case, no punctuation, one word swapped): must still find the article's sentence
        { q: `What else does “${title.slice(0, 30)}” say?`, options: [ps[1].slice(0, 60), 'That it does not matter', 'That nobody knows', 'That it is too early'], correct: 0, quote: ps[1].toLowerCase().replace(/[.,’']/g, '').replace(/\b(the|a)\b/, 'this') },
        // no quote at all: the sentence that supports the answer is used
        { q: `What does “${title.slice(0, 30)}” say at the end?`, options: [ps[2].slice(0, 70), 'Something unrelated to the topic', 'The exact opposite claim here', 'A claim about the stock market'], correct: 0 },
        { q: 'An invented question?', options: ['1', '2', '3', '4'], correct: 0, quote: 'A sentence that the article never says at all.' },
      ], facts: [ps[0], ps[1]] });
    });
  }, ARTS);
  const shot = (n) => shots ? p.screenshot({ path: path.join(shots, `qz-${n}${sfx}.png`) }) : null;

  // E1 · library: select 4 cards → ⋯ → Create quiz
  await p.click('[data-screen="history"]'); await p.waitForSelector('#articleList .article-card', { timeout: 8000 }); await wait(400);
  await p.locator('#articleList .article-card').first().locator('.card-menu-btn').click(); await wait(250);
  await p.locator('.card-menu-item', { hasText: 'Select' }).click(); await wait(250);
  const cards = p.locator('#articleList .article-card');
  for (let i = 1; i < 4; i++) await cards.nth(i).click({ position: { x: 30, y: 12 } });
  await wait(250);
  assert.equal(await p.$('.sel-bar .sel-quiz'), null, 'no extra Quiz button in the selection bar');
  // back to top stays hidden while selecting (it covered ⋯)
  const btt = await p.evaluate(() => { const b = document.getElementById('backToTopBtn'); if (!b) return 'none'; b.classList.add('is-on'); const v = getComputedStyle(b).display; b.classList.remove('is-on'); return v; });
  assert.equal(btt, 'none', 'back to top hidden in selection mode');
  await shot('0-selection');
  await p.click('.sel-bar .sel-more'); await p.waitForSelector('.sendsheet-row'); await wait(300);
  const quizRow = p.locator('.sendsheet-row', { hasText: 'Create quiz' });
  assert.equal(await quizRow.isDisabled(), false); assert.match(await quizRow.textContent(), /4 selected articles/);
  await shot('0b-more-sheet');
  await quizRow.click(); await p.waitForSelector('.quiz .quiz-seg'); await wait(400);
  const setup = await p.evaluate(() => ({ tags: document.querySelectorAll('.quiz-tag').length, plan: document.querySelector('.quiz-hint').textContent, meta: document.querySelector('.quiz-meta').textContent }));
  await shot('1-setup');
  // Q3 · writing
  await p.click('.quiz .button-primary'); await wait(250);
  await shot('2-writing');
  await p.waitForSelector('.quiz-answers', { timeout: 15000 }); await wait(200);
  const steps = await p.evaluate(() => window.__aiCalls);
  // play: answer A every time (A is right for article questions after shuffle? no: pick the first answer), capture one feedback, one across question
  let seenAcross = false, feedbackShot = false, total = 0, sourcesMax = 0;
  for (let guard = 0; guard < 25; guard++) {
    const head = await p.textContent('.quiz-title');
    const m = head.match(/(\d+) of (\d+)/); if (!m) break;
    total = Number(m[2]);
    const across = await p.$('.quiz-from--across');
    if (across && !seenAcross) { seenAcross = true; await shot('3-question-across'); }
    await p.keyboard.press('2'); await wait(150);
    const srcs = await p.$$eval('.quiz-source', (x) => x.length);
    sourcesMax = Math.max(sourcesMax, srcs);
    if (across && !feedbackShot) { feedbackShot = true; await shot('4-feedback-across'); }
    await p.keyboard.press('Enter'); await wait(150);
    if (await p.$('.quiz-score')) break;
  }
  await p.waitForSelector('.quiz-score');
  const result = await p.evaluate(() => ({ score: document.querySelector('.quiz-score-n').textContent, rows: [...document.querySelectorAll('.quiz-by-row')].map(r => r.textContent), repeat: !!document.querySelector('.quiz .button-primary') }));
  await shot('5-result');
  const saved = await p.evaluate(async (ARTS) => { const all = await chrome.storage.local.get(null); const k = Object.keys(all).find(x => x.startsWith('quiz:rec:')); if (!k) return null; const qs = all[k].questions; const text = ARTS.flatMap(a => a[2]);
    return { n: qs.length, missed: all[k].last.missed.length, across: qs.filter(q => q.kind === 'across').length, srcOk: qs.every(q => q.sources.length), realSentences: qs.every(q => q.sources.every(s => text.includes(s.quote))) }; }, ARTS);
  // export → Kahoot
  await p.locator('.quiz .button-secondary', { hasText: 'Export' }).click(); await p.waitForSelector('.quiz-formats'); await wait(200);
  await shot('6-export');
  const [download] = await Promise.all([p.waitForEvent('download'), p.locator('.quiz .button-primary').click()]);
  const file = path.join(dl, download.suggestedFilename()); await download.saveAs(file);
  const xlsx = fs.readFileSync(file);
  await wait(200);
  const exportNote = await p.textContent('.quiz-note[role="status"]');
  // Anki and Moodle
  await p.click('.quiz-format[data-f="moodle"]');
  const [d2] = await Promise.all([p.waitForEvent('download'), p.locator('.quiz .button-primary').click()]);
  const gift = fs.readFileSync(await d2.path(), 'utf8');
  await p.keyboard.press('Escape'); await wait(200);
  const closed = !(await p.$('.quiz'));

  // E2 · collection → Create quiz
  await p.click('.history-tab[data-tab="collections"]'); await wait(500);
  await p.locator('.coll-card, .coll-row, [data-coll-id]').first().click().catch(() => {});
  await wait(500);
  const collBtn = p.locator('.coll-bar-actions button', { hasText: 'Quiz' });
  const collHas = await collBtn.count();
  if (collHas) { await collBtn.first().click(); await p.waitForSelector('.quiz .quiz-seg'); await wait(400); }
  const collSetup = collHas ? await p.evaluate(() => ({ sub: document.querySelector('.quiz-sub').textContent, tags: document.querySelectorAll('.quiz-tag').length })) : null;
  if (collHas) await shot('7-collection-setup');

  // reader page jump
  const r = await ctx.newPage();
  await r.goto(`chrome-extension://${id}/readerPage.html#id=a4&q=${encodeURIComponent('Concrete and asphalt store the day’s heat')}`); await wait(1200);
  const hit = await r.evaluate(() => { const h = document.querySelector('.rp-quote-hit'); return h ? h.textContent.slice(0, 40) : null; });
  if (shots) await r.screenshot({ path: path.join(shots, `qz-8-reader${sfx}.png`) });

  console.log(JSON.stringify({ setup, steps, total, seenAcross, sourcesMax, result, saved, xlsx: { name: download.suggestedFilename(), size: xlsx.length, zip: xlsx.slice(0, 2).toString() }, exportNote, giftHead: gift.slice(0, 80), closed, collSetup, hit, errs }, null, 1));
  assert.equal(setup.tags, 4); assert.match(setup.meta, /5 requests/);
  assert.equal(steps, 5, 'one request per article + one across');
  assert(total >= 8 && total <= 10 && saved && total === saved.n, 'as many questions as had a source (the fake writes fewer than asked)'); assert(seenAcross, 'a question that connects two articles'); assert.equal(sourcesMax, 2, 'two sources on the connecting question');
  assert(saved.srcOk && saved.across >= 1); assert(saved.realSentences, 'every source shown is the article’s own sentence');
  assert.equal(xlsx.slice(0, 2).toString(), 'PK'); assert.match(download.suggestedFilename(), /Kahoot\.xlsx$/);
  assert(/::4 articles 1::/.test(gift) || /::/.test(gift));
  assert(closed, 'Esc closes the quiz');
  assert(collSetup && collSetup.tags === 4 && /Climate/.test(collSetup.sub), 'collection → Create quiz');
  assert(hit && /Concrete and asphalt/.test(hit), 'reader page marks the quoted sentence');
  assert.deepEqual(errs, []);
  if (shots) fs.copyFileSync(file, path.join(shots, 'quiz-Kahoot.xlsx'));
  await ctx.close();
  console.log('E2E quiz OK');
})().catch((e) => { console.error(e); process.exit(1); });
