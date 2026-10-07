import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { w, store } = setup({}); const d = w.document;
chrome.runtime.id = 'x';
globalThis.requestIdleCallback = (f) => setTimeout(f, 0);
d.body.innerHTML = `<nav>the market nav</nav><article>
<p>Analysts say the market will cool in autumn. Rates stay high and the market reacts slowly to news.</p>
<p>In conclusion, the market is not a bubble but a correction.</p></article>`;
const H = await imp('content/highlighter.js');
H.setHighlightingEnabled(true, true);
const p2 = d.querySelectorAll('article p')[1].firstChild; const at = p2.nodeValue.indexOf('the market');
const r = d.createRange(); r.setStart(p2, at); r.setEnd(p2, at + 10);
const ann = H.applyHighlightFromRange(r, 'the market');
assert(ann && ann.quote && ann.quote.prefix.endsWith('In conclusion, '), 'context stored');
await tick(30);
assert.equal(store.annotations.length, 1); assert.equal(store.annotations[0].v, 2);
// reload simulation: clear painted state, restore from storage
H.clearHighlightElements(); assert.equal(d.querySelectorAll('mark').length, 0);
H.restoreAnnotations(); await tick(60);
const marks = [...d.querySelectorAll('mark.ai-user-highlight')];
assert.equal(marks.length, 1, 'exactly one highlight'); assert.equal(marks[0].textContent, 'the market');
assert(marks[0].closest('p').textContent.startsWith('In conclusion'), 'restored on the 3rd occurrence, not the first');
// legacy text-only annotation → first occurrence in article (never the nav), upgraded with context
H.clearHighlightElements();
store.annotations = [{ url: store.annotations[0].url, text: 'the market', type: 'user', timestamp: new Date().toISOString() }];
H.restoreAnnotations(); await tick(80);
const m2 = [...d.querySelectorAll('mark.ai-user-highlight')]; assert.equal(m2.length, 1);
assert(m2[0].closest('p').textContent.startsWith('Analysts'), 'legacy: first match inside the article');
assert(!d.querySelector('nav mark'), 'never in nav');
assert(store.annotations[0].quote && store.annotations[0].id, 'upgraded');
// ghost quotes: short+repeated dropped, unique long kept, dismissed never returns
H.clearHighlightElements(); store.annotations = [];
H.applyGhostHighlights(['the market', 'Rates stay high and the market reacts slowly to news']); await tick(60);
assert.equal(store.annotations.length, 1); assert.equal(store.annotations[0].type, 'ghost');
store.annotations[0].dismissed = true; H.clearHighlightElements(); H.restoreAnnotations(); await tick(60);
assert.equal(d.querySelectorAll('mark').length, 0, 'dismissed ghost stays away');
H.applyGhostHighlights(['Rates stay high and the market reacts slowly to news']); await tick(60);
assert.equal(store.annotations.length, 1, 'not re-created after dismiss');
// History: marked once; context picks the right occurrence
const { markHighlights } = await imp('modules/annotationExporter.js');
const anns = [{ text: 'the market', type: 'user', quote: { exact: 'the market', prefix: 'In conclusion, ', suffix: ' is not a bubble' } },
              { text: 'costs fall 40% yearly', type: 'ghost' }];
const placed = new Set();
const content = markHighlights('<p>Analysts say the market will cool. In conclusion, the market is not a bubble. Study: costs fall 40% yearly.</p>', anns, placed);
const summary = markHighlights('<p>Summary: costs fall 40% yearly.</p>', anns, placed);
assert.equal((content.match(/<mark/g) || []).length, 2); assert(/In conclusion, <mark[^>]*>the market<\/mark>/.test(content), content);
assert.equal((summary.match(/<mark/g) || []).length, 0, 'not doubled in summary');
console.log('TEST 40 OK');
