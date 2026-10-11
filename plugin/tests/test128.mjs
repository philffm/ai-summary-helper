// Graph view uses: topic cluster card (unopened list, briefing, question, export), "Gaps" reading list, time window.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { store, w } = setup({});
const d = w.document;
globalThis.document = d; globalThis.window = w;
const DAY = 86400000, now = Date.now();
const art = (id, tags, daysAgo, extra = {}) => ({ id, title: 'T ' + id, tags, timestamp: new Date(now - daysAgo * DAY).toISOString(), summary: `<p>Summary of ${id}</p>`, ...extra });

const ag = await imp('modules/archiveGraph.js');
const gc = await imp('modules/graphClusters.js');

// ── gaps: topics with ≤2 articles that nobody opened for 30 days ──
const arts = [
    art('a1', ['Solo'], 90),                                   // one article, never opened → gap
    art('a2', ['Pair'], 100, { lastOpened: new Date(now - 80 * DAY).toISOString() }), art('a3', ['Pair'], 95),   // two, last touched 80d ago → gap
    art('a4', ['Fresh'], 100, { lastOpened: new Date(now - 2 * DAY).toISOString() }),   // opened recently → no gap
    art('b1', ['Big'], 60), art('b2', ['Big'], 50), art('b3', ['Big'], 40),             // three articles: a real topic, not a gap
    art('n1', ['Recent'], 3)                                    // too new to call forgotten
];
const gaps = ag.findGaps(arts, { now });
assert.deepEqual(gaps.map(g => g.label), ['Solo', 'Pair'], 'never-opened first, then longest untouched');
assert.equal(gaps[0].never, true); assert.equal(gaps[1].never, false);
assert.deepEqual(gaps[1].articles.map(a => a.id).sort(), ['a2', 'a3']);

// ── cluster membership via tag links only ──
const nodes = [
    { id: 'tag-x', group: 'tag', label: 'X' }, { id: 'article-1', group: 'article', data: arts[0] },
    { id: 'article-2', group: 'article', data: arts[1] }, { id: 'article-3', group: 'article', data: arts[2] }
];
const links = [{ source: 'article-1', target: 'tag-x' }, { source: 'article-2', target: 'tag-x' }, { source: 'article-3', target: 'article-1', kind: 'similarity' }];
assert.deepEqual(ag.articlesOfTag(nodes, links, 'tag-x').map(a => a.id), ['a1', 'a2'], 'similarity links do not join a topic');

// ── time window ──
const span = ag.monthsOf(arts);
assert.ok(span && span.max > span.min, 'archive spans several months');
const hist = ag.monthHistogram(arts, span);
assert.equal(hist.length, span.max - span.min + 1, 'one bar per month');
assert.equal(hist.reduce((a, b) => a + b, 0), arts.length, 'every article lands in exactly one bar');
assert.deepEqual(ag.monthHistogram([], null), [], 'no span, no bars');
const lo = ag.monthIndex(now - 10 * DAY), hi = span.max;
const vis = ag.visibleInRange(nodes.map(n => n.group === 'article' ? { ...n, data: { ...n.data, timestamp: n.id === 'article-1' ? new Date(now - 200 * DAY).toISOString() : new Date(now - 2 * DAY).toISOString() } } : n), links, lo, hi);
assert.ok(!vis.has('article-1') && vis.has('article-2'), 'old article fades, recent stays');
assert.ok(vis.has('tag-x'), 'a topic with one visible article stays');
const visNone = ag.visibleInRange([{ id: 'article-1', group: 'article', data: { timestamp: new Date(now - 200 * DAY).toISOString() } }, nodes[0]], [links[0]], lo, hi);
assert.ok(!visNone.has('tag-x'), 'a topic with nothing in the window fades');

// ── Graph | List | Gaps switch ──
const host = d.createElement('div'); d.body.append(host);
const openedFromGaps = []; host.addEventListener('open-article', (e) => openedFromGaps.push(e.detail.id));
ag.renderGraphList(host, nodes, links, gaps);
const segs = [...host.querySelectorAll('.graph-view-toggle button')].map(b => b.textContent);
assert.deepEqual(segs, ['Graph', 'List', 'Gaps 2']);
assert.ok(host.querySelector('.graph-gaps').hidden, 'gaps hidden at first');
host.querySelectorAll('.graph-view-toggle button')[2].click();
assert.equal(host.dataset.graphMode, 'gaps'); assert.ok(!host.querySelector('.graph-gaps').hidden);
assert.ok(host.querySelector('.graph-list:not(.graph-gaps)').hidden);
host.querySelector('.graph-gaps .graph-list-item').click();
assert.deepEqual(openedFromGaps, ['a1'], 'a gap article opens like a node');
const noGaps = d.createElement('div'); d.body.append(noGaps); ag.renderGraphList(noGaps, nodes, links, []);
assert.deepEqual([...noGaps.querySelectorAll('.graph-view-toggle button')].map(b => b.textContent), ['Graph', 'List'], 'no Gaps segment without gaps');

