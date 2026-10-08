// Attach a PDF in the popup: extracted there, sent as `attachment`, summarized by the content script instead of the open tab.
import assert from 'assert';
import fs from 'fs';
import { setup, imp, tick } from './harness.mjs';
const { w, store } = setup({});
const d = w.document;
const read = (f) => fs.readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
const ct = read('content.js'), ms = read('modules/mainScreen.js'), px = read('content/pdfExtractor.js');
// content script: attachment bypasses page reading and uses a pdf:// source
assert(/attachment/.test(ct) && /pdf:\/\/attached\//.test(ct));
assert(/if \(attached\) \{\s*contentHtml = String\(attached\.html/.test(ct));
assert(/if \(!attached \|\| pageMatch\) \{ try \{ pageMeta = collectPageMeta/.test(ct), 'page meta only for a matching page');
assert(!/window\.location\.href, articleTitle/.test(ct), 'saves under the attachment url');
assert(/export async function extractPdfBytes/.test(px));
// popup: chip + file input + message
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
chrome.runtime.getURL = (x) => 'chrome-extension://abc/' + x;
const sent = [];
chrome.tabs = { query: async () => [{ id: 7, url: 'https://example.com/a', title: 'Page', active: true }], sendMessage: (i, m, cb) => { sent.push(m); cb && cb({ success: true }); return Promise.resolve({ success: true }); }, onActivated: { addListener() {} }, onUpdated: { addListener() {} } };
const MS = await imp('modules/mainScreen.js');
MS.initMainScreen({ showScreen() {} }); await tick(150);
assert(d.getElementById('chipAttach') && d.getElementById('attachPdfInput'), 'attach chip');
// a non-PDF is refused with a message in the chip
const inp = d.getElementById('attachPdfInput');
Object.defineProperty(inp, 'files', { value: [{ name: 'a.txt', type: 'text/plain', size: 3, arrayBuffer: async () => new ArrayBuffer(3) }], configurable: true });
inp.dispatchEvent(new w.Event('change')); await tick(50);
assert(/not a readable PDF/.test(d.getElementById('pageCard').textContent));
d.querySelector('#pageCard .page-chip-x').click(); await tick(30);
assert(!/not a readable PDF/.test(d.getElementById('pageCard')?.textContent || ''));
// DOI page open + PDF attached: metadata from the page when it matches the PDF
const { matchPagePaper } = await imp('content/paper.js');
const loc = (u) => { const x = new URL(u); return { href: x.href, hostname: x.hostname, pathname: x.pathname }; };
d.head.innerHTML = '<title>Sleep deprivation and working memory | Nature</title><meta name="citation_title" content="Sleep deprivation and working memory: a meta-analysis"><meta name="citation_journal_title" content="Nature Human Behaviour"><meta name="citation_doi" content="10.1038/s41562-026-0000-0"><meta name="citation_author" content="Smith, J.">';
d.body.innerHTML = '<p>Paywalled. Buy access.</p>';
const pdfText = 'Sleep deprivation and working memory: a meta-analysis\nSmith J. Abstract We pooled 38 studies...';
const hit = matchPagePaper(pdfText, d, loc('https://www.nature.com/articles/s41562-026-0000-0'));
assert(hit && hit.paper.doi === '10.1038/s41562-026-0000-0' && /meta-analysis/.test(hit.title), 'title match');
assert(matchPagePaper('Quarterly invoice for office supplies, total 12 EUR', d, loc('https://www.nature.com/articles/x')) === null, 'unrelated PDF is not merged');
assert(matchPagePaper('Some text mentioning 10.1038/s41562-026-0000-0 only', d, loc('https://www.nature.com/articles/x')) !== null, 'DOI in the PDF matches');
d.head.innerHTML = ''; d.body.innerHTML = '<p>A blog post</p>';
assert.equal(matchPagePaper(pdfText, d, loc('https://blog.example/x')), null, 'not a paper page');
console.log('TEST 67 OK'); process.exit(0);
