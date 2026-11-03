// Subclusters: a big cluster that falls apart into subtopics (umbrella tag excluded, content similarity as a second signal), named locally.
import { setup, imp } from './harness.mjs'; import assert from 'assert';
setup({});
const gs = await imp('modules/graphStructure.js');

// compact fixture: papers = [{ id, tags }], similarity = [[a, b, score]]
const build = (papers, similarity = []) => {
    const nodes = [], links = [], seen = new Set();
    papers.forEach(p => {
        nodes.push({ id: 'article-' + p.id, group: 'article', label: p.id, data: { id: p.id } });
        p.tags.forEach(t => { if (!seen.has(t)) { seen.add(t); nodes.push({ id: 'tag-' + t, group: 'tag', label: t }); } links.push({ source: 'article-' + p.id, target: 'tag-' + t }); });
    });
    similarity.forEach(([a, b, score]) => links.push({ source: 'article-' + a, target: 'article-' + b, kind: 'similarity', score }));
    return { nodes, links };
};
const science = (c) => c.clusters.slice().sort((x, y) => y.size - x.size)[0];   // the big topic (its name is just its most used tag)

// ── 1. everything is "science", the sub-tags tell the areas apart ──
const areas = { genetics: ['genome', 'crispr', 'dna'], astronomy: ['telescope', 'galaxy', 'orbit'], materials: ['alloy', 'polymer', 'crystal'] };
const papers = [];
// all papers also carry general tags ("research", "paper"): the top level sees one big topic, the areas are only visible inside it
Object.entries(areas).forEach(([area, tags]) => { for (let i = 0; i < 12; i++) papers.push({ id: `${area}${i}`, tags: ['science', 'research', 'paper', tags[i % 3], tags[(i + 1) % 3]] }); });
// the other cluster, so there is more than one top-level topic
for (let i = 0; i < 10; i++) papers.push({ id: 'bread' + i, tags: ['baking', ['sourdough', 'crumb', 'flour'][i % 3]] });
// … and more other topics, so the umbrella tags stay below a third of the archive (above that they would not glue anything: see test 5)
for (let i = 0; i < 30; i++) papers.push({ id: 'rail' + i, tags: ['transit', ['tram', 'bus', 'metro'][i % 3], ['ticket', 'fare', 'route'][i % 3]] });
for (let i = 0; i < 30; i++) papers.push({ id: 'garden' + i, tags: ['gardening', ['soil', 'compost', 'seed'][i % 3], ['bed', 'shade', 'water'][i % 3]] });
for (let i = 0; i < 30; i++) papers.push({ id: 'chess' + i, tags: ['chess', ['opening', 'endgame', 'tactic'][i % 3], ['rook', 'pawn', 'bishop'][i % 3]] });
const { nodes, links } = build(papers);
const res = gs.topicClusters(nodes, links);
const sci = science(res);
assert.ok(sci, 'the big topic exists');
assert.equal(sci.size, 36);
assert.equal(sci.children.filter(c => !c.other).length, 3, 'three subtopics inside science');
const byArea = (area) => sci.children.find(c => [...c.articleIds].every(id => id.startsWith('article-' + area)));
for (const area of Object.keys(areas)) assert.ok(byArea(area) && byArea(area).size === 12, area + ' is one subtopic with all its 12 papers');
assert.ok(sci.children.every(c => !/science|research|paper/i.test(c.label)), 'the umbrella tags are not subtopic names');
assert.ok(sci.children.every(c => c.label.split(' · ').every(w => areas[Object.keys(areas).find(a => byArea(a) === c)].includes(w))), 'named after the tags specific to the group: ' + sci.children.map(c => c.label));
const all = sci.children.flatMap(c => [...c.articleIds]);
assert.equal(new Set(all).size, all.length, 'an article is in one subtopic only');
assert.equal(all.length, sci.size, 'every article of the cluster is in some subtopic');
assert.equal(res.subOfArticle.get('article-genetics0'), byArea('genetics').id, 'article → subtopic');
assert.deepEqual(gs.topicClusters(nodes, links).clusters.map(c => c.children.map(k => k.label)), res.clusters.map(c => c.children.map(k => k.label)), 'same input, same subtopics');
assert.ok(!res.clusters.find(c => c.size === 10) || !res.clusters.find(c => c.size === 10).children.length, 'a small cluster is not split');
assert.deepEqual(gs.topicClusters(nodes, links, { subclusters: false }).clusters.flatMap(c => c.children), [], 'can be switched off');

