// PDF reading: error messages, credentials + base64 transfer, %PDF check, empty-text check, paper detection from PDF text.
import assert from 'assert';
import fs from 'fs';
import { setup, imp } from './harness.mjs';
setup({});
const { detectPaperInText } = await imp('content/paper.js');
const loc = (u) => { const x = new URL(u); return { hostname: x.hostname, pathname: x.pathname }; };
let p = detectPaperInText('Title\nAbstract We study sleep. https://doi.org/10.1038/s41562-026-0000-0 Introduction', loc('https://x.org/a.pdf'));
assert.equal(p.state, 'likely'); assert.equal(p.doi, '10.1038/s41562-026-0000-0');
p = detectPaperInText('arXiv:2610.00000v1 Scaling laws', loc('https://example.org/a.pdf'));
assert.equal(p.preprint, true);
assert.equal(detectPaperInText('Invoice 2026 total 12 EUR', loc('https://x.org/i.pdf')), null);
// journal header DOI without an "Abstract" (AEA style)
p = detectPaperInText('AEA Papers and Proceedings 2018, 108: 33–37\nhttps://doi.org/10.1257/pandp.20181002\n\nQuadratic Voting: How Mechanism Design Can Radicalize Democracy†\nBy Steven P. Lalley and E. Glen Weyl*', loc('https://x.org/a.pdf'));
assert.deepEqual(p, { state: 'yes', doi: '10.1257/pandp.20181002' });
assert.equal(detectPaperInText('Intro text. ' + 'x '.repeat(900) + 'see doi.org/10.1257/pandp.20181002', loc('https://x.org/a.pdf')), null, 'a DOI far down is only a citation');
const ex = fs.readFileSync(new URL('../src/content/pdfExtractor.js', import.meta.url), 'utf8');
const bg = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
const ct = fs.readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
assert(/credentials: 'include'/.test(ex) && /credentials: 'include'/.test(bg.slice(bg.indexOf("'fetchPdfBytes'"))));
assert(/btoa\(bin\)/.test(bg) && !/Array\.from\(new Uint8Array\(buf\)\)/.test(bg.slice(bg.indexOf("'fetchPdfBytes'"), bg.indexOf("'fetchPdfBytes'") + 1500)));
assert(/%PDF/.test(ex) && /pdfError\('EMPTY'/.test(ex) && /pdfError\('PASSWORD'/.test(ex));
assert(/pdfErrorMessage\(err\)/.test(ct));
console.log('test63 ok');
