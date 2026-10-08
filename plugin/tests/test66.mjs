// Research phase 3 UI: Cite block in the detail view, reference list in the send sheet.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { store, w } = setup({});
const iso = (d) => new Date(Date.now() - d).toISOString();
const wire = { type: 'article-journal', title: 'Sleep and memory', author: [{ family: 'Smith', given: 'Jane' }], container: 'Nature', volume: '1', issue: '2', page: '3-4', DOI: '10.1038/s41562-026-0000-0', year: '2026' };
store['articles:index'] = [
 { id: 'a1', url: 'https://x.com/1', title: 'Paper one', timestamp: iso(0), summary: '<p>one</p>', tags: [], paper: 'yes', doi: '10.1038/s41562-026-0000-0' },
 { id: 'a2', url: 'https://y.com/2', title: 'News', timestamp: iso(1000), summary: '<p>two</p>', tags: [] },
 { id: 'a3', url: 'https://y.com/3', title: 'Paper no doi', timestamp: iso(2000), summary: '<p>3</p>', tags: [], paper: 'likely' },
];
store['articles:rec:a1'] = { content: 'c', summary: '<p>one</p>', meta: { paper: { state: 'yes', doi: '10.1038/s41562-026-0000-0', csl: wire } } };
store['articles:rec:a2'] = { content: 'c', summary: '<p>two</p>' };
store['articles:rec:a3'] = { content: 'c', summary: '<p>3</p>' };
w.fetch = globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true }) });
globalThis.MutationObserver = w.MutationObserver;
const copied = []; Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (t) => copied.push(t) }, configurable: true });
const am = await imp('modules/articleManager.js');
const toasts = []; const ui = { showToast: (m) => toasts.push(m), showScreen() {} };
am.initArticleManager(ui);
am.loadHistory(); await tick(150);
const d = w.document;
// detail: cite block with cached citation
await am.showArticleDetail({ ...store['articles:index'][0] }); await tick(100);
let cb = d.querySelector('.cite-block');
assert(cb && /Smith, J\. \(2026\)\. Sleep and memory\. Nature, 1\(2\), 3–4\./.test(cb.querySelector('.cite-text').textContent), cb && cb.textContent);
const cs = cb.querySelector('select.cite-style'); cs.value = [...cs.options].find(o => o.textContent === 'BibTeX').value; cs.dispatchEvent(new w.Event('change', { bubbles: true }));
assert(/^@article\{smith2026sleep,/.test(d.querySelector('.cite-text').textContent));
d.querySelector('.cite-actions .cite-copy').click(); await tick(20);
assert(copied.length === 1 && /^@article/.test(copied[0]));
assert.equal(store['ui:citeStyle'], 'bibtex', 'chosen citation style is remembered');
await am.showArticleDetail({ ...store['articles:index'][0] }); await tick(100);
assert.equal(d.querySelector('select.cite-style').value, 'bibtex', 'and used the next time a paper opens');
// tag row: 🎓 chip first, then tags; tags removable and addable; paper chip removable
let tr = d.querySelector('.detail-tags');
assert(tr && tr.firstChild.classList.contains('paper'), 'paper chip leads the tag row');
store['articles:index'][1].tags = ['Alpha', 'Beta'];
await am.showArticleDetail({ ...store['articles:index'][1] }); await tick(100);
tr = d.querySelector('.detail-tags');
assert.deepEqual([...tr.querySelectorAll('.tag-chip:not(.tag-add)')].map(c => c.textContent.replace('✕', '')), ['Alpha', 'Beta']);
[...tr.querySelectorAll('.tag-chip')].find(c => c.textContent.startsWith('Alpha')).querySelector('.tag-x').click(); await tick(60);
assert.deepEqual(store['articles:index'][1].tags, ['Beta'], 'tag removed and stored');
d.querySelector('.detail-tags .tag-add').click();
const ti = d.querySelector('.tag-input'); ti.value = 'Gamma';
ti.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await tick(60);
assert.deepEqual(store['articles:index'][1].tags, ['Beta', 'Gamma'], 'tag added and stored');
// suggestions: built-in categories and Research paper show up; picking one adds it
d.querySelector('.detail-tags .tag-add').click();
const sg = [...d.querySelectorAll('.detail-tags .tag-suggest')].map(b => b.textContent);
assert(sg.includes('News') && sg.includes('🎓 Research paper') && !sg.includes('Gamma'), sg.join('|'));
[...d.querySelectorAll('.detail-tags .tag-suggest')].find(b => b.textContent === 'News').click(); await tick(60);
assert.deepEqual(store['articles:index'][1].tags, ['Beta', 'Gamma', 'News'], 'suggested tag added');
// mark as research paper from the + Tag row, then remove again with the chip's ✕
d.querySelector('.detail-tags .tag-add').click();
[...d.querySelectorAll('.detail-tags .tag-add')].find(b => /research paper/i.test(b.textContent)).click(); await tick(60);
assert.equal(store['articles:index'][1].paperOverride, 'yes');
assert(d.querySelector('.detail-tags').firstChild.classList.contains('paper'));
d.querySelector('.detail-tags .paper .tag-x').click(); await tick(60);
assert.equal(store['articles:index'][1].paperOverride, 'no');
// pasting a DOI into + Tag assigns it to the paper instead of creating a tag
d.querySelector('.detail-tags .tag-add').click();
const di = d.querySelector('.tag-input'); di.value = 'https://doi.org/10.1038/s41562-026-9999-1';
di.dispatchEvent(new w.Event('input', { bubbles: true }));
assert(/Assign DOI 10\.1038\/s41562-026-9999-1/.test(d.querySelector('.detail-tags .tag-suggest-paper:not([hidden])').textContent));
di.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await tick(80);
assert.equal(store['articles:index'][1].doi, '10.1038/s41562-026-9999-1');
assert.equal(store['articles:index'][1].paperOverride, 'yes');
assert(!store['articles:index'][1].tags.some(t => /10\.1038/.test(t)), 'DOI is not a tag');
// a paper without DOI: no citation, says so
await am.showArticleDetail({ ...store['articles:index'][2] }); await tick(100);
assert(/no DOI found/.test(d.querySelector('.cite-block').textContent) && !d.querySelector('.cite-text'));
// send sheet: reference list for the selected papers (a1 cached; a3 has no DOI → skipped)
am.loadHistory(); await tick(150);
d.getElementById('selectModeBtn').click(); await tick(20);
const cards = [...d.querySelectorAll('#articleList .article-card')]; cards[0].click(); cards[2].click(); await tick(20);
const bar = d.querySelector('.sel-bar');
assert(bar, 'selection bar');
bar.querySelector('.sel-send').click(); await tick(150);
const refRow = [...d.querySelectorAll('.sendsheet-row')].find(r => /Reference list/.test(r.textContent));
assert(refRow, 'reference row for selections with papers');
store['ui:citeStyle'] = 'bibtex';
refRow.click(); await tick(200);
assert(/^@article/.test(d.querySelector('.ref-preview').textContent), 'reference list opens in the remembered style');
[...d.querySelectorAll('.sendsheet-seg button, .sendsheet-segmented button')].find(b => b.textContent === 'APA 7')?.click(); await tick(30);
assert.equal(store['ui:citeStyle'], 'apa', 'choice in the reference list is remembered too');
const pv = d.querySelector('.ref-preview');
assert(pv && /Smith, J\. \(2026\)/.test(pv.textContent), pv && pv.textContent);
assert(/1 paper skipped/.test(d.querySelector('.sendsheet-body').textContent));
[...d.querySelectorAll('.sendsheet-seg-btn')].find(b => b.textContent === 'RIS').click();
assert(/TY {2}- JOUR/.test(d.querySelector('.ref-preview').textContent));
d.querySelector('.sendsheet-toggle').click();
assert(/N1 {2}- one/.test(d.querySelector('.ref-preview').textContent));
console.log('TEST 66 OK'); process.exit(0);
