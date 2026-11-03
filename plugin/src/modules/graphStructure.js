// graphStructure.js — the structure the archive graph draws, worked out locally from the tags.
// Pure functions: no DOM, no chrome.*, no network, no AI. Same input, same result (every tie is broken by id).
//
//   topicClusters()   tags that are used on the same articles end up in one cluster; the cluster is named after its most used tag
//   bridgeArticles()  articles whose tags reach into two or more clusters
//   neighborhood()    an item plus what is connected to it within N hops (focus mode)
//   shortestPath()    how two items are connected (path mode)
//   sourceType()      paper | video | pdf | article, from what the record already carries
//   maturityOf()      seed | growing | evergreen, from what you did with the article
//
// Nodes and links are the ones archiveGraph.js builds: { id, group: 'tag'|'article', label, degree?, data? } and
// { source, target, kind?: 'similarity' }, where source/target are ids or (after d3 ran) objects with an id.
import { paperState } from './paperInfo.js';
import { maturityOf as maturity } from './graphMaturity.js';

const idOf = (x) => (x && typeof x === 'object' ? x.id : x);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export const CLUSTER_MAX = 9;           // clusters shown; the rest is folded into "other" (the garden shows eight)
export const CLUSTER_MIN_ARTICLES = 3;  // a cluster with fewer articles is folded into "other"
const EDGE_MIN = 0.18;                  // co-occurrence strength (cosine) below which two tags do not pull each other
const SPLIT_SHARE = 0.55;               // a cluster holding more than this share of all articles is split once more …
const SPLIT_MIN_TAGS = 12;              // … when it has at least this many tags

// Subtopics: a cluster this big is looked at once more, article by article (see subdivide()).
export const SUB_MIN_ARTICLES = 12;     // smaller clusters stay as they are
export const SUB_MAX = 6;               // subtopics shown per cluster (the rest is folded into "other")
export const SUB_MIN_SIZE = 4;          // a group of fewer articles is not a subtopic
const UMBRELLA_SHARE = 0.6;             // a tag on more than this share of the cluster's articles describes the cluster, not a part of it
const MERGE_FACTOR = 0.3;              // two groups merge when their ties to each other are at least this fraction as dense as the looser group's own inside
const TERM_TIE = 0.5;                  // weight of the typical terms two articles share (from the similarity cache): the signal when tags are rare or missing
const SIM_WITH_TAGS = 0.4;             // weight of a similarity tie between two articles that both have tags of their own
const TOP_UMBRELLA_SHARE = 0.35;        // a tag on more than this share of ALL articles (a big archive's "tech") joins nothing: the topics are what is left
const TOP_UMBRELLA_MIN_ARTICLES = 30;   // … in an archive of at least this many articles
const GIANT_SHARE = 0.8;                // one group holding more than this share says nothing: tried once more with stricter links

/** Tag → set of article ids, from the tag links only (similarity links do not make an article part of a topic). */
function tagMembers(nodes, links) {
    const group = new Map(nodes.map(n => [n.id, n.group]));
    const members = new Map();
    nodes.forEach(n => { if (n.group === 'tag') members.set(n.id, new Set()); });
    links.forEach(l => {
        if (l.kind === 'similarity') return;
        const a = idOf(l.source), b = idOf(l.target);
        const [art, tag] = group.get(a) === 'article' && group.get(b) === 'tag' ? [a, b] : group.get(b) === 'article' && group.get(a) === 'tag' ? [b, a] : [null, null];
        if (art && members.has(tag)) members.get(tag).add(art);
    });
    return members;
}

