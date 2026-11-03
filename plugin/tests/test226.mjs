// Articles saved in the same millisecond (an import, "save all tabs") stay separate nodes: no merged dots, true counts.
import { setup, imp } from './harness.mjs'; import assert from 'assert';
setup({});
const ag = await imp('modules/archiveGraph.js');
const gs = await imp('modules/graphStructure.js');

const same = '2026-05-01T10:00:00.000Z';
const arts = [];
for (let i = 0; i < 12; i++) arts.push({ id: 'imp' + i, title: 'Imported ' + i, timestamp: same, tags: ['economy', i % 2 ? 'trade' : 'tax'] });
for (let i = 0; i < 4; i++) arts.push({ id: 'own' + i, title: 'Own ' + i, timestamp: new Date(Date.UTC(2026, 5, 1 + i)).toISOString(), tags: ['economy', 'trade'] });
for (let i = 0; i < 3; i++) arts.push({ id: 'bare' + i, title: 'Untagged ' + i, timestamp: same, tags: [] });   // same time as the imports, and no tag of its own

const g = ag.__test_buildGraphData(arts, 1, null);
const articleNodes = g.nodes.filter(n => n.group === 'article');
assert.equal(articleNodes.length, 16, 'every tagged article is a node of its own, also those saved in the same millisecond');
assert.equal(new Set(articleNodes.map(n => n.id)).size, 16, 'and their ids are unique');
assert.deepEqual(new Set(articleNodes.map(n => n.data.id)), new Set(arts.filter(a => a.tags.length).map(a => a.id)), 'each node carries its own article');
assert.equal(g.stillOrphanCount, 3, 'the untagged articles are not mistaken for the imported ones that share their time');

// the counts the graph shows come from these nodes
const r = gs.topicClusters(g.nodes, g.links);
assert.equal(r.clusters.reduce((n, c) => n + c.size, 0), 16, 'cluster sizes add up to the real number of articles');
assert.ok(r.clusters.every(c => c.children.reduce((n, k) => n + k.size, 0) === (c.children.length ? c.size : 0)), 'and so do the subtopics');

// an untagged article that is similar to an imported one is attached as its own node
const gWithSim = ag.__test_buildGraphData(arts, 1, null, { bare0: [['imp1', 0.6]] });
assert.ok(gWithSim.nodes.some(n => n.data && n.data.id === 'bare0'), 'a similar untagged article joins as its own node, next to the import it resembles');
assert.equal(new Set(gWithSim.nodes.filter(n => n.group === 'article').map(n => n.id)).size, gWithSim.nodes.filter(n => n.group === 'article').length, 'still unique');
console.log('same-time articles ok');
