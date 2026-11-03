// Broader topics: asked for in the same tag naming, kept in the lexicon (never as tags), and used by the graph as weak ties, so a rare,
// specific tag that shares no article with anything sits next to what it belongs to, without a broad topic gluing a crowd together.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
import path from 'path'; import { pathToFileURL } from 'url';
const { w } = setup({});
globalThis.document = w.document; globalThis.window = w;
const load = (rel) => import(pathToFileURL(path.join(process.env.AISH_SRC, rel)).href);   // one instance, as the page uses
const tc = await load('modules/topicConcepts.js');
const ai = await load('modules/feedAi.js');
const gn = await load('modules/graphTagNaming.js');
const gs = await imp('modules/graphStructure.js');

// ── the lexicon ──
tc.setLexicon({});
tc.lexiconLearn('ai in medicine', null, 'KI in der Medizin'); tc.lexiconLearn('ai in medicine', 'en', 'AI in medicine');
assert.equal(tc.needsBroader('KI in der Medizin'), true, 'a learned topic that was never asked');
assert.equal(tc.lexiconBroader('ai in medicine', ['Artificial intelligence', 'Medicine', 'Health']), true);
assert.deepEqual(tc.broaderKeysOf('KI in der Medizin'), [tc.conceptKey('artificial intelligence'), tc.conceptKey('medicine')], 'at most two, as comparison keys');
assert.equal(tc.needsBroader('KI in der Medizin'), false);
assert.equal(tc.lexiconBroader('ai in medicine', ['Artificial intelligence', 'Medicine']), false, 'the same again changes nothing');
tc.lexiconLearn('rust tooling', 'en', 'Rust tooling');
tc.lexiconBroader('rust tooling', ['Technology', 'rust tooling', '🌐 de', 'Rust']);
assert.deepEqual(tc.broaderKeysOf('Rust tooling'), [tc.conceptKey('rust')], 'a category, the topic itself and a language mark are no broader topics');
tc.lexiconLearn('bread', 'en', 'Bread'); tc.lexiconBroader('bread', []);
assert.equal(tc.needsBroader('Bread'), false, 'an empty answer counts as asked');
assert.deepEqual(tc.broaderKeysOf('Bread'), []);
assert.equal(tc.needsBroader('News'), false, 'built-in topics need none');
assert.equal(tc.topicLabel('KI in der Medizin', 'en'), 'AI in medicine', 'the broader topics are not spellings');
assert.notEqual(tc.conceptKey('Medicine'), tc.conceptKey('KI in der Medizin'), '… and do not merge the topic with them');

// ── reading the reply ──
const parsed = ai.parseTagNames('1:AI in medicine = KI in der Medizin (broader: Artificial intelligence, Medicine) | 2:Bread = Brot | 3:Rust (broader: Software)', 3);
assert.deepEqual(parsed[0], { en: 'ai in medicine', ui: 'KI in der Medizin', broader: ['Artificial intelligence', 'Medicine'] });
assert.deepEqual(parsed[1], { en: 'bread', ui: 'Brot' }, 'no broader topics: the same shape as before');
assert.deepEqual(parsed[2], { en: 'rust', ui: null, broader: ['Software'] }, 'English UI, broader without a translation');

// ── asking: the vocabulary goes into the prompt, the answers into the lexicon ──
let lastSystem = '';
ai.setAiTransport(async ({ system, user }) => { lastSystem = system; return user.split('\n').map((l, k) => { const t = l.replace(/^\[\d+\]\s*/, ''); return t === 'Krebsforschung' ? `${k + 1}:Cancer research (broader: Medicine)` : `${k + 1}:${t}`; }).join(' | '); });
tc.setLexicon({});
await ai.learnTagNames(['Krebsforschung', 'Plain'], { broaderVocab: ['Medicine', 'Software'] });
assert.ok(/\(broader: A\)/.test(lastSystem) && /Medicine, Software/.test(lastSystem), 'the prompt asks for broader topics, from the archive\'s own topics');
assert.deepEqual(tc.broaderKeysOf('Krebsforschung'), [tc.conceptKey('medicine')]);
assert.equal(tc.needsBroader('Plain'), false, 'a tag with no broader topics is remembered as asked');

// ── the graph: rare specific tags join what they belong to ──
const build = (list) => { const nodes = [], links = [], seen = new Set();
    list.forEach(p => { nodes.push({ id: 'article-' + p.id, group: 'article', label: p.id, data: { id: p.id } });
        p.tags.forEach(t => { const id = 'tag-' + t; if (!seen.has(t)) { seen.add(t); nodes.push({ id, group: 'tag', label: t, raw: t }); } links.push({ source: 'article-' + p.id, target: id }); }); });
    return { nodes, links }; };
