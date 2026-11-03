// A tag's English name is the tag itself in English, never a broader topic: the model's broader word ("Germany" → "geopolitics") becomes a
// broader topic and the name stays literal. Translations are kept, codes are not sent, and a saved run can be undone.
// The first block is a real preview from a local model (shown with an archive-topic list in the prompt), kept as a regression case.
import { setup, tick } from './harness.mjs'; import assert from 'assert';
import path from 'path'; import { pathToFileURL } from 'url';
const { w } = setup({});
globalThis.document = w.document; globalThis.window = w;
const load = (rel) => import(pathToFileURL(path.join(process.env.AISH_SRC, rel)).href);
const tc = await load('modules/topicConcepts.js');
const ai = await load('modules/feedAi.js');
const gn = await load('modules/graphTagNaming.js');

// ── the real preview: English tags, a model that answered with broader words ──
const rows = 'ContentPollution→sociology|RadioIsDead→technology|Behavioral Science→psychology|Income→labor market|AI in Software Development→software development;Software engineering,Ai|Computer Science Education→education;Software development|Food Policy→policy|Legal Battles→policy|corporate communication→corporate culture|human resources→labor market|EmpathyDrivenDesign→uxdesign;Psychology,Productdesign|Germany→geopolitics|Ursula K. Le Guin→culture|UXForAll→uxdesign|habits→personal growth'.split('|');
const tags = [], names = [];
rows.forEach(r => { const [t, rest] = r.split('→'); const [en, br] = rest.split(';'); tags.push(t); names.push({ en, ui: null, ...(br ? { broader: br.split(',') } : {}) }); });
const fixed = ai.keepLiteral(tags, names, { english: new Set(tags) });
const byTag = Object.fromEntries(tags.map((t, k) => [t, fixed[k]]));
assert.equal(byTag.Germany.en, 'germany'); assert.deepEqual(byTag.Germany.broader, ['geopolitics'], 'Germany stays Germany, geopolitics is its broader topic');
assert.equal(byTag.habits.en, 'habits'); assert.deepEqual(byTag.habits.broader, ['personal growth']);
assert.equal(byTag['Food Policy'].en, 'food policy', 'a name that drops words of the tag is a broader word');
assert.equal(byTag['corporate communication'].en, 'corporate communication', 'spelled alike, but another topic');
assert.equal(byTag.ContentPollution.en, 'content pollution', 'a hashtag-style tag is written as words');
assert.equal(byTag['AI in Software Development'].en, 'ai in software development');
assert.deepEqual(byTag['AI in Software Development'].broader, ['software development', 'Software engineering'], 'the model\'s word first, then its broader topics, at most two');
assert.equal(byTag.UXForAll.en, 'ux for all');
assert.deepEqual(tags.filter((t, k) => !fixed[k].kept), [], 'every one of the 15 was corrected');

// ── what is left alone ──
const keep = ai.keepLiteral(
    ['KI-Regulierung', 'Soziologie', 'Wirtschaft', 'AI', 'habit', 'Behaviour change', 'Geldwäsche'],
    [{ en: 'ai regulation' }, { en: 'sociology' }, { en: 'economy' }, { en: 'artificial intelligence' }, { en: 'habits' }, { en: 'behavior change' }, { en: 'money laundering' }],
    { english: new Set(['AI', 'habit', 'Behaviour change']) });
assert.deepEqual(keep.map(r => r.en), ['ai regulation', 'sociology', 'economy', 'artificial intelligence', 'habits', 'behavior change', 'money laundering'],
    'translations, the same built-in topic, an abbreviation written out and small spelling changes are kept: ' + keep.map(r => r.en));
assert.ok(keep.every(r => !r.kept));
const deTag = ai.keepLiteral(['Lebensmittelpolitik', 'Ernährungspolitik in der EU'], [{ en: 'food policy' }, { en: 'food policy' }], {});
assert.equal(deTag[0].en, 'food policy', 'a German tag translated is left alone (its language is not English)');
assert.equal(ai.keepLiteral(['Politics of food'], [{ en: 'politics' }], {})[0].kept, true, 'a built-in broad topic that the tag is not is caught even when the language is unknown');

