// Highlight anchoring: Nth occurrence of a quote, index rebuild after reload, legacy text-only highlights.
import { setup, imp } from './harness.mjs'; import assert from 'assert';
const { w } = setup({}); const d = w.document;
const A = await imp('content/anchor.js');
d.body.innerHTML = `<nav><a>the market teaser</a></nav>
<main><article>
<blockquote data-aish-ui="1">Key: the market is a bubble</blockquote>
<h1>Title</h1>
<p>Analysts say the market will cool in autumn.
   Rates stay high and the market reacts slowly to news.</p>
<p>In conclusion, the market is not a bubble but a “correction”.</p>
</article></main><footer>the market footer</footer>`;
const root = A.ancScopeRoot(d); assert.equal(root.tagName, 'ARTICLE');
const idx = A.ancBuildIndex(root);
assert(!idx.text.includes('teaser') && !idx.text.includes('footer') && !idx.text.includes('Key:'), 'skips nav/footer/own UI: ' + idx.text);
assert(idx.text.includes('autumn. Rates'), 'whitespace collapsed');
assert.equal(A.ancOccurrences(idx, 'the market').length, 3);
// select the 3rd occurrence
const tn = [...d.querySelectorAll('article p')][1].firstChild;
const r = d.createRange(); const at = tn.nodeValue.indexOf('the market'); r.setStart(tn, at); r.setEnd(tn, at + 10);
const sel = A.ancMakeSelector(idx, r);
assert.equal(sel.exact, 'the market'); assert(sel.prefix.endsWith('In conclusion, '), JSON.stringify(sel));
// rebuild index (as after reload) and resolve: must be the 3rd, not the 1st
const idx2 = A.ancBuildIndex(root); const res = A.ancResolve(idx2, sel);
const rr = A.ancToRange(idx2, res.start, res.end);
assert.equal(rr.startContainer, tn); assert.equal(rr.startOffset, at); assert.equal(rr.toString(), 'the market'); assert.equal(res.ambiguous, false);
// legacy (text only) → first occurrence, flagged ambiguous
const leg = A.ancResolve(idx2, { text: 'the market' }); assert.equal(leg.ambiguous, true); assert(leg.start < res.start);
// curly quotes + spanning blocks
const q = A.ancResolve(idx2, { text: 'not a bubble but a "correction".' }); assert(q && !q.ambiguous);
const span = A.ancResolve(idx2, { text: 'slowly to news. In conclusion' }); assert(span, 'across blocks');
assert.equal(A.ancToRange(idx2, span.start, span.end).toString().replace(/\s+/g, ' ').includes('news.'), true);
// lost
assert.equal(A.ancResolve(idx2, { exact: 'does not exist anywhere' }), null);
// ghost quotes: short+repeated dropped, long repeated kept, unique kept
assert.equal(A.ancQuoteUsable(idx2, 'the market'), null);
assert.equal(A.ancQuoteUsable(idx2, 'Rates stay high and the market reacts slowly'), 'Rates stay high and the market reacts slowly');
console.log('TEST 39 OK');