/** Cosine-weighted tag co-occurrence: { tagId → Map(otherTagId → weight) }, edges under `min` dropped. */
function coOccurrence(members, min) {
    const tagsOf = new Map();
    members.forEach((set, tag) => set.forEach(a => (tagsOf.get(a) || tagsOf.set(a, []).get(a)).push(tag)));
    const pair = new Map();
    tagsOf.forEach(tags => {
        for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) {
            const [x, y] = tags[i] < tags[j] ? [tags[i], tags[j]] : [tags[j], tags[i]];
            const k = x + '\u0000' + y;
            pair.set(k, (pair.get(k) || 0) + 1);
        }
    });
    const adj = new Map();
    members.forEach((_, t) => adj.set(t, new Map()));
    pair.forEach((n, k) => {
        const [x, y] = k.split('\u0000');
        const w = n / Math.sqrt(members.get(x).size * members.get(y).size);
        if (w < min) return;
        adj.get(x).set(y, w); adj.get(y).set(x, w);
    });
    return adj;
}

/** Label propagation over `tags` (ids), asynchronous in a fixed order so the result never depends on the run. */
function propagate(tags, adj) {
    const order = [...tags].sort(byText);
    const inSet = new Set(order);
    const label = new Map(order.map(t => [t, t]));
    for (let round = 0; round < 12; round++) {
        let changed = false;
        for (const t of order) {
            const score = new Map();
            adj.get(t).forEach((w, o) => { if (inSet.has(o)) score.set(label.get(o), (score.get(label.get(o)) || 0) + w); });
            if (!score.size) continue;
            let best = label.get(t), bestW = score.get(best) || -1;
            [...score.entries()].sort((a, b) => b[1] - a[1] || byText(a[0], b[0])).forEach(([l, w]) => { if (w > bestW + 1e-9) { best = l; bestW = w; } });
            if (best !== label.get(t)) { label.set(t, best); changed = true; }
        }
        if (!changed) break;
    }
    const groups = new Map();
    order.forEach(t => (groups.get(label.get(t)) || groups.set(label.get(t), []).get(label.get(t))).push(t));
    return [...groups.values()];
}

/**
 * Subtopics of one cluster, found article by article. Two things tie articles together: tags they share (not counting the tags that
 * describe the whole cluster, an umbrella like "science" would glue everything) and similar content (the similarity links, which also
 * work when the articles carry nothing but the umbrella tag). Label propagation over those ties, in a fixed order.
 * A subtopic is named after the tag that is most specific to it, else after the two terms that are most typical of it.
 * Returns [] when the cluster does not fall apart into at least two groups of SUB_MIN_SIZE.
 */
