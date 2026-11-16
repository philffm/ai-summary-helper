// Article detail tabs: Summary · Links · Notes · Article. One panel at a time, the last picked tab is kept for the next article (when it
// has it), Links shows once links are found (with a count), arrow keys move between tabs, read-aloud/contents switch to the right tab.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { store, w } = setup({});
const d = w.document;
globalThis.MutationObserver = w.MutationObserver; globalThis.IntersectionObserver = globalThis.IntersectionObserver || class { observe(){} disconnect(){} }; globalThis.ResizeObserver = globalThis.ResizeObserver || class { observe(){} disconnect(){} };
const iso = new Date().toISOString();
const withLinks = { id: 'a1', url: 'https://news.example/story', title: 'Story', timestamp: iso, summary: '<p>The short version.</p>', tags: [],
  content: '<p>According to <a href="https://study.example/paper">a new study</a>, sleep helps.</p><h2>Part one</h2><p>Body one.</p><p>See <a href="https://other.example/x">this report</a> too.</p>' };
const noLinks = { id: 'a2', url: 'https://news.example/two', title: 'Two', timestamp: iso, summary: '<p>Second.</p>', tags: [], content: '<p>Plain text only.</p>' };
store['articles:index'] = [withLinks, noLinks].map(({ content, ...x }) => x);
const am = await imp('modules/articleManager.js');
am.initArticleManager({ showToast() {}, showScreen() {} });

const tab = (n) => d.querySelector(`.detail-tabs [data-tab="${n}"]`);
const panel = (n) => d.getElementById('detailPanel' + n[0].toUpperCase() + n.slice(1));
const shown = () => ['summary', 'links', 'notes', 'article'].filter(n => panel(n) && !panel(n).hidden);

await am.showArticleDetail({ ...withLinks }); await tick(150);
assert.equal(d.querySelector('.detail-tabs').getAttribute('role'), 'tablist');
assert.deepEqual(shown(), ['summary'], 'opens on Summary');
assert.equal(tab('summary').getAttribute('aria-selected'), 'true');
assert(!tab('links').hidden, 'links found → Links tab');
assert.equal(tab('links').querySelector('.detail-tab-n').textContent, '2', 'with the number of links');
assert(!d.querySelector('details.detail-original'), 'the original is a tab now, not a collapsed section');

tab('article').click();
assert.deepEqual(shown(), ['article']);
assert(panel('article').textContent.includes('Body one.'), 'the full article');
// keyboard: → wraps to Summary, ← goes back
tab('article').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
assert.deepEqual(shown(), ['summary']);
tab('summary').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
assert.deepEqual(shown(), ['article']);

// the next article opens on the same tab
await am.showArticleDetail({ ...noLinks }); await tick(150);
assert.deepEqual(shown(), ['article'], 'last tab kept');
assert(tab('links').hidden, 'no links → no Links tab');

// a remembered Links tab falls back to Summary when the article has none, and comes back when it does
await am.showArticleDetail({ ...withLinks }); await tick(150);
tab('links').click(); assert.deepEqual(shown(), ['links']);
await am.showArticleDetail({ ...noLinks }); await tick(150);
assert.deepEqual(shown(), ['summary'], 'falls back to Summary');
await am.showArticleDetail({ ...withLinks }); await tick(150);
assert.deepEqual(shown(), ['links'], 'Links again once they are found');

// notes tab: always there for a saved article
tab('notes').click(); assert.deepEqual(shown(), ['notes']);

// contents / read-aloud reveal the tab a heading lives in
tab('summary').click();
const rt = await imp('modules/readingTools.js');
const heads = rt.collectHeadings(d.getElementById('articleDetailContent'));
assert(heads.some(h => h.text === 'Part one'), 'headings of the article are in the contents');
const h2 = heads.find(h => h.text === 'Part one').el;
const p = h2.closest('[role="tabpanel"]');
d.querySelector(`[role="tab"][aria-controls="${p.id}"]`).click();
assert.deepEqual(shown(), ['article']);
console.log('TEST 264 OK'); process.exit(0);
