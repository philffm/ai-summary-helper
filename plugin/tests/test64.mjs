// Research phase 2: SCHOLARLY comment merge, Research tab + type filters, DOI/author search, key facts.
import assert from 'assert';
import fs from 'fs';
import { setup, imp } from './harness.mjs';
const { w } = setup({}); const d = w.document;
const { applyScholarly, paperIndexFields } = await imp('content/paper.js');
// AI-only detection (PDF / site without metadata)
let p = applyScholarly(null, '{"scholarly":true,"type":"Randomized controlled trial","design":"RCT","sample":"n=120","limitations":"short follow-up"}');
assert.equal(p.state, 'likely'); assert.equal(p.type, 'trial'); assert.equal(p.facts.sample, 'n=120');
assert.deepEqual(paperIndexFields(p), { paper: 'likely', paperType: 'trial' });
// page said "likely" + model confirms → yes; model denies → dropped; strong page signal survives a denial
assert.equal(applyScholarly({ state: 'likely', doi: '10.1234/abc' }, { scholarly: true, type: 'study' }).state, 'yes');
assert.equal(applyScholarly({ state: 'likely' }, '{"scholarly":false}'), null);
assert.equal(applyScholarly({ state: 'yes', doi: '10.1234/abc' }, '{"scholarly":false}').state, 'yes');
assert.equal(applyScholarly(null, '{"scholarly":false}'), null);
assert.deepEqual(applyScholarly({ state: 'yes' }, 'garbage'), { state: 'yes' });   // unparsable keeps page signals
assert.equal(applyScholarly(null, '{"scholarly":true,"type":"systematic review"}').type, 'review');
// popup helpers
const { paperChips, paperType, paperFacts, paperSearchText } = await imp('modules/paperInfo.js');
const art = { paper: 'yes', doi: '10.1234/abc', paperType: 'review', paperAuthors: 'Smith, J.', meta: { paper: { state: 'yes', type: 'review', facts: { design: 'Meta-analysis', sample: '12 studies' } } } };
assert.equal(paperType(art), 'review');
assert(paperChips(art).some(c => c[1] === 'Review'));
assert.equal(paperFacts(art).length, 2);
assert(paperSearchText(art).includes('10.1234/abc') && paperSearchText(art).includes('smith'));
assert.equal(paperSearchText({ title: 'x' }), '');
// wiring
const ct = fs.readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
assert(/SCHOLARLY/.test(ct) && /applyScholarly\(/.test(ct) && /replace\(\/<!--\\s\*SCHOLARLY/.test(ct));
assert.equal((ct.match(/\$\{scholarlyAsk\}/g) || []).length, 2);
const am = fs.readFileSync(new URL('../src/modules/articleManager.js', import.meta.url), 'utf8');
assert(/\['research'/.test(am) && /RESEARCH_FILTERS/.test(am) && /paperSearchText\(a\)/.test(am));
// on-demand key facts
const { extractPaperFacts } = await imp('modules/paperInfo.js');
const out = await extractPaperFacts({ id: 'x', content: '<p>We ran a trial of 120 people.</p>', title: 'T', paper: 'yes' }, async () => '{"scholarly":true,"type":"trial","design":"RCT","sample":"n=120","limitations":"short"}', 'German').catch(e => e);
assert(out instanceof Error ? /./.test(out.message) : out.facts.sample === 'n=120', String(out));
assert(/paper-facts-btn/.test(am));
console.log('test64 ok');