// ── 2. nothing but the umbrella tag: content similarity separates them, terms name them ──
const flat = Array.from({ length: 36 }, (_, i) => ({ id: 'p' + i, tags: ['science'] }));
const sim = [], terms = {};
const topics = [['genome', 'crispr'], ['telescope', 'galaxy'], ['alloy', 'polymer']];
flat.forEach((p, i) => { const g = i % 3; terms[p.id] = [...topics[g], 'study', 'results']; });
flat.forEach((p, i) => { flat.forEach((q, j) => { if (j > i && j % 3 === i % 3 && (j - i) <= 9) sim.push([p.id, q.id, 0.5]); }); });
const f = build(flat, sim);
const r2 = gs.topicClusters(f.nodes, f.links, { terms });
const sci2 = science(r2);
assert.equal(sci2.children.length, 3, 'three subtopics from similarity alone');
assert.ok(sci2.children.every(c => c.size === 12));
const names = sci2.children.map(c => c.label).sort();
assert.deepEqual(names, ['alloy · polymer', 'crispr · genome', 'galaxy · telescope'], 'named after the two most typical terms; the words every paper has ("study", "results") do not name anything');
const noTerms = gs.topicClusters(f.nodes, f.links);
assert.ok(science(noTerms).children.every(c => /^Group \d$/.test(c.label)), 'without terms the groups are numbered, never empty names');

// ── 5. an umbrella tag on a big share of the whole archive does not glue the topics (a "Technik" on 3 of 4 articles) ──
const big = [];
['ai', 'chips', 'web', 'robots'].forEach((sub, g) => { for (let i = 0; i < 20; i++) big.push({ id: sub + i, tags: ['tech', sub, sub + '-' + (i % 3)] }); });
for (let i = 0; i < 10; i++) big.push({ id: 'food' + i, tags: ['cooking', 'recipe', 'oven'] });
const bg = build(big);
const rBig = gs.topicClusters(bg.nodes, bg.links);
assert.ok(rBig.clusters.filter(c => !c.other).length >= 4, 'tech (80 % of the archive) does not merge ai, chips, web and robots into one blob: ' + rBig.clusters.map(c => c.label + ':' + c.size));
assert.ok(rBig.clusters.every(c => c.size <= 25), 'no cluster swallows the archive');
assert.ok(!rBig.clusters.some(c => c.label === 'tech'), 'the umbrella is not a cluster name');
const aiCluster = rBig.clusterOfArticle.get('article-ai0');
assert.ok(['ai1', 'ai2', 'ai3'].every(id => rBig.clusterOfArticle.get('article-' + id) === aiCluster), 'the articles of one sub-area stay together');

// ── 3. no structure → no subtopics ──
const blob = Array.from({ length: 30 }, (_, i) => ({ id: 'b' + i, tags: ['science'] }));
assert.deepEqual(science(gs.topicClusters(...Object.values(build(blob)))).children, [], 'one undifferentiated group stays one topic');
const lopsided = [...Array.from({ length: 28 }, (_, i) => ({ id: 'l' + i, tags: ['science', 'x', 'y'] })), ...Array.from({ length: 3 }, (_, i) => ({ id: 'm' + i, tags: ['science', 'z', 'w'] }))];
assert.ok(science(gs.topicClusters(...Object.values(build(lopsided)))).children.length === 0, 'one giant group plus a sliver is not a split');

