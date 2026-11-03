// Language marks ("🌐 de") are not topics: never named by the AI, never learned, never a cluster, and a lexicon an older run polluted heals itself.
import { setup, imp } from './harness.mjs'; import assert from 'assert';
setup({});
const tc = await imp('modules/topicConcepts.js');
const gs = await imp('modules/graphStructure.js');

// what counts as a language mark
for (const t of ['🌐 de', '🌐de', '🌐 EN', ' 🌐 pt-br ', '🌐 zh-hans']) assert.ok(tc.isLanguageTag(t), t + ' is a language mark');
for (const t of ['de', 'Deutschland', 'Germany', '🌐', '🌐 deutsch', '🌐 de en', 'Football', '', null, undefined]) assert.ok(!tc.isLanguageTag(t), String(t) + ' is not');

// the AI's answer for a language mark is ignored, whatever it says
tc.setLexicon({});
assert.equal(tc.lexiconLearn('germany', null, '🌐 de'), false, 'the spelling "🌐 de" is not learned for Germany');
assert.equal(tc.lexiconLearn('🌐 de', 'de', 'Deutschland'), false, 'a topic is not learned for a language mark either');
assert.equal(tc.lexiconLearn('germany', 'de', 'Deutschland'), true, 'real topics are still learned');
assert.equal(tc.topicLabel('🌐 de', 'de'), '🌐 de', 'the mark is shown as it is');
assert.equal(tc.conceptKey('🌐 de'), tc.normalizeTopic('🌐 de'), 'and compared as plain text');

// a lexicon an older run already polluted: "🌐 de" was stored as a spelling of Germany
tc.setLexicon({ germany: { en: 'Germany', de: 'Deutschland', '*': ['🌐 de', 'Bundesrepublik', '🌐 en'] } });
assert.equal(tc.topicLabel('🌐 de', 'de'), '🌐 de', 'the old entry no longer turns the mark into "Deutschland"');
assert.equal(tc.isKnownTopic('🌐 de'), false);
assert.equal(tc.topicLabel('Bundesrepublik', 'de'), 'Deutschland', 'the genuine spellings stay');
assert.deepEqual(tc.getLexicon().germany['*'], ['Bundesrepublik'], 'the bad spellings are removed from the lexicon itself, so they are saved away too');

// "Name my tags" never sends them to the AI, and nothing is left to translate for them
assert.deepEqual(tc.unknownTags(['🌐 de', '🌐 de', '🌐 en', 'Robotics', 'Robotics']), ['Robotics']);
assert.deepEqual(tc.keysNeedingLabel(['🌐 de', '🌐 en'], 'de'), []);

// the graph: a language mark is no topic, whatever share of the archive it covers
const papers = [];
for (let i = 0; i < 30; i++) papers.push({ id: 'de' + i, tags: ['🌐 de', ['gpu', 'fab', 'arm'][i % 3], ['chips', 'wafer', 'litho'][i % 3]] });
for (let i = 0; i < 30; i++) papers.push({ id: 'en' + i, tags: ['🌐 en', ['rail', 'bus', 'tram'][i % 3], ['transit', 'ticket', 'fare'][i % 3]] });
for (let i = 0; i < 6; i++) papers.push({ id: 'lonely' + i, tags: ['🌐 de'] });
const nodes = [], links = [], seen = new Set();
papers.forEach(p => { nodes.push({ id: 'article-' + p.id, group: 'article', label: p.id, data: { id: p.id } }); p.tags.forEach(t => { if (!seen.has(t)) { seen.add(t); nodes.push({ id: 'tag-' + t, group: 'tag', label: t }); } links.push({ source: 'article-' + p.id, target: 'tag-' + t }); }); });
const r = gs.topicClusters(nodes, links);
assert.ok(!r.clusters.some(c => /🌐/.test(c.label) || c.children.some(k => /🌐/.test(k.label))), 'no cluster or subtopic is named after a language: ' + r.clusters.map(c => c.label));
const chips = r.clusterOfArticle.get('article-de0'), transit = r.clusterOfArticle.get('article-en0');
assert.notEqual(chips, transit, 'German and English articles of different topics are not one cluster because of the language');
assert.equal(r.clusterOfArticle.get('article-de3'), chips, 'the topic decides, not the language');
assert.equal(r.clusterOfArticle.get('article-lonely0'), r.otherId, 'an article that only has a language mark has no topic yet');
assert.ok(![...r.clusterOfTag.keys()].some(k => /🌐/.test(k)), 'language marks belong to no cluster');
// ── every other place that used tags as a criterion ──
const ag = await imp('modules/archiveGraph.js');
const art = (id, tags, extra = {}) => ({ id, title: 'T ' + id, timestamp: new Date(Date.UTC(2026, 0, 1) + Number(id.replace(/\D/g, '')) * 3600000).toISOString(), tags, ...extra });
const arts = [art('a1', ['🌐 de', 'gpu']), art('a2', ['🌐 de', 'gpu']), art('a3', ['🌐 en', 'gpu']), art('a4', ['🌐 de']), art('a5', ['🌐 en', '🌐 de'])];
const g = ag.__test_buildGraphData(arts, 1, null);
assert.ok(!g.nodes.some(n => n.group === 'tag' && /🌐/.test(n.label)), 'no node for a language mark');
assert.deepEqual(g.nodes.filter(n => n.group === 'tag').map(n => n.label), ['gpu'], 'only the real topic is a tag node');
assert.ok(!g.links.some(l => /🌐/.test(String(l.target))), 'no link to a language mark');
assert.ok(!g.nodes.some(n => n.id === 'article-' + arts[3].timestamp), 'an article with nothing but a language mark has no tag link (it waits for similarity)');
assert.equal(g.stillOrphanCount, 2, 'such articles are counted as not placed yet');
const old = (id, tags) => ({ ...art(id, tags), timestamp: new Date(Date.now() - 90 * 86400000 - Number(id.replace(/\D/g, '')) * 1000).toISOString() });
assert.deepEqual(ag.findGaps([old('b1', ['🌐 de']), old('b2', ['🌐 de', 'Solo'])]).map(x => x.label), ['Solo'], 'a language mark is never a "started, never followed up" topic');