// ── cluster card ──
const sent = [];
globalThis.__ai = (m) => { sent.push(m); return { ok: true, text: /Question:/.test(m.user) ? 'Answer [1] <img src=x onerror=window.__pwned=1>' : '- point one [1] and [2]\n- point two [1, 2] and [9]' }; };
const cluster = [
    art('c1', ['Topic'], 40, { content: 'FULL ARTICLE TEXT SHOULD NOT LEAVE' }),
    art('c2', ['Topic'], 20, { lastOpened: new Date(now - DAY).toISOString() }),
    art('c3', ['Topic'], 10)
];
const stats = gc.clusterStats(cluster);
assert.deepEqual(stats, { total: 3, unopened: 2, withSummary: 3, exportable: 3 });
const area = d.createElement('div'); d.body.append(area);
const filtered = []; area.addEventListener('filter-by-tag', (e) => filtered.push(e.detail.tag));
const opened = []; area.addEventListener('open-article', (e) => opened.push(e.detail.id));
const card = gc.showClusterCard(area, { label: 'Topic <b>', articles: cluster });
assert.ok(card === area.querySelector('.graph-cluster-page'), 'a tap opens the cluster page directly');
assert.ok(/3 articles/.test(card.textContent) && /2 never opened/.test(card.textContent), card.textContent);
assert.ok(!card.querySelector('.graph-cluster-title b'), 'label is text');
assert.equal(card.querySelector('.graph-cluster-title').textContent, 'Topic <b>');
assert.ok(card.querySelector('.graph-cluster-map'), 'mini map');
assert.ok(card.querySelectorAll('.gcm-dot.is-new').length === 2 && card.querySelectorAll('.gcm-dot').length === 3, 'map: one dot per article, unopened accented');
const openers = [...card.querySelectorAll('.graph-cluster-list:not(.x) .graph-cluster-open:not(.is-opened) .graph-cluster-open-t')];
assert.deepEqual(openers.map(b => b.textContent), ['T c1', 'T c3'], 'only unopened, oldest first');
assert.ok(/Never opened/.test(card.textContent) && /Opened \(1\)/.test(card.querySelector('details summary').textContent), 'unopened list + collapsed opened group');
assert.ok(!card.querySelector('details').open, 'opened group is collapsed');
card.querySelector('.graph-cluster-open:not(.is-opened)').click(); assert.deepEqual(opened, ['c1']);

// briefing: covers the unopened ones, from summaries only
const brief = card.querySelector('.graph-cluster-brief');
assert.ok(/Brief me on the 2 unopened/.test(brief.textContent), 'briefing button names the count');
brief.click(); await tick(250);
assert.equal(sent.length, 1);
assert.ok(/Summary of c1/.test(sent[0].user) && /Summary of c3/.test(sent[0].user) && !/Summary of c2/.test(sent[0].user), 'unopened only');
assert.ok(!/FULL ARTICLE TEXT/.test(sent[0].user), 'article body never sent');
assert.ok(card.querySelector('.graph-cluster-answer').textContent.includes('point one'));
// [n] becomes a pill with the article's name that opens it; unknown numbers stay text
const pills = [...card.querySelectorAll('.graph-cluster-answer .graph-cite')];
assert.deepEqual(pills.map(p => p.textContent), ['1 · T c1', '2 · T c3', '1 · T c1', '2 · T c3'], 'numbers follow the order sent to the model (unopened first)');
assert.ok(/\[9\]/.test(card.querySelector('.graph-cluster-answer').textContent), 'out-of-range reference stays text');
opened.length = 0; pills[1].click(); assert.deepEqual(opened, ['c3'], 'pill opens its article');
const srcs = [...card.querySelectorAll('.graph-cluster-sources .graph-cluster-src')];
assert.deepEqual(srcs.map(b => b.textContent), ['1T c1', '2T c3'], 'numbered source list mirrors the pills');
opened.length = 0; srcs[1].click(); assert.deepEqual(opened, ['c3'], 'a source row opens its article');

// "Include in briefing": the Opened group's switch widens the briefing to every article
card.querySelector('details').open = true;
const sw = card.querySelector('.graph-cluster-switch');
assert.equal(sw.getAttribute('aria-checked'), 'false'); assert.ok(/on the 2 unopened/.test(brief.textContent));
sw.click();
assert.equal(sw.getAttribute('aria-checked'), 'true'); assert.ok(/Brief me on all 3/.test(brief.textContent), brief.textContent);
assert.ok(card.querySelectorAll('.graph-cluster-open.is-included').length >= 1, 'opened rows are marked as included');
brief.click(); await tick(250);
assert.equal(sent.length, 2); assert.ok(/Summary of c2/.test(sent[1].user), 'opened article now part of the briefing');
sent.pop();
sw.click(); assert.ok(/on the 2 unopened/.test(brief.textContent), 'switch back restores the default');