function subdivide(cluster, { members, tagNode, links, subOtherLabel, groupLabel, termsOf }) {
    const arts = [...cluster.articleIds].sort(byText);
    const inC = new Set(arts);
    const total = arts.length;
    const tagsOf = new Map(arts.map(a => [a, []]));
    const count = new Map();
    members.forEach((set, tag) => set.forEach(a => { if (inC.has(a)) { tagsOf.get(a).push(tag); count.set(tag, (count.get(tag) || 0) + 1); } }));
    const umbrella = new Set([...count].filter(([, n]) => n / total >= UMBRELLA_SHARE).map(([t]) => t));
    const useTag = (t) => !umbrella.has(t) && count.get(t) >= 2;
    const own = new Map(arts.map(a => [a, tagsOf.get(a).filter(useTag)]));

    // ties between articles
    const tie = new Map(arts.map(a => [a, new Map()]));
    const add = (x, y, w) => { tie.get(x).set(y, (tie.get(x).get(y) || 0) + w); tie.get(y).set(x, (tie.get(y).get(x) || 0) + w); };
    const post = new Map();
    arts.forEach(a => own.get(a).forEach(t => (post.get(t) || post.set(t, []).get(t)).push(a)));
    const shared = new Map();
    post.forEach(list => { for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) { const k = list[i] + '\u0000' + list[j]; shared.set(k, (shared.get(k) || 0) + 1); } });
    shared.forEach((n, k) => { const [x, y] = k.split('\u0000'); add(x, y, n / Math.sqrt(own.get(x).length * own.get(y).length)); });
    // Similar content ties articles together too. Between two articles that both carry their own tags it counts less: the tags are what
    // the person said, similarity is there for the articles that said little.
    links.forEach(l => {
        if (l.kind !== 'similarity') return;
        const x = idOf(l.source), y = idOf(l.target);
        if (inC.has(x) && inC.has(y)) add(x, y, (l.score || 0.3) * (own.get(x).length && own.get(y).length ? SIM_WITH_TAGS : 1));
    });

    // Typical terms two articles share: only terms that set some articles apart (in 2 or more, but not in a big part of the cluster).
    if (termsOf) {
        const df = new Map(), list = new Map();
        arts.forEach(a => { const t = [...new Set(termsOf(a))]; list.set(a, t); t.forEach(w => df.set(w, (df.get(w) || 0) + 1)); });
        const cap = Math.min(Math.floor(total * 0.4), 40);
        const tpost = new Map();
        arts.forEach(a => list.get(a).forEach(w => { const n = df.get(w); if (n >= 2 && n <= cap) (tpost.get(w) || tpost.set(w, []).get(w)).push(a); }));
        const tshared = new Map();
        tpost.forEach(group => { for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) { const k = group[i] + '\u0000' + group[j]; tshared.set(k, (tshared.get(k) || 0) + 1); } });
        tshared.forEach((n, k) => { const [x, y] = k.split('\u0000'); add(x, y, TERM_TIE * n / Math.sqrt(list.get(x).length * list.get(y).length)); });
    }

    const communities = (minTie) => {
        const label = new Map(arts.map(a => [a, a]));
        for (let round = 0; round < 15; round++) {
            let changed = false;
            for (const a of arts) {
                const score = new Map();
                tie.get(a).forEach((w, o) => { if (w >= minTie) score.set(label.get(o), (score.get(label.get(o)) || 0) + w); });
                if (!score.size) continue;
                let best = label.get(a), bestW = score.get(best) || -1;
                [...score.entries()].sort((x, y) => y[1] - x[1] || byText(x[0], y[0])).forEach(([l, w]) => { if (w > bestW + 1e-9) { best = l; bestW = w; } });
                if (best !== label.get(a)) { label.set(a, best); changed = true; }
            }
            if (!changed) break;
        }
        const groups = new Map();
        arts.forEach(a => (groups.get(label.get(a)) || groups.set(label.get(a), []).get(label.get(a))).push(a));
        return [...groups.values()].sort((x, y) => y.length - x.length || byText(x[0], y[0]));
    };
    // Label propagation stops at small tight groups (articles with the same tags); groups that are tied together almost as tightly as
    // they are inside belong to one subtopic, so they are merged, best pair first, until nothing qualifies (never into a giant block).
    const agglomerate = (list) => {
        const g = list.map(x => x.slice());
        for (let guard = 0; guard < 300; guard++) {
            const of = new Map(); g.forEach((arr, i) => arr.forEach(a => of.set(a, i)));
            const inner = g.map(() => 0), between = new Map();
            arts.forEach(a => tie.get(a).forEach((w, o) => {
                if (!(a < o)) return;   // each pair once
                const i = of.get(a), j = of.get(o);
                if (i === j) inner[i] += w; else { const k = i < j ? i + '|' + j : j + '|' + i; between.set(k, (between.get(k) || 0) + w); }
            }));
            let best = null;
            between.forEach((sum, k) => {
                const [i, j] = k.split('|').map(Number), A = g[i], B = g[j];
                if (A.length < 2 || B.length < 2 || (A.length + B.length) / total > GIANT_SHARE) return;
                const ref = Math.min(inner[i] / (A.length * (A.length - 1) / 2), inner[j] / (B.length * (B.length - 1) / 2));
                const avg = sum / (A.length * B.length);
                if (!(ref > 0) || avg < MERGE_FACTOR * ref) return;
                const score = avg / ref;
                if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) < 1e-9 && k < best.k)) best = { i, j, score, k };
            });
            if (!best) break;
            g[best.i] = g[best.i].concat(g[best.j]); g.splice(best.j, 1);
        }
        return g.map(x => x.sort(byText)).sort((x, y) => y.length - x.length || byText(x[0], y[0]));
    };
    let groups = agglomerate(communities(0));
    if (groups[0].length / total > GIANT_SHARE) groups = agglomerate(communities(0.35));
    let real = groups.filter(g => g.length >= SUB_MIN_SIZE).slice(0, SUB_MAX);
    if (real.length < 2 || real[0].length / total > GIANT_SHARE) return [];

    // names
    const used = new Set();
    const nameOf = (g, idx) => {
        const k = g.length, inG = new Set(g);
        const tagCands = [];
        const inGroup = new Map();
        g.forEach(a => own.get(a).forEach(t => inGroup.set(t, (inGroup.get(t) || 0) + 1)));
        inGroup.forEach((c, t) => { if (c >= 2 && c / k >= 0.4) tagCands.push({ label: String(tagNode.get(t).label), score: (c / k) * (c / count.get(t)) }); });
        // the most specific tag; a second one joins when it is nearly as specific ("crispr · dna" says more than "crispr")
        tagCands.sort((x, y) => y.score - x.score || byText(x.label, y.label));
        let pick = tagCands.length ? { label: tagCands.filter((c, i) => i === 0 || (i === 1 && c.score >= 0.7 * tagCands[0].score)).map(c => c.label).join(' · ') } : null;
        if (!pick && termsOf) {
            const inCluster = new Map(), inGrp = new Map();
            arts.forEach(a => new Set(termsOf(a)).forEach(w => { inCluster.set(w, (inCluster.get(w) || 0) + 1); if (inG.has(a)) inGrp.set(w, (inGrp.get(w) || 0) + 1); }));
            const cands = [];
            inGrp.forEach((c, w) => { if (c >= 2 && c / k >= 0.35 && c / inCluster.get(w) >= 0.4) cands.push({ label: w, score: (c / k) * (c / inCluster.get(w)) }); });
            cands.sort((x, y) => y.score - x.score || byText(x.label, y.label));
            if (cands.length) pick = { label: cands.slice(0, 2).map(c => c.label).join(' · ') };
        }
        let label = pick ? pick.label : groupLabel + ' ' + (idx + 1);
        let unique = label, n = 2;
        while (used.has(unique.toLowerCase())) unique = label + ' (' + n++ + ')';
        label = unique; used.add(label.toLowerCase());
        return label;
    };
    const children = real.map((g, i) => ({ id: cluster.id + '/sub-' + i, label: nameOf(g, i), articleIds: new Set(g), size: g.length }));
    const placed = new Set(real.flat());
    const rest = arts.filter(a => !placed.has(a));
    if (rest.length) children.push({ id: cluster.id + '/sub-other', label: subOtherLabel, articleIds: new Set(rest), size: rest.length, other: true });
    return children;
}