// ── 4. leftovers go to "Other" ──
const withRest = [...papers, { id: 'odd1', tags: ['science', 'oddity'] }, { id: 'odd2', tags: ['science', 'curio'] }];
const wr = build(withRest);
const sci3 = science(gs.topicClusters(wr.nodes, wr.links));
assert.ok(sci3.children.some(c => c.other && c.label === 'Other' && c.size === 2), 'articles that fit no group are collected under "Other"');
// ── 7. the tags cannot divide a big cluster, the text can ──
{
    const n = 200, groups = 4;
    const flatPapers = Array.from({ length: n }, (_, i) => ({ id: 'w' + i, tags: ['Wirtschaft'] }));       // one tag on everything
    const vectors = {}, terms = {};
    flatPapers.forEach((p, i) => { const g = i % groups; vectors[p.id] = { t: [['g' + g + 'a', 3], ['g' + g + 'b', 3], ['g' + g + 'c', 2], ['common', 3], ['noise' + (i % 7), 1]] }; terms[p.id] = ['g' + g + 'a', 'g' + g + 'b', 'common']; });
    const f2 = build(flatPapers);
    const none = gs.topicClusters(f2.nodes, f2.links);
    assert.deepEqual(none.clusters[0].children, [], 'without the text there is nothing to divide it by');
    const byText = gs.topicClusters(f2.nodes, f2.links, { terms, vectors });
    const kids = byText.clusters[0].children;
    assert.ok(kids.length >= groups, 'the text divides the clump into ' + kids.length + ' subtopics');
    assert.ok(kids.every(k => k.size <= n * 0.4), 'no group keeps a big part of it: ' + kids.map(k => k.size));
    const purity = kids.map(k => { const count = {}; [...k.articleIds].forEach(id => { const g = Number(id.replace('article-w', '')) % groups; count[g] = (count[g] || 0) + 1; }); return Math.max(...Object.values(count)) / k.size; });
    assert.ok(purity.every(p => p >= 0.9), 'each subtopic is (almost) one of the real groups: ' + purity.map(p => p.toFixed(2)));
    assert.ok(kids.every(k => /^g\d[abc]/.test(k.label)), 'named after the terms typical of the group: ' + kids.map(k => k.label));
    assert.deepEqual(gs.topicClusters(f2.nodes, f2.links, { terms, vectors }).clusters[0].children.map(k => [k.label, k.size]), kids.map(k => [k.label, k.size]), 'same input, same split');
    // no real difference in the text: no invented subtopics
    const same = {}, sameTerms = {}; flatPapers.forEach(p => { same[p.id] = { t: [['common', 3], ['alike', 2], ['same', 2]] }; sameTerms[p.id] = ['common', 'alike', 'same']; });
    assert.deepEqual(gs.topicClusters(f2.nodes, f2.links, { terms: sameTerms, vectors: same }).clusters[0].children, [], 'identical texts are not cut up');
    // a small cluster is left alone
    const small = build(flatPapers.slice(0, 30)); const sv = Object.fromEntries(Object.entries(vectors).slice(0, 30));
    assert.deepEqual(gs.topicClusters(small.nodes, small.links, { vectors: sv }).clusters[0].children, [], 'under 40 articles the text is not used to split (the fallback; the shared terms of `terms` are a separate signal)');
    assert.ok(gs.topicClusters(f2.nodes, f2.links, { vectors }).clusters[0].children.length >= groups, 'the vectors alone are enough when the cluster is big');
}

// ── 8. ties that are not stronger inside the groups than between them are no subtopics ──
{
    const noise = Array.from({ length: 60 }, (_, i) => ({ id: 'n' + i, tags: ['topic', 'x' + (i % 6), 'y' + ((i * 7 + 3) % 10)] }));   // tags that overlap across the board
    const nb = build(noise);
    const kids = gs.topicClusters(nb.nodes, nb.links).clusters.flatMap(c => c.children);
    assert.ok(kids.every(k => k.size < 60), 'nothing odd');
    const r8 = gs.topicClusters(nb.nodes, nb.links);
    assert.ok(r8.clusters.every(c => c.children.length === 0 || c.children.filter(k => !k.other).length >= 2), 'a split is either real (2+ groups) or absent');
}

