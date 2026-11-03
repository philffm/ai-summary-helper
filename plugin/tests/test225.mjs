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
console.log('language marks ok');