/**
 * Topic clusters out of the tags.
 * @returns {{ clusters: Array<{ id, label, tagIds, articleIds, size }>, clusterOfTag: Map, clusterOfArticle: Map, otherId: string|null }}
 *   `clusters` is biggest first; the folded-away rest is one cluster with `other: true` (label from `otherLabel`) at the end.
 */
export function topicClusters(nodes, links, { otherLabel = 'Everything else', subOtherLabel = 'Other', groupLabel = 'Group', terms = null, subclusters = true, max = CLUSTER_MAX, minArticles = CLUSTER_MIN_ARTICLES } = {}) {
    const members = tagMembers(nodes, links);
    const tagNode = new Map(nodes.filter(n => n.group === 'tag').map(n => [n.id, n]));
    const articleIds = nodes.filter(n => n.group === 'article').map(n => n.id);
    // A tag on a big share of the whole archive says "this archive is about X", not which part of it. It would tie every topic together,
    // so it stays out of the co-occurrence graph; its articles are placed by their other tags.
    const topUmbrella = new Set();
    if (articleIds.length >= TOP_UMBRELLA_MIN_ARTICLES && members.size >= 8) members.forEach((set, t) => { if (set.size / articleIds.length >= TOP_UMBRELLA_SHARE) topUmbrella.add(t); });
    const graphMembers = topUmbrella.size ? new Map([...members].filter(([t]) => !topUmbrella.has(t))) : members;
    let groups = propagate([...graphMembers.keys()], coOccurrence(graphMembers, EDGE_MIN));

    // One giant cluster says nothing: split it once with a stricter co-occurrence threshold.
    const share = (g) => { const s = new Set(); g.forEach(t => members.get(t).forEach(a => s.add(a))); return s.size; };   // (articles, counted over all tags)
    const total = Math.max(1, articleIds.length);
    groups = groups.flatMap(g => (g.length >= SPLIT_MIN_TAGS && share(g) / total > SPLIT_SHARE)
        ? propagate(g, coOccurrence(new Map(g.map(t => [t, graphMembers.get(t)])), EDGE_MIN * 2))
        : [g]);

    const draft = groups.map((g) => {
        const arts = new Set(); g.forEach(t => members.get(t).forEach(a => arts.add(a)));
        const top = [...g].sort((a, b) => (members.get(b).size - members.get(a).size) || byText(String(tagNode.get(a).label), String(tagNode.get(b).label)))[0];
        return { id: 'cluster-' + top.replace(/^tag-/, ''), label: tagNode.get(top).label, tagIds: g, articleIds: arts, size: arts.size };
    }).sort((a, b) => b.size - a.size || byText(a.id, b.id));

    const keep = draft.filter((c, i) => i < max && c.size >= minArticles);
    const rest = draft.filter(c => !keep.includes(c));
    const clusters = keep.map(c => ({ ...c, articleIds: new Set(), size: 0 }));
    const clusterOfTag = new Map();
    keep.forEach(c => c.tagIds.forEach(t => clusterOfTag.set(t, c.id)));

    // An article belongs to the cluster most of its tags are in (ties: the bigger, then the earlier cluster).
    const tagsOfArticle = new Map();
    members.forEach((set, t) => set.forEach(a => (tagsOfArticle.get(a) || tagsOfArticle.set(a, []).get(a)).push(t)));
    const clusterOfArticle = new Map();
    const rank = new Map(clusters.map((c, i) => [c.id, i]));
    articleIds.forEach((a) => {
        const votes = new Map();
        (tagsOfArticle.get(a) || []).forEach(t => { const c = clusterOfTag.get(t); if (c) votes.set(c, (votes.get(c) || 0) + 1); });
        if (!votes.size) return;
        const best = [...votes.entries()].sort((x, y) => y[1] - x[1] || rank.get(x[0]) - rank.get(y[0]))[0][0];
        clusterOfArticle.set(a, best);
    });
    // Articles that only hang on by a similarity link follow the article they are similar to.
    // Strongest first, two passes, so a chain of similar articles is settled the same way every time.
    const sim = links.filter(l => l.kind === 'similarity').sort((a, b) => (b.score || 0) - (a.score || 0) || byText(String(idOf(a.source)) + idOf(a.target), String(idOf(b.source)) + idOf(b.target)));
    for (let pass = 0; pass < 2; pass++) {
        sim.forEach(l => {
            const s = idOf(l.source), t = idOf(l.target);
            if (!clusterOfArticle.has(s) && clusterOfArticle.has(t)) clusterOfArticle.set(s, clusterOfArticle.get(t));
            else if (!clusterOfArticle.has(t) && clusterOfArticle.has(s)) clusterOfArticle.set(t, clusterOfArticle.get(s));
        });
    }

    let otherId = null;
    const stray = articleIds.filter(a => !clusterOfArticle.has(a));
    if (rest.length || stray.length) {
        otherId = 'cluster-other';
        const other = { id: otherId, label: otherLabel, tagIds: rest.flatMap(c => c.tagIds), articleIds: new Set(), size: 0, other: true };
        other.tagIds.forEach(t => clusterOfTag.set(t, otherId));
        stray.forEach(a => clusterOfArticle.set(a, otherId));
        clusters.push(other);
    }
    clusterOfArticle.forEach((c, a) => { const cl = clusters.find(x => x.id === c); cl.articleIds.add(a); cl.size++; });
    const kept = clusters.filter(c => c.size > 0 || c.tagIds.length);
    const subOfArticle = new Map();
    if (subclusters) {
        const dataId = new Map(nodes.filter(n => n.group === 'article').map(n => [n.id, n.data && n.data.id]));
        kept.forEach(c => {
            c.children = c.other || c.size < SUB_MIN_ARTICLES ? [] : subdivide(c, { members, tagNode, links, subOtherLabel, groupLabel, termsOf: terms ? (aid) => terms[dataId.get(aid)] || [] : null });
            c.children.forEach(ch => ch.articleIds.forEach(a => subOfArticle.set(a, ch.id)));
        });
    } else kept.forEach(c => { c.children = []; });
    return { clusters: kept, clusterOfTag, clusterOfArticle, otherId, subOfArticle };
}