// ── the prompt and the reply ──
let system = '', user = '';
ai.setAiTransport(async (r) => { system = r.system; user = r.user; return '1:Content pollution (broader: Media) | 2:-'; });
const r = await ai.nameTags(['ContentPollution', 'Other'], { broaderVocab: ['Media', 'Policy'], english: new Set(['ContentPollution']) });
assert.ok(/translated literally/.test(system) && /NEVER replace a tag by a broader topic/.test(system), 'the prompt asks for the tag itself');
assert.ok(/for these broader topics only, prefer words from this list when one fits; otherwise use your own: Media, Policy/.test(system), 'the list is for the broader topics only');
assert.ok(/\[1\] Content Pollution/.test(user), 'the tag is sent as words, so it is read as words');
assert.deepEqual(r.names[0], { en: 'content pollution', ui: null, broader: ['Media'] });
assert.equal(r.names[1], null, '"2:-" means no topic, nothing is learned for it');
ai.setAiTransport(null);

// ── long names are not cut, a dash is no name ──
const long = ai.parseTagNames('1:Covert influence operations (broader: Geopolitics) | 2:Rick Rescorla = - (broader: -) | 3:Climate feedback loops in the arctic', 3);
assert.equal(long[0].en, 'covert influence operations', 'not cut at 24 characters');
assert.deepEqual([long[1].en, long[1].ui, long[1].broader], ['rick rescorla', null, undefined], 'a dash is neither a translation nor a broader topic');
assert.equal(long[2].en, 'climate feedback loops in the arctic', 'up to the 40 the lexicon keeps');
assert.ok(/a second one only if it fits just as clearly, one is often enough/.test(system), 'the prompt does not push for a second broader topic');

// ── codes are not sent, English tags are known by their articles' language ──
const arts = [
    { id: 'a', tags: ['7f8c8d', '#ff0000', '12345', 'Germany', '🌐 en'] },
    { id: 'b', tags: ['Germany', 'KI-Regulierung', '🌐 de'] },
    { id: 'c', tags: ['Germany', '🌐 de', '🌐 en'] },
    { id: 'd', tags: ['KI-Regulierung', '🌐 de'] }
];
tc.setLexicon({});
assert.deepEqual(gn.tagsToName(arts).sort(), ['Germany', 'KI-Regulierung'], 'colour values and numbers are no topics');
const en = gn.englishTagsOf(arts);
assert.ok(en.has('Germany') && !en.has('KI-Regulierung'), 'the last language mark is the summary language: Germany is English, KI-Regulierung German');
assert.deepEqual(tc.filterBroader('germany', ['Uncategorized', 'Technology', 'Geopolitics', 'germany']), ['geopolitics'], 'catch-alls, categories and the tag itself are no broader topics');

// ── undo after saving ──
tc.setLexicon({ church: { en: 'Church', '*': ['Kirche'] } });
const before = JSON.stringify(tc.getLexicon());
ai.setAiTransport(async ({ user: u }) => u.split('\n').map((l, k) => `${k + 1}:${l.replace(/^\[\d+\]\s*/, '')} (broader: Society)`).join(' | '));
const box = w.document.createElement('div'); w.document.body.append(box);
let dones = [];
await gn.openTagNamingPage(box, { articles: [{ id: 'x', tags: ['Gemeinde', 'Kirche'] }], onDone: (n) => dones.push(n) }, { ai, route: { service: '', local: true, label: 'local' }, saveLexicon: async () => {} });
const page = box.querySelector('.graph-naming-page');
page.querySelector('.graph-naming-try').click();
for (let i = 0; i < 50 && !page.querySelector('.graph-naming-row'); i++) await tick(5);
page.querySelector('.graph-naming-save-first').click();
for (let i = 0; i < 50 && !dones.length; i++) await tick(5);
assert.notEqual(JSON.stringify(tc.getLexicon()), before, 'saved');
const undo = page.querySelector('.graph-naming-undo');
assert.ok(!undo.hidden, 'Undo is offered after saving');
undo.click();
for (let i = 0; i < 50 && dones.length < 2; i++) await tick(5);
assert.equal(JSON.stringify(tc.getLexicon()), before, 'the lexicon is back to what it was');
assert.deepEqual(dones, [2, 0], 'and the graph is told to redraw both times');
ai.setAiTransport(null);
console.log('literal names ok');