const relatedFor = (d) => { const broader = new Map(), key = new Map(); d.nodes.forEach(n => { if (n.group !== 'tag') return; key.set(n.id, tc.conceptKey(n.raw)); const b = tc.broaderKeysOf(n.raw); if (b.length) broader.set(n.id, b); }); return { broader, key }; };
tc.setLexicon({});
const papers = [];
for (let i = 0; i < 20; i++) papers.push({ id: 'a' + i, tags: ['zorbing', ['zorb gear', 'zorb parks'][i % 2]] });
for (let i = 0; i < 20; i++) papers.push({ id: 'b' + i, tags: ['quilting', ['quilt patterns', 'quilt fabric'][i % 2]] });
for (let i = 0; i < 30; i++) papers.push({ id: 'g' + i, tags: ['gardening', ['soil', 'compost'][i % 2]] });   // a third topic: zorbing and quilting stay below a third of the archive (above that they would be umbrella tags and tie nothing)
for (let i = 0; i < 6; i++) { const t = 'zorb trick ' + i; papers.push({ id: 'z' + i, tags: [t] }); tc.lexiconLearn(t, 'en', t); tc.lexiconBroader(t, ['zorbing']); }   // each only once, nothing in common
for (let i = 0; i < 6; i++) { const t = 'quilt stitch ' + i; papers.push({ id: 'q' + i, tags: [t] }); tc.lexiconLearn(t, 'en', t); tc.lexiconBroader(t, ['quilting']); }
const d = build(papers);
const plain = gs.topicClusters(d.nodes, d.links);
const zorbing = plain.clusterOfArticle.get('article-a0'), quilting = plain.clusterOfArticle.get('article-b0');
assert.notEqual(zorbing, quilting);
assert.ok(['z0', 'z1', 'z2'].every(id => plain.clusterOfArticle.get('article-' + id) !== zorbing), 'without broader topics the rare tags stay apart');
const tied = gs.topicClusters(d.nodes, d.links, { related: relatedFor(d) });
const zc = tied.clusterOfArticle.get('article-a0'), qc = tied.clusterOfArticle.get('article-b0');
assert.ok([0, 1, 2, 3, 4, 5].every(i => tied.clusterOfArticle.get('article-z' + i) === zc), 'with them, every rare zorb tag sits with zorbing');
assert.ok([0, 1, 2, 3, 4, 5].every(i => tied.clusterOfArticle.get('article-q' + i) === qc), 'and every rare quilt tag with quilting');
assert.notEqual(zc, qc, 'the two topics stay two');
assert.ok(tied.clusters.every(c => !/trick|stitch/.test(c.label)), 'the broad tag still names the cluster: ' + tied.clusters.map(c => c.label));

// a broader topic that many tags share, and that is no tag itself, glues none of them together
tc.setLexicon({});
const crowd = Array.from({ length: 40 }, (_, i) => ({ id: 'c' + i, tags: ['crowd tag ' + i] }));
crowd.forEach(p => { tc.lexiconLearn(p.tags[0], 'en', p.tags[0]); tc.lexiconBroader(p.tags[0], ['everything']); });
const dc = build([...crowd, ...papers.slice(0, 40)]);
const rc = gs.topicClusters(dc.nodes, dc.links, { related: relatedFor(dc) });
assert.ok(!rc.clusters.some(c => !c.other && [...c.articleIds].filter(id => id.startsWith('article-c')).length > 5), 'no cluster made of the crowd: ' + rc.clusters.map(c => c.label + ':' + c.size));

// ── the naming page asks named tags for broader topics only; their name stays ──
tc.setLexicon({});
tc.lexiconLearn('church', null, 'Kirche'); tc.lexiconLearn('church', 'en', 'Church');
const arts = [{ id: 'k1', tags: ['Kirche'] }, { id: 'k2', tags: ['Kirche', 'Gemeinde'] }];
const work = gn.namingWork(arts);
assert.deepEqual(work.unnamed, ['Gemeinde']); assert.deepEqual(work.broaden, ['Kirche'], 'a named tag without broader topics is asked again');
ai.setAiTransport(async ({ user }) => user.split('\n').map((l, k) => { const t = l.replace(/^\[\d+\]\s*/, ''); return t === 'Kirche' ? `${k + 1}:Something else (broader: Religion)` : `${k + 1}:Parish (broader: Religion)`; }).join(' | '));
const box = w.document.createElement('div'); w.document.body.append(box);
let done = null;
await gn.openTagNamingPage(box, { articles: arts, onDone: (n) => { done = n; } }, { ai, route: { service: '', local: true, label: 'local' }, saveLexicon: async () => {} });
const page = box.querySelector('.graph-naming-page');
assert.ok(/1 tag has no English name yet · 1 named tag has no broader topics yet/.test(page.textContent), 'both counts: ' + page.querySelector('.graph-preview-date').textContent);
page.querySelector('.graph-naming-try').click();
for (let i = 0; i < 50 && !page.querySelector('.graph-naming-row'); i++) await tick(5);
assert.ok([...page.querySelectorAll('.graph-naming-broader-input')].every(i => i.value === 'Religion'), 'the preview shows the broader topics (editable)');
assert.ok(/\(name kept\)/.test(page.textContent), 'and that a named tag keeps its name');
page.querySelector('.graph-naming-save-first').click();
for (let i = 0; i < 50 && done === null; i++) await tick(5);
assert.equal(tc.conceptKey('Kirche'), tc.conceptKey('church'), 'the name was not changed to "something else"');
assert.deepEqual(tc.broaderKeysOf('Kirche'), [tc.conceptKey('religion')]);
assert.deepEqual(tc.broaderKeysOf('Gemeinde'), [tc.conceptKey('religion')]);
assert.equal(tc.conceptKey('Gemeinde'), tc.conceptKey('parish'), 'the new tag got its name');
assert.ok(gn.broaderVocabOf([{ tags: ['Kirche', 'Kirche', 'Technology', '🌐 de'] }]).every(x => !/Technology|🌐/.test(x)), 'the vocabulary leaves out categories and language marks');
ai.setAiTransport(null);
console.log('broader topics ok');