/** Articles whose tags reach into two or more clusters (the "other" cluster does not count): Map(articleId → [clusterId, …]). */
export function bridgeArticles(nodes, links, { clusterOfTag, otherId }) {
    const group = new Map(nodes.map(n => [n.id, n.group]));
    const reach = new Map();
    links.forEach(l => {
        if (l.kind === 'similarity') return;
        const a = idOf(l.source), b = idOf(l.target);
        const [art, tag] = group.get(a) === 'article' ? [a, b] : [b, a];
        const c = clusterOfTag.get(tag);
        if (!c || c === otherId) return;
        (reach.get(art) || reach.set(art, new Set()).get(art)).add(c);
    });
    const out = new Map();
    reach.forEach((set, a) => { if (set.size >= 2) out.set(a, [...set].sort(byText)); });
    return out;
}

function adjacency(nodes, links) {
    const adj = new Map(nodes.map(n => [n.id, new Set()]));
    links.forEach(l => {
        const a = idOf(l.source), b = idOf(l.target);
        if (adj.has(a) && adj.has(b)) { adj.get(a).add(b); adj.get(b).add(a); }
    });
    return adj;
}

/** `id` and everything within `hops` links of it (tags and similarity links both count): Set of ids. Unknown id → empty set. */
export function neighborhood(nodes, links, id, hops = 1) {
    const adj = adjacency(nodes, links);
    if (!adj.has(id)) return new Set();
    const seen = new Set([id]);
    let edge = [id];
    for (let h = 0; h < hops; h++) {
        const next = [];
        edge.forEach(x => [...adj.get(x)].sort(byText).forEach(y => { if (!seen.has(y)) { seen.add(y); next.push(y); } }));
        edge = next;
    }
    return seen;
}

