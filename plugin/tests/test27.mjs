import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(12, 0, 0, 0); return d.getTime(); };
const { store, w } = setup({});
const fs = (await import('fs')).default; const SRC = process.env.AISH_SRC + '/';
globalThis.fetch = async (u) => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(SRC + u, 'utf8')) });
const i18n = await import(SRC + 'modules/i18n.js'); await i18n.applyTranslations('de');
const arts = []; for (let k = 0; k < 12; k++) arts.push({ id: 'a' + k, title: 'Art ' + k, url: 'https://s.com/' + k, timestamp: new Date(day(k)).toISOString(), tags: ['Tech'], summary: 'Summary text ' + k, summaryWordCount: 50, contentWordCount: 500, ...(k < 6 ? { moodScore: k % 2 ? 0.8 : -0.8 } : {}) });
store.articlesIndex = arts;
const mod = await import(SRC + 'modules/analyticsManager.js');
const box = w.document.createElement('div'); w.document.body.append(box);
mod.initAnalyticsReport(box, arts); await tick(50);
const txt = box.textContent;
for (const en of ['Articles', 'Day Streak', 'Words Read', 'Top Categories', 'Word Cloud', 'Time Saved']) assert.ok(!txt.includes(en), 'still English: ' + en);
assert.ok(/Artikel/.test(txt) && /Wortwolke/.test(txt) && /Stimmung im Zeitverlauf/.test(txt), txt.slice(0, 300));
assert.ok(box.querySelector('.feed-mt'), 'mood section in History');
// scoring the 6 unscored (AI mock)
globalThis.__ai = (m) => ({ ok: true, text: JSON.stringify({ scores: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5], labels: ['a', 'a', 'a', 'a', 'a', 'a'] }) });
const unscoredBtn = [...box.querySelectorAll('.feed-mt .feed-btn')].find(b => /bewerten/.test(b.textContent));
console.log('btn:', unscoredBtn && unscoredBtn.textContent);
// the current period has rated items; open day scope where today is rated? just call scoring through the API
const hm = await import(SRC + 'modules/historyMood.js');
const n = await hm.scoreArticles(arts.filter(a => typeof a.moodScore !== 'number'));
assert.equal(n, 6); assert.equal(store.articlesIndex.filter(a => typeof a.moodScore === 'number').length, 12);
console.log('TEST 27 OK');
// UI path: newest articles unscored -> n/a card with a score button; clicking scores and re-renders
const arts2 = arts.map(a => ({ ...a, moodScore: undefined })); arts2.forEach(a => delete a.moodScore);
store.articlesIndex = arts2.slice(); const box2 = w.document.createElement('div'); w.document.body.append(box2);
mod.initAnalyticsReport(box2, arts2); await tick(50);
assert.ok(/noch kein Artikel hat eine Stimmung/i.test(box2.querySelector('.feed-mt').textContent));
globalThis.__ai = () => ({ ok: true, text: JSON.stringify({ scores: Array(12).fill(0.6), labels: Array(12).fill('x') }) });
const b2 = [...box2.querySelectorAll('.feed-mt .feed-btn')].find(b => /bewerten/.test(b.textContent)); assert.ok(b2, 'score button');
b2.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await tick(300);
assert.ok(store.articlesIndex.every(a => typeof a.moodScore === 'number'), 'all scored');
assert.ok(box2.querySelector('.feed-mt-big'), 're-rendered with an index');
console.log('TEST 27b OK');