// question: whole topic, answer rendered as text
const input = card.querySelector('.graph-cluster-ask input'); input.value = 'What is common?';
card.querySelector('.graph-cluster-ask').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await tick(250);
assert.equal(sent.length, 2);
assert.ok(/Question: What is common\?/.test(sent[1].user) && /Summary of c2/.test(sent[1].user), 'a question looks at the whole topic');
const ans = card.querySelector('.graph-cluster-answer');
assert.ok(!ans.querySelector('img') && ans.textContent.includes('<img'), 'AI output is text, not markup');
assert.equal(w.__pwned, undefined);

// list = the old one-tap filter
card.querySelector('.graph-cluster-show').click();
assert.deepEqual(filtered, ['Topic <b>']); assert.ok(!area.querySelector('.graph-cluster-page'), 'page closes');

// feed items without a stored summary cannot be exported, but can be briefed from their snippets
const feedCard = gc.showClusterCard(area, { label: 'News', articles: [{ title: 'F1', snippet: 'snip one' }, { title: 'F2', snippet: 'snip two' }] });
const labels = [...feedCard.querySelectorAll('button')].map(b => b.textContent);
assert.ok(labels.some(l => /Brief me/.test(l)) && !labels.some(l => /Markdown/.test(l)), labels.join('|'));

// ── many articles: duplicates dropped, groups of 15, partial notes merged ──
const { askCluster, CLUSTER_MAX } = await imp('modules/feedAi.js');
const { dedupeArticles } = await imp('modules/textUtils.js');
assert.equal(CLUSTER_MAX, 15);
const many = Array.from({ length: 41 }, (_, i) => art('m' + i, ['Big'], 30 + i, { url: 'https://site.example/p' + i }));
const dups = [...many, art('dupA', ['Big'], 5, { url: 'https://www.site.example/p3/?utm_source=x' }), art('dupB', ['Big'], 4, { url: 'https://site.example/p7', lastOpened: new Date(now).toISOString() })];
assert.equal(dedupeArticles(dups).length, 41, 'same URL (tracking params, www, slash) counts once');
assert.equal(dedupeArticles(dups).find(a => /p7$/.test(a.url)).id, 'dupB', 'the already-opened copy is kept');
assert.equal(dedupeArticles([{ title: 'Same  Title' }, { title: 'same title' }, { title: 'other' }]).length, 2, 'no URL: same title counts once');
sent.length = 0;
const parts = [];
globalThis.__ai = (m) => { sent.push(m); return { ok: true, text: /combine partial/.test(m.system) ? 'Merged [1] and [41]' : 'note ' + (sent.length) + ' [' + (/\[(\d+)\]/.exec(m.user) || [])[1] + ']' }; };
const big = await askCluster(dups, { topic: 'Big' }, { onPart: (p) => parts.push(p.done + '/' + p.total) });
assert.equal(sent.length, 4, '41 unique → 3 groups + 1 merge: ' + sent.length);
assert.ok(/\[1\] /.test(sent[0].user) && /\[15\] /.test(sent[0].user) && !/\[16\] /.test(sent[0].user), 'first group is 1–15');
assert.ok(/\[16\] /.test(sent[1].user) && /\[30\] /.test(sent[1].user) && !/\[1\] /.test(sent[1].user), 'numbers stay global in the second group');
assert.ok(/\[31\] /.test(sent[2].user) && /\[41\] /.test(sent[2].user) && !/\[42\] /.test(sent[2].user), 'last group 31–41, no duplicates');
assert.ok(/combine partial/.test(sent[3].system) && /note 1/.test(sent[3].user) && /note 3/.test(sent[3].user), 'merge sees every partial answer');
assert.equal(big.used, 41); assert.equal(big.runs, 4); assert.equal(big.duplicates, 2); assert.equal(big.articles.length, 41);
assert.deepEqual(parts, ['0/4', '1/4', '2/4', '3/4'], 'progress is reported per step');
sent.length = 0;
const huge = await askCluster(Array.from({ length: 70 }, (_, i) => art('h' + i, ['H'], i, { url: 'https://h.example/' + i })), {}, {});
assert.equal(huge.used, 60); assert.equal(huge.skipped, 10); assert.equal(sent.length, 5, '4 groups + merge');
sent.length = 0; globalThis.__ai = (m) => { sent.push(m); return { ok: true, text: 'ok' }; };
await askCluster(many.slice(0, 15), {}, {}); assert.equal(sent.length, 1, '15 or fewer: single request, no merge');

// ── export of just one cluster ──
const { SK } = await imp('modules/storageKeys.js');
store[SK.articlesIndex] = [art('e1', ['T'], 5), art('e2', ['T'], 4), art('e3', ['U'], 3)];
const md = await imp('modules/markdownArchive.js');
const all = await md.buildArchiveFiles({});
const some = await md.buildArchiveFiles({ ids: ['e1', 'e2'] });
assert.equal(all.length, 3); assert.equal(some.length, 2);
assert.ok(some.every(f => /T e[12]\.md$/.test(f.name)));
assert.ok(some.find(f => /e1\.md/.test(f.name)).text.includes('[[T e2]]'), 'related links still resolve inside the cluster');
console.log('ok');