/** Shortest chain of ids from `from` to `to` (both included), or null when they are not connected. Similarity links count. */
export function shortestPath(nodes, links, from, to) {
    const adj = adjacency(nodes, links);
    if (!adj.has(from) || !adj.has(to)) return null;
    if (from === to) return [from];
    const prev = new Map([[from, null]]);
    const queue = [from];
    while (queue.length) {
        const x = queue.shift();
        for (const y of [...adj.get(x)].sort(byText)) {
            if (prev.has(y)) continue;
            prev.set(y, x);
            if (y === to) { const path = [to]; let p = x; while (p !== null) { path.unshift(p); p = prev.get(p); } return path; }
            queue.push(y);
        }
    }
    return null;
}

const VIDEO_HOST = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|twitch\.tv|dailymotion\.com)$/i;
/** 'paper' | 'video' | 'pdf' | 'article'. Uses what the record carries (paper detection, URL); never fetches anything. */
export function sourceType(a) {
    if (!a) return 'article';
    if (paperState(a)) return 'paper';
    const url = String(a.url || a.link || '');
    let host = '', path = '';
    try { const u = new URL(url); host = u.hostname; path = u.pathname; } catch (_) { /* not absolute */ }
    if (a.isVideo || a.videoId || VIDEO_HOST.test(host)) return 'video';
    if (a.isPdf || /\.pdf$/i.test(path) || /^application\/pdf/i.test(String(a.contentType || ''))) return 'pdf';
    return 'article';
}

/** See graphMaturity.js (kept here so the graph code and its tests have one place to import from). */
export const maturityOf = maturity;
