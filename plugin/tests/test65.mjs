// Research phase 3: citations from registry data (CSL JSON) in APA / MLA / Chicago / BibTeX / RIS, reference list, doi lookup.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
setup({});
const { cleanCsl, formatCitation, formatList, fetchCsl, bibKey, CITE_STYLES } = await imp('modules/citation.js');
const wire = { type: 'article-journal', title: ['Sleep deprivation and working memory: A meta-analysis'], author: [{ family: 'Smith', given: 'Jane' }, { family: 'Lee', given: 'Kai-Ming' }, { family: 'Rao', given: 'Priya' }], 'container-title': 'Nature Human Behaviour', volume: '10', issue: '3', page: '412-425', DOI: '10.1038/s41562-026-0000-0', issued: { 'date-parts': [[2026, 3, 2]] } };
const c = cleanCsl(wire);
assert.equal(c.year, '2026'); assert.equal(c.title, wire.title[0]);
assert.equal(formatCitation(c, 'apa'), 'Smith, J., Lee, K.-M., & Rao, P. (2026). Sleep deprivation and working memory: A meta-analysis. Nature Human Behaviour, 10(3), 412–425. https://doi.org/10.1038/s41562-026-0000-0');
assert.equal(formatCitation(c, 'mla'), 'Smith, Jane, et al. “Sleep deprivation and working memory: A meta-analysis.” Nature Human Behaviour, vol. 10, no. 3, 2026, pp. 412–425. https://doi.org/10.1038/s41562-026-0000-0');
assert.equal(formatCitation(c, 'chicago'), 'Smith, Jane, Kai-Ming Lee, and Priya Rao. 2026. “Sleep deprivation and working memory: A meta-analysis.” Nature Human Behaviour 10 (3): 412–425. https://doi.org/10.1038/s41562-026-0000-0');
const bib = formatCitation(c, 'bibtex');
assert(bib.startsWith('@article{smith2026sleep,') && /author = \{Smith, Jane and Lee, Kai-Ming and Rao, Priya\}/.test(bib) && /pages = \{412--425\}/.test(bib) && /doi = \{10\.1038/.test(bib));
const r = formatCitation(c, 'ris');
assert(/^TY {2}- JOUR/.test(r) && /AU {2}- Smith, Jane/.test(r) && /SP {2}- 412/.test(r) && /EP {2}- 425/.test(r) && /ER {2}- $/.test(r));
assert.equal(CITE_STYLES.length, 5);
// markup in registry text is stripped; list sorts and can carry summaries
const evil = cleanCsl({ title: 'A <img src=x onerror=1>study', author: [{ family: 'Zed<b>', given: 'Q' }], DOI: '10.1234/x' });
assert(!/[<>]/.test(evil.title + evil.author[0].family));
const list = formatList([{ csl: c, summary: '<p>Short summary.</p>' }, { csl: cleanCsl({ title: 'Another', author: [{ family: 'Adams', given: 'B' }], issued: { 'date-parts': [[2025]] } }) }], 'apa', { summaries: true });
assert(list.indexOf('Adams') < list.indexOf('Smith') && /\n {4}Short summary\./.test(list));
assert(/annote = \{Short summary\.\}/.test(formatList([{ csl: c, summary: 'Short summary.' }], 'bibtex', { summaries: true })));
// lookup: validated DOI, Accept header, errors
let seen;
const ok = async (u, o) => { seen = [u, o.headers.Accept]; return { ok: true, json: async () => wire }; };
assert.equal((await fetchCsl('10.1038/s41562-026-0000-0', ok)).year, '2026');
assert.equal(seen[0], 'https://doi.org/10.1038/s41562-026-0000-0'); assert(/csl\+json/.test(seen[1]));
await assert.rejects(() => fetchCsl('not a doi', ok));
await assert.rejects(() => fetchCsl('10.1234/x', async () => ({ ok: false, status: 404 })));
console.log('test65 ok');
