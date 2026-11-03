// Graph structure: topic clusters come out of the tags alone (no AI, no network); bridges, focus, path, source type, maturity.
import { setup, imp } from './harness.mjs'; import assert from 'assert';
setup({});
const gs = await imp('modules/graphStructure.js');

// Three topics with their own tags, plus one article that sits in two of them.
const topics = { ai: ['llm', 'agents', 'prompts'], city: ['transit', 'housing', 'bikes'], food: ['bread', 'fermenting', 'baking'] };
const articles = [];
Object.entries(topics).forEach(([name, tags]) => {
    for (let i = 0; i < 6; i++) articles.push({ id: `${name}${i}`, tags: [tags[i % 3], tags[(i + 1) % 3]] });
});
articles.push({ id: 'bridge', tags: ['llm', 'transit'] });
articles.push({ id: 'lone', tags: ['rare'] });

const nodes = [], links = [];
const seen = new Set();
articles.forEach(a => {
    nodes.push({ id: 'article-' + a.id, group: 'article', label: a.id, data: a });
    a.tags.forEach(t => {
        if (!seen.has(t)) { seen.add(t); nodes.push({ id: 'tag-' + t, group: 'tag', label: t }); }
        links.push({ source: 'article-' + a.id, target: 'tag-' + t });
    });
});

const res = gs.topicClusters(nodes, links);
const big = res.clusters.filter(c => !c.other);
assert.equal(big.length, 3, 'three topics, three clusters');
const clusterOf = (tag) => res.clusterOfTag.get('tag-' + tag);
assert.equal(clusterOf('llm'), clusterOf('agents')); assert.equal(clusterOf('agents'), clusterOf('prompts'));
assert.notEqual(clusterOf('llm'), clusterOf('transit')); assert.notEqual(clusterOf('transit'), clusterOf('bread'));
assert.ok(big.every(c => c.size >= 6), 'every article of a topic is in it');
assert.equal(res.clusterOfArticle.get('article-lone'), res.otherId, 'a one-off tag ends up in "Everything else"');
assert.ok(res.clusters.find(c => c.other).label === 'Everything else');
assert.ok(res.clusters.every(c => c.other || big.includes(c)));
assert.deepEqual(gs.topicClusters(nodes, links).clusters.map(c => c.id), res.clusters.map(c => c.id), 'same input, same clusters');
assert.deepEqual(gs.topicClusters([...nodes].reverse(), [...links].reverse()).clusters.map(c => c.id).sort(), res.clusters.map(c => c.id).sort(), 'input order does not matter');
assert.equal(res.clusters.find(c => c.id === clusterOf('llm')).label.length > 0, true, 'named after its most used tag');

// the bridge article reaches two clusters; ordinary ones do not
const bridges = gs.bridgeArticles(nodes, links, res);
assert.deepEqual(bridges.get('article-bridge').sort(), [clusterOf('llm'), clusterOf('transit')].sort());
assert.ok(!bridges.has('article-ai0'), 'an article inside one topic is no bridge');

// a similarity-only article follows the article it is similar to
const withSim = [...nodes, { id: 'article-sim', group: 'article', label: 'sim', data: { id: 'sim' } }];
const simLinks = [...links, { source: 'article-sim', target: 'article-food0', kind: 'similarity', score: 0.3 }];
const simRes = gs.topicClusters(withSim, simLinks);
assert.equal(simRes.clusterOfArticle.get('article-sim'), simRes.clusterOfArticle.get('article-food0'));

// tiny archives and degenerate input do not throw
assert.deepEqual(gs.topicClusters([], []).clusters, []);
assert.ok(gs.topicClusters(nodes.slice(0, 3), links.slice(0, 1)).clusters.length >= 0);

// one giant topic is split once instead of becoming a single blob
const gNodes = [], gLinks = [];
const gTags = Array.from({ length: 16 }, (_, i) => 't' + i);
gTags.forEach(t => gNodes.push({ id: 'tag-' + t, group: 'tag', label: t }));
for (let i = 0; i < 48; i++) {
    const half = i % 2 ? 8 : 0, a = 'article-g' + i;
    gNodes.push({ id: a, group: 'article', label: a, data: { id: 'g' + i } });
    [half + (i % 4), half + ((i + 1) % 4), half + 4 + (i % 4)].forEach(k => gLinks.push({ source: a, target: 'tag-t' + k }));
    if (i % 12 === 0) gLinks.push({ source: a, target: 'tag-t' + (8 - half) });   // a few cross links glue the halves together
}
assert.ok(gs.topicClusters(gNodes, gLinks).clusters.filter(c => !c.other).length >= 2, 'a giant cluster is split');

// focus: an item plus what is within N hops; path: how two items connect
const near = gs.neighborhood(nodes, links, 'article-ai0', 1);
assert.deepEqual([...near].sort(), ['article-ai0', 'tag-agents', 'tag-llm'].sort());
assert.ok(gs.neighborhood(nodes, links, 'article-ai0', 2).has('article-ai1'), 'two hops reach the articles sharing a tag');
assert.equal(gs.neighborhood(nodes, links, 'nope', 2).size, 0);
const path = gs.shortestPath(nodes, links, 'article-ai0', 'article-city0');
assert.ok(path && path[0] === 'article-ai0' && path[path.length - 1] === 'article-city0', 'the bridge connects the two topics');
assert.ok(path.includes('article-bridge'));
assert.equal(gs.shortestPath(nodes, links, 'article-ai0', 'article-lone'), null, 'not connected → null');
assert.deepEqual(gs.shortestPath(nodes, links, 'article-ai0', 'article-ai0'), ['article-ai0']);
assert.ok(gs.shortestPath(withSim, simLinks, 'article-sim', 'article-food3'), 'similarity links count as connections');

// source type and maturity come from the record alone
assert.equal(gs.sourceType({ url: 'https://www.youtube.com/watch?v=x' }), 'video');
assert.equal(gs.sourceType({ url: 'https://youtu.be/x' }), 'video');
assert.equal(gs.sourceType({ url: 'https://example.com/a/paper.pdf?dl=1' }), 'pdf');
assert.equal(gs.sourceType({ url: 'https://example.com/post' }), 'article');
assert.equal(gs.sourceType({ url: 'https://example.com/post', paper: 'yes' }), 'paper');
assert.equal(gs.sourceType({ url: 'https://example.com/post', paper: 'yes', paperOverride: 'no' }), 'article', 'the user override wins');
assert.equal(gs.sourceType(null), 'article');
assert.equal(gs.maturityOf({}), 'seed');
assert.equal(gs.maturityOf({ summary: '<p>x</p>' }), 'seed', 'a summary alone is still only saved');
assert.equal(gs.maturityOf({ lastOpened: '2026-01-01' }), 'growing');
assert.equal(gs.maturityOf({ summary: 'x', lastOpened: '2026-01-01' }), 'growing');
assert.equal(gs.maturityOf({ summary: 'x', lastOpened: '2026-01-01' }, 2), 'evergreen', 'opened, summarised and annotated');
assert.equal(gs.maturityOf({}, 3), 'growing', 'notes alone show it was worked on');
console.log('graph structure ok');
