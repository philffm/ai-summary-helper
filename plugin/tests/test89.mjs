// Saved pages are untrusted: History cards, the detail view and the graph preview escape titles, decision notes and model ids, and clean stored HTML.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { store, w } = setup({});
const d = w.document;
const X = '<img src=x onerror="window.__pwned=1">';
store['articles:index'] = [{
  id: 'a1', url: 'https://x.com/1', title: 'Title ' + X, timestamp: new Date().toISOString(), modelId: 'model ' + X, summaryLength: '200' + X,
  summary: '<h2>Sum</h2><p onclick="x()">Point <a href="javascript:alert(1)">link</a></p><script>bad()</script><style>body{display:none}</style>',
  tags: [], isDecision: true, decisionTimeframe: 'week ' + X, decisionReason: 'because ' + X
}];
store['articles:rec:a1'] = { content: '<p style="position:fixed">Body</p><iframe src="https://evil.example"></iframe><form action="https://evil.example"><input></form><img src="https://img.example/a.png" onerror="x()"><a href="https://ok.example">ok</a>' };
globalThis.MutationObserver = w.MutationObserver; globalThis.IntersectionObserver = globalThis.IntersectionObserver || class { observe(){} disconnect(){} }; globalThis.ResizeObserver = globalThis.ResizeObserver || class { observe(){} disconnect(){} };
const noHandlers = (root, where) => {
  for (const el of root.querySelectorAll('*')) for (const a of el.attributes) assert(!/^on/i.test(a.name), `${where}: ${a.name} on <${el.tagName}>`);
};

// 1. the cleaner on its own
const TU = await imp('modules/textUtils.js');
const doc = new w.DOMParser().parseFromString('<p onclick=x style="color:red">a</p><script>s()</script><link rel=stylesheet href=//e><meta http-equiv=refresh content="0;url=//e"><a href="javascript:x()">j</a><a href="https://ok">k</a><img src="data:image/png;base64,AA"><svg><a xlink:href="javascript:x()">s</a></svg>', 'text/html');
TU.cleanUntrustedHtml(doc.body);
const out = doc.body.innerHTML;
assert(!/script|<link|<meta|onclick|style=|javascript:/i.test(out), 'cleaned: ' + out);
assert(/href="https:\/\/ok"/.test(out) && /rel="noopener noreferrer"/.test(out) && /target="_blank"/.test(out), 'safe link kept, opens outside');
assert(/src="data:image\/png/.test(out), 'inline image kept');

// 2. History card
const am = await imp('modules/articleManager.js');
am.initArticleManager({ showToast() {}, showScreen() {} });
am.renderArticles(store['articles:index']); await tick(80);
const card = d.querySelector('#articleList .article-card');
assert(card, 'card rendered');
assert(!card.querySelector('img[src="x"]'), 'no markup from title/decision/model in the card');
assert(card.textContent.includes('Title <img') && card.textContent.includes('week <img') && card.textContent.includes('because <img') && card.textContent.includes('model <img'), 'shown as text');
assert(card.querySelector('.card-decision .decision-chip') && !card.querySelector('.card-decision [style], .card-model[style]'), 'decision/model use classes');

// 3. detail view
await am.showArticleDetail({ ...store['articles:index'][0], ...store['articles:rec:a1'] }); await tick(80);
const det = d.querySelector('.article-detail-card');
assert(det, 'detail rendered');
assert(!det.querySelector('img[src="x"], script, style, iframe, form, input'), 'no injected elements: ' + det.innerHTML.slice(0, 300));
noHandlers(det, 'detail');
assert(!det.querySelector('a[href^="javascript"]'), 'no javascript: links');
assert(!det.querySelector('.detail-original-body [style]'), 'page inline styles dropped');
assert(det.querySelector('.detail-original-body img[src="https://img.example/a.png"]'), 'page images kept');
assert(det.querySelector('.detail-title').textContent.includes('Title <img'), 'title as text');
assert(det.querySelector('.detail-decision .decision-chip').textContent.includes('week <img'), 'timeframe as text');
assert(det.querySelector('.summary-box h2') && /Point/.test(det.querySelector('.summary-box').textContent), 'summary markup kept');

// 4. graph preview card
const ag = await imp('modules/archiveGraph.js');
const host = d.createElement('div'); d.body.appendChild(host);
ag.__test_showPreviewCard(host, { title: 'G ' + X, summary: '<p>Graph &lt;img src=y onerror=z&gt; summary</p>', tags: ['t' + X], timestamp: new Date().toISOString() });
await tick(30);
const pc = host.querySelector('.graph-preview-card');
assert(pc && !pc.querySelector('img'), 'no markup in the preview card');
noHandlers(pc, 'preview');
assert(pc.textContent.includes('G <img') && pc.textContent.includes('Graph <img src=y'), 'title and summary as text');
assert.equal(w.__pwned, undefined);
console.log('ok');