const gsim = await imp('modules/graphSimilarity.js');
assert.ok(!gsim.buildEntry({ title: 'Alpha beta', tags: ['🌐 deu', 'gamma'], summary: '' }, {}, false).t.some(([w]) => w === 'deu'), 'a language mark is not a term of the article');
assert.equal(gsim.fingerprintOf({ timestamp: 1, tags: ['x', '🌐 de'] }), gsim.fingerprintOf({ timestamp: 1, tags: ['x'] }), 'changing the language mark does not make the article look changed');

const { TOOLS } = await imp('modules/mcp/tools.js');
const idx = [{ id: 'm1', title: 'Solar roofs', url: 'https://e.example/1', timestamp: 1, tags: ['🌐 de', 'solar'], summary: 'photovoltaic panels roof grid' }, { id: 'm2', title: 'Solar tariffs', url: 'https://e.example/2', timestamp: 2, tags: ['🌐 de', 'solar'], summary: 'photovoltaic panels grid tariff' }];
const storage = { get: async (k) => (typeof k === 'object' && !Array.isArray(k) ? Object.fromEntries(Object.keys(k).map(x => [x, x === 'articles:index' ? idx : k[x]])) : {}) };
const rel = await TOOLS.related_articles({ id: 'm1' }, { storage });
assert.deepEqual(rel[0].shared_tags, ['solar'], 'sharing a language is not sharing a tag');

const md = await imp('modules/markdownArchive.js');
const hub = md.hubToMarkdown({ title: 'T', items: [{ article: art('c1', ['🌐 de', 'gpu']), notes: 0 }, { article: art('c2', ['🌐 de', '🌐 en', 'gpu']), notes: 0 }], nameOf: (a) => a.id, date: new Date('2026-11-03') });
assert.ok(hub.includes('gpu (2)') && !/🌐/.test(hub.split('## Topics inside')[1] || ''), 'the hub note lists topics, not languages');
globalThis.chrome = { storage: { local: { get(k, cb) {
    const out = {}; const keys = typeof k === 'object' && !Array.isArray(k) ? Object.keys(k) : [].concat(k);
    for (const key of keys) out[key] = key === 'articles:index' ? [{ id: 'article_1_aaaaaa', title: 'One', url: 'https://a.example/1', timestamp: 1, tags: ['🌐 de'], summary: 's' }, { id: 'article_2_bbbbbb', title: 'Two', url: 'https://a.example/2', timestamp: 2, tags: ['🌐 de'], summary: 's' }] : key === 'hl:all' ? [] : undefined;
    cb(out);
} } } };
const files = await md.buildArchiveFiles({});
assert.ok(files.length === 2 && files.every(f => !f.text.includes('## Related')), 'two German articles with nothing else in common are not "related"');
console.log('language marks ok');
