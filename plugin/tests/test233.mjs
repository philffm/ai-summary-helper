// Learned tag names in the settings: a name or its broader topics can be changed after saving, an entry forgotten (its tags are then
// unnamed again), and a rename onto an existing name joins the two.
import { setup, tick } from './harness.mjs'; import assert from 'assert';
import path from 'path'; import { pathToFileURL } from 'url';
const { w } = setup({});
const d = w.document;
globalThis.document = d; globalThis.window = w;
const load = (rel) => import(pathToFileURL(path.join(process.env.AISH_SRC, rel)).href);
const tc = await load('modules/topicConcepts.js');
const le = await load('modules/lexiconEditor.js');
const gn = await load('modules/graphTagNaming.js');

tc.setLexicon({
    'covert influence operati': { en: 'Covert influence operati', '*': ['Verdeckte Einflussnahme'], '>': ['geopolitics'] },
    'covert influence operations': { en: 'Covert influence operations', '*': ['covert influence ops'] },
    'church': { en: 'Church', de: 'Kirche', '*': ['Kirche'] },
    'parish': { en: 'Parish', '*': ['Gemeinde'], '>': ['religion'] }
});
const list = le.learnedEntries();
assert.deepEqual(list.map(e => e.en), ['Church', 'Covert influence operati', 'Covert influence operations', 'Parish']);
assert.deepEqual(le.filterEntries(list, 'kirche').map(e => e.key), ['church'], 'search finds a tag by any spelling');
assert.deepEqual(le.filterEntries(list, 'religion').map(e => e.key), ['parish'], 'and by a broader topic');

// rename onto an existing name: one topic
assert.equal(le.renameLearned('covert influence operati', 'covert influence operations'), 'covert influence operations');
assert.equal(tc.conceptKey('Verdeckte Einflussnahme'), tc.conceptKey('covert influence ops'), 'both spellings are one topic now');
assert.deepEqual(tc.broaderKeysOf('Verdeckte Einflussnahme'), [tc.conceptKey('geopolitics')], 'the broader topic came along');
assert.ok(!tc.getLexicon()['covert influence operati']);
assert.equal(le.renameLearned('church', 'church'), null, 'the same name changes nothing');

// broader topics
assert.ok(le.setLearnedBroader('church', ['Religion', 'Society', 'church']));
assert.deepEqual(tc.broaderKeysOf('Kirche'), [tc.conceptKey('religion')], 'a category and the topic itself are dropped');

// forget: unnamed again
assert.ok(le.forgetLearned('parish'));
assert.deepEqual(gn.tagsToName([{ tags: ['Gemeinde', 'Kirche'] }]), ['Gemeinde'], 'a forgotten name is asked again');

// the list in the settings
const box = d.createElement('div'); d.body.append(box);
let saves = 0, changes = 0;
le.mountLexiconEditor(box, { save: async () => { saves++; }, onChange: () => { changes++; } });
assert.equal(box.querySelectorAll('.lexicon-row').length, 2);
assert.ok(/2 learned names/.test(box.querySelector('.lexicon-info').textContent));
const church = box.querySelector('.lexicon-row[data-key="church"]');
assert.ok(/Kirche/.test(church.querySelector('.lexicon-tags').textContent), 'the row shows the tags it names');
const en = church.querySelector('.lexicon-en'); en.value = 'Churches'; en.dispatchEvent(new w.Event('change'));
await tick(5);
assert.equal(tc.conceptKey('Kirche'), tc.conceptKey('churches')); assert.equal(saves, 1); assert.equal(changes, 1);
const br = church.querySelector('.lexicon-broader'); br.value = 'Religion, Architecture'; br.dispatchEvent(new w.Event('change'));
await tick(5);
assert.deepEqual(tc.broaderKeysOf('Kirche'), [tc.conceptKey('religion'), tc.conceptKey('architecture')], 'the row keeps working after a rename');
church.querySelector('.lexicon-forget').click();
await tick(5);
assert.equal(box.querySelectorAll('.lexicon-row').length, 1); assert.ok(/1 learned name/.test(box.querySelector('.lexicon-info').textContent));
const s = box.querySelector('.lexicon-search'); s.value = 'nothing like it'; s.dispatchEvent(new w.Event('input'));
assert.equal(box.querySelectorAll('.lexicon-row').length, 0);
// many entries: shown in pages
const big = {}; for (let i = 0; i < 130; i++) big['topic ' + i] = { en: 'Topic ' + i };
tc.setLexicon(big);
const box2 = d.createElement('div'); d.body.append(box2);
le.mountLexiconEditor(box2);
assert.equal(box2.querySelectorAll('.lexicon-row').length, 60);
box2.querySelector('.lexicon-more').click();
assert.equal(box2.querySelectorAll('.lexicon-row').length, 120);
console.log('learned names ok');
