// Research mode phase 1: paper detection (meta / JSON-LD / hosts / DOI text), index flags, override, badges, markdown frontmatter.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w, store } = setup({}); const d = w.document;
const { detectPaper, normalizeDoi, paperIndexFields } = await imp('content/paper.js');
const popupBody = d.body.innerHTML;
const loc = (u) => { const x = new URL(u); return { href: x.href, hostname: x.hostname, pathname: x.pathname, origin: x.origin }; };
const page = (head, body = '') => { d.head.innerHTML = head; d.body.innerHTML = body; };
// DOI normalisation
assert.equal(normalizeDoi('https://doi.org/10.1038/s41562-026-0000-0.'), '10.1038/s41562-026-0000-0');
assert.equal(normalizeDoi('doi:10.1000/xyz123)'), '10.1000/xyz123'); assert.equal(normalizeDoi('no doi here'), '');
// publisher meta → yes + details
page('<meta name="citation_title" content="Sleep and memory"><meta name="citation_journal_title" content="Nature Human Behaviour"><meta name="citation_doi" content="10.1038/s41562-026-0000-0"><meta name="citation_author" content="Smith, J."><meta name="citation_author" content="Lee, K."><meta name="citation_author" content="Rao, P."><meta name="citation_author" content="Zed, Q."><meta name="citation_publication_date" content="2026/03/02">');
let p = detectPaper(d, loc('https://www.nature.com/articles/s41562-026-0000-0'));
assert.deepEqual(p, { state: 'yes', doi: '10.1038/s41562-026-0000-0', journal: 'Nature Human Behaviour', year: '2026', authors: 'Smith, J.; Lee, K.; Rao, P. et al.' });
assert.deepEqual(paperIndexFields(p), { paper: 'yes', doi: '10.1038/s41562-026-0000-0', paperAuthors: 'Smith, J.; Lee, K.; Rao, P. et al.' });
// arXiv: preprint
page('<meta name="citation_title" content="Scaling laws"><meta name="citation_arxiv_id" content="2610.00000"><meta name="citation_author" content="Chen, W.">');
p = detectPaper(d, loc('https://arxiv.org/abs/2610.00000'));
assert(p.state === 'yes' && p.preprint === true); assert.equal(paperIndexFields(p).preprint, true);
// JSON-LD ScholarlyArticle
page('<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite"},{"@type":["ScholarlyArticle"],"headline":"X","identifier":{"propertyID":"doi","value":"10.1234/abc.5"},"datePublished":"2025-01-02","isPartOf":{"name":"J. Testing"}}]}</script>');
p = detectPaper(d, loc('https://example.org/paper/5'));
assert(p.state === 'yes' && p.doi === '10.1234/abc.5' && p.journal === 'J. Testing' && p.year === '2025');
// known host without meta → likely; plain blog → null; broken JSON-LD never throws
page('<script type="application/ld+json">{oops</script>');
assert.equal(detectPaper(d, loc('https://pubmed.ncbi.nlm.nih.gov/123/')).state, 'likely');
assert.equal(detectPaper(d, loc('https://myblog.example/post')), null);
// DOI in text: only with an abstract-like opening → likely; a blog quoting a DOI → null
page('', '<p>Abstract. We study X. doi:10.5555/foo.bar</p>');
assert.deepEqual(detectPaper(d, loc('https://uni.example/x')), { state: 'likely', doi: '10.5555/foo.bar' });
page('', '<p>Great read, see 10.5555/foo.bar for details.</p>');
assert.equal(detectPaper(d, loc('https://blog.example/x')), null);
// collectPageMeta carries it; index gets the lean flags
page('<meta name="citation_title" content="T"><meta name="citation_doi" content="10.1234/abc">');
const core = await imp('content/core.js');
const meta = core.collectPageMeta(d, loc('https://pub.example/a'));
assert.equal(meta.paper.doi, '10.1234/abc');
const { SK } = await imp('modules/storageKeys.js');
const saved = await core.saveToLocalStorage('<p>c</p>', '<p>s</p>', 'https://pub.example/a', 'T', '', [], 'm', 200, undefined, paperIndexFields(meta.paper), meta);
assert(store[SK.articlesIndex][0].paper === 'yes' && store[SK.articlesIndex][0].doi === '10.1234/abc' && !('meta' in store[SK.articlesIndex][0]));
// popup side: state, override, chips, toggle, links
const PI = await imp('modules/paperInfo.js');
const A = { paper: 'yes', doi: '10.1234/abc' };
assert.equal(PI.paperState(A), 'yes'); assert.equal(PI.paperState({ ...A, paperOverride: 'no' }), null);
assert.equal(PI.paperState({ paperOverride: 'yes' }), 'yes'); assert.equal(PI.paperState({ paper: 'likely' }), 'likely'); assert.equal(PI.paperState({}), null);
assert.deepEqual(PI.paperChips(A), [['ok', '🎓 Paper · DOI ✓']]);
assert.deepEqual(PI.paperChips({ paper: 'yes' }), [['ok', '🎓 Paper']]);
assert.deepEqual(PI.paperChips({ paper: 'likely' }), [['mut', '🎓 Likely paper']]);
assert.deepEqual(PI.paperChips({ paper: 'yes', preprint: true }).map(x => x[1]), ['🎓 Preprint', '⚠ Not peer-reviewed']);
assert.deepEqual(PI.paperChips({ title: 'x' }), []);
assert.deepEqual(PI.paperToggle({}), { label: '🎓 Mark as paper', value: 'yes' }); assert.equal(PI.paperToggle(A).value, 'no');
assert.equal(PI.doiUrl('10.1/abc'), ''); assert.equal(PI.doiUrl('10.1038/s41562-026-0000-0'), 'https://doi.org/10.1038/s41562-026-0000-0');
assert.equal(PI.doiUrl('javascript:alert(1)'), ''); assert.equal(PI.doiUrl('10.1234/x"onmouseover="y'), '');
assert.equal(PI.paperLine({ meta: { paper: { authors: 'Smith; Lee et al.', journal: 'Nature', year: '2026' } } }), 'Smith; Lee et al. · Nature · 2026');
// override persists on the index entry via patchArticleStatus
const { default: SM } = await imp('modules/storageManager.js');
const id = store[SK.articlesIndex][0].id;
assert(await SM.patchArticleStatus([id], { paperOverride: 'no' })); assert.equal(store[SK.articlesIndex][0].paperOverride, 'no');
assert(await SM.patchArticleStatus([id], { paperOverride: null })); assert(!('paperOverride' in store[SK.articlesIndex][0]));
// Summarize bubble shows the badge (live bubble: from meta.paper)
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
chrome.runtime.getURL = (x) => 'chrome-extension://abc/' + x;
chrome.tabs = { query: async () => [], sendMessage: (i, m, cb) => cb && cb({}), onActivated: { addListener() {} }, onUpdated: { addListener() {} } };
store[SK.articlesIndex] = [{ id: 'p1', title: 'Paper', url: 'https://x.org/p', timestamp: '2026-10-01T10:00:00Z', summary: '<p>s</p>', paper: 'yes', doi: '10.1234/abc' }, { id: 'n1', title: 'News', url: 'https://x.org/n', timestamp: '2026-10-02T10:00:00Z', summary: '<p>s</p>' }];
store['articles:rec:p1'] = { content: 'c', summary: '<p>s</p>' }; store['articles:rec:n1'] = { content: 'c', summary: '<p>s</p>' };
d.body.innerHTML = popupBody; d.head.innerHTML = '';
const MS = await imp('modules/mainScreen.js');
MS.initMainScreen({ showScreen() {} }); await tick(120);
const bs = [...d.querySelectorAll('#summaryFeed .summary-bubble')];
assert(/Paper · DOI/.test(bs[0].textContent) && !/Paper/.test(bs[1].querySelector('.bubble-tags')?.textContent || ''), 'bubble badge only on the paper');
console.log('TEST 62 OK'); process.exit(0);