// ── 9. names: what is typical of a group, never the parent's own name, different for siblings, and always something ──
{
    const mk = (list, sim = []) => { const nodes = [], links = [], seen = new Set();
        list.forEach(p => { nodes.push({ id: 'article-' + p.id, group: 'article', label: p.title, data: { id: p.id, url: p.url, timestamp: p.timestamp } });
            (p.tags || ['Economy']).forEach(t => { if (!seen.has(t)) { seen.add(t); nodes.push({ id: 'tag-' + t, group: 'tag', label: t }); } links.push({ source: 'article-' + p.id, target: 'tag-' + t }); }); });
        sim.forEach(([x, y]) => links.push({ source: 'article-' + x, target: 'article-' + y, kind: 'similarity', score: 0.5 }));
        return { nodes, links }; };
    const words = [['inflation', 'prices', 'eurozone'], ['housing', 'mortgage', 'rents'], ['startup', 'funding', 'venture']];
    const toks = (t) => t.toLowerCase().split(/\s+/).filter(w => w.length > 3);

    // A) groups that differ only in the words of their titles
    const A = Array.from({ length: 60 }, (_, i) => ({ id: 'p' + i, title: `${words[i % 3].join(' ')} report ${i}`, tags: ['Economy'] }));
    const aTerms = Object.fromEntries(A.map(p => [p.id, toks(p.title).filter(w => w !== 'report')]));
    const ra = gs.topicClusters(...Object.values(mk(A)), { terms: aTerms });
    const kidsA = ra.clusters[0].children;
    assert.equal(kidsA.length, 3, 'three groups');
    assert.ok(kidsA.every(k => !/economy/i.test(k.label)), 'the parent name is not a subtopic name: ' + kidsA.map(k => k.label));
    assert.ok(kidsA.every(k => words.some(w => w.some(x => k.label.includes(x)))), 'named after words of the group: ' + kidsA.map(k => k.label));
    assert.equal(new Set(kidsA.map(k => k.label)).size, 3, 'different names for siblings');
    assert.ok(kidsA.every(k => !/\(\d\)|^Group/.test(k.label)), 'no numbering when there is something to say');

    // B) a tag that is the parent's own name is no subtopic name, even where it is typical of one group
    const B = [];
    for (let i = 0; i < 30; i++) B.push({ id: 'b' + i, title: `bank rates ${i}`, tags: ['Economy', 'banks', 'rates'] });
    for (let i = 0; i < 20; i++) B.push({ id: 'c' + i, title: `crypto coin ${i}`, tags: ['crypto', 'coins'] });
    for (let i = 0; i < 20; i++) B.push({ id: 'd' + i, title: `retail shop ${i}`, tags: ['retail', 'shops'] });
    for (let i = 0; i < 20; i++) B.push({ id: 'o' + i, title: `other ${i}`, tags: ['filler' + (i % 4)] });
    const rb = gs.topicClusters(...Object.values(mk(B)));
    const allNames = rb.clusters.flatMap(c => [c.label, ...c.children.map(k => k.label)]);
    rb.clusters.forEach(c => c.children.forEach(k => assert.notEqual(k.label.toLowerCase(), c.label.toLowerCase(), 'a subtopic is not called like its cluster (' + c.label + ')')));
    assert.ok(allNames.length > 0);

    // C) nothing typical in the words: where the articles come from
    const C = Array.from({ length: 45 }, (_, i) => ({ id: 'h' + i, title: `Note ${i}`, url: `https://${['blog', 'news', 'wiki'][i % 3]}.example/p${i}`, timestamp: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), tags: ['Economy'] }));
    const simC = []; C.forEach((p, i) => C.forEach((q, j) => { if (j > i && j % 3 === i % 3 && j - i <= 12) simC.push([p.id, q.id]); }));
    const rc = gs.topicClusters(...Object.values(mk(C, simC)));
    const kidsC = rc.clusters[0].children;
    assert.ok(kidsC.length === 3, 'three groups from similarity alone: ' + kidsC.map(k => k.label));
    assert.deepEqual(kidsC.map(k => k.label).sort(), ['blog.example', 'news.example', 'wiki.example'], 'named after where they come from');

    // D) no words, no source: when they were saved
    const D = Array.from({ length: 45 }, (_, i) => ({ id: 'd' + i, title: `Note ${i}`, timestamp: new Date(Date.UTC(2026, (i % 3) * 4, 1 + Math.floor(i / 3))).toISOString(), tags: ['Economy'] }));
    const simD = []; D.forEach((p, i) => D.forEach((q, j) => { if (j > i && j % 3 === i % 3 && j - i <= 12) simD.push([p.id, q.id]); }));
    const kidsD = gs.topicClusters(...Object.values(mk(D, simD))).clusters[0].children;
    assert.ok(kidsD.length === 3 && kidsD.every(k => /20\d\d/.test(k.label)), 'named after the time they were saved: ' + kidsD.map(k => k.label));
    assert.equal(new Set(kidsD.map(k => k.label)).size, 3);

    // E) nothing at all to go on: numbered, never empty
    const E = Array.from({ length: 45 }, (_, i) => ({ id: 'e' + i, title: `Note ${i}`, tags: ['Economy'] }));
    const simE = []; E.forEach((p, i) => E.forEach((q, j) => { if (j > i && j % 3 === i % 3 && j - i <= 12) simE.push([p.id, q.id]); }));
    const kidsE = gs.topicClusters(...Object.values(mk(E, simE))).clusters[0].children;
    assert.ok(kidsE.length === 3 && kidsE.every(k => /^Group \d$/.test(k.label)), 'only then "Group n": ' + kidsE.map(k => k.label));
}

// ── 6. nothing in the logic is about a particular topic: renaming the tags (other words, other language) changes nothing but the names ──
import fs from 'fs';
const shape = (r) => r.clusters.map(c => [c.size, c.children.map(k => k.size).sort((a, b) => b - a)]).sort((a, b) => b[0] - a[0] || String(b[1]).localeCompare(String(a[1])));
const rename = (list, prefix) => list.map(p => ({ ...p, tags: p.tags.map(t => prefix + t) }));
for (const [label, set] of [['areas (science)', papers], ['archive-wide umbrella', big]]) {
    const a = gs.topicClusters(...Object.values(build(set)));
    for (const prefix of ['Kochen_', 'ご_', 'zzz_', '']) {
        const b = gs.topicClusters(...Object.values(build(rename(set, prefix))));
        assert.deepEqual(shape(b), shape(a), `${label}: the same structure whatever the tags are called (${prefix || 'unchanged'})`);
    }
}
for (const f of ['graphStructure.js', 'graphSimilarity.js', 'graphSimilarityCache.js', 'graphMaturity.js']) {
    const code = fs.readFileSync(new URL('../src/modules/' + f, import.meta.url), 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
    assert.ok(!/technik|technolog|\btech\b|science|wissenschaft|politik|klima|gesundheit/i.test(code), f + ' has no topic words in its logic');
}
console.log('subclusters ok');
