// Deleting articles (AISH-032 · A4 app-wide): no window.confirm; a sheet says what is deleted and what stays (highlights,
// notes), Cancel keeps everything, the article disappears at once, Undo brings it back, and storage is only touched when
// the Undo window ends. Bulk delete works the same way.
import { setup, tick, SRC, answerSheets, flushUndo, pressUndo } from './harness.mjs'; import assert from 'assert'; import path from 'path'; import { pathToFileURL } from 'url';
const { store, w } = setup({});
const d = w.document;
const href = (p) => pathToFileURL(path.join(SRC, p)).href;
const { SK, articleRecKey } = await import(href('modules/storageKeys.js'));
const now = Date.now();
store[SK.articlesIndex] = ['a1', 'a2', 'a3'].map((id, i) => ({ id, url: 'https://x.test/' + id, title: 'Article ' + id, timestamp: new Date(now - i * 1000).toISOString(), summary: '<p>s</p>', tags: [] }));
['a1', 'a2', 'a3'].forEach(id => { store[articleRecKey(id)] = { content: '<p>c</p>' }; });
chrome.runtime.sendMessage = (m, cb) => { if (cb) { cb({}); return; } return Promise.resolve({}); };
for (const k of ['MutationObserver', 'IntersectionObserver', 'requestIdleCallback', 'cancelIdleCallback']) { if (w[k] && !globalThis[k]) globalThis[k] = w[k].bind ? w[k].bind(w) : w[k]; }
globalThis.MutationObserver = w.MutationObserver;
w.confirm = () => { throw new Error('no window.confirm'); }; globalThis.confirm = w.confirm;
const am = await import(href('modules/articleManager.js'));
am.initArticleManager({ showToast() {}, showScreen() {} });
am.loadHistory(); await tick(400);
const shown = () => [...d.querySelectorAll('#articleList li.article-card')].map(li => li.dataset.id || li.dataset.articleId).filter(Boolean);
const titles = () => [...d.querySelectorAll('#articleList li.article-card h4')].map(h => h.textContent);
assert.equal(titles().length, 3);

// Cancel
const sheets = answerSheets(w, false);
assert.equal(await am.removeArticle({ id: 'a1' }), false, 'cancelled');
assert.equal(sheets.asked, 1);
assert.ok(store[articleRecKey('a1')], 'nothing deleted');
// the sheet says what stays
sheets.answer = true; const s = sheets;
const p = am.removeArticle({ id: 'a1' });
await tick(5);
const sheet = d.querySelector('.confirm-sheet:not([data-gone])');
assert.ok(sheet && /highlights and notes stay/i.test(sheet.textContent), 'says what stays');
assert.ok(/undo/i.test(sheet.textContent), 'says it can be undone');
assert.equal(await p, true);
await tick(150);
assert.ok(!titles().some(t => t.includes('Article a1')), 'gone from the list at once');
assert.ok(store[articleRecKey('a1')], 'still in storage during the Undo window');
pressUndo(d); await tick(200);
assert.ok(titles().some(t => t.includes('Article a1')), 'Undo brings it back');
// bulk: two at once, then the window runs out
assert.equal(await am.removeMany(['a1', 'a2']), true); await tick(150);
assert.equal(titles().length, 1);
await flushUndo(); await tick(100);
assert.ok(!store[articleRecKey('a1')] && !store[articleRecKey('a2')], 'deleted from storage after the window');
assert.deepEqual(store[SK.articlesIndex].map(a => a.id), ['a3']);
assert.ok(s.asked >= 2);
console.log('TEST 239 OK'); process.exit(0);
