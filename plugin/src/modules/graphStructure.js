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

const idOf = (x) => (x && typeof x === 'object' ? x.id : x);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export const CLUSTER_MAX = 9;           // clusters shown; the rest is folded into "other" (the garden shows eight)
export const CLUSTER_MIN_ARTICLES = 3;  // a cluster with fewer articles is folded into "other"
const EDGE_MIN = 0.18;                  // co-occurrence strength (cosine) below which two tags do not pull each other
const SPLIT_SHARE = 0.55;               // a cluster holding more than this share of all articles is split once more …
const SPLIT_MIN_TAGS = 12;              // … when it has at least this many tags

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
 * Topic clusters out of the tags.
 * @returns {{ clusters: Array<{ id, label, tagIds, articleIds, size }>, clusterOfTag: Map, clusterOfArticle: Map, otherId: string|null }}
 *   `clusters` is biggest first; the folded-away rest is one cluster with `other: true` (label from `otherLabel`) at the end.
 */
export function topicClusters(nodes, links, { otherLabel = 'Everything else', max = CLUSTER_MAX, minArticles = CLUSTER_MIN_ARTICLES } = {}) {
    const members = tagMembers(nodes, links);
    const tagNode = new Map(nodes.filter(n => n.group === 'tag').map(n => [n.id, n]));
    const articleIds = nodes.filter(n => n.group === 'article').map(n => n.id);
    let groups = propagate([...members.keys()], coOccurrence(members, EDGE_MIN));

    // One giant cluster says nothing: split it once with a stricter co-occurrence threshold.
    const share = (g) => { const s = new Set(); g.forEach(t => members.get(t).forEach(a => s.add(a))); return s.size; };
    const total = Math.max(1, articleIds.length);
    groups = groups.flatMap(g => (g.length >= SPLIT_MIN_TAGS && share(g) / total > SPLIT_SHARE)
        ? propagate(g, coOccurrence(new Map(g.map(t => [t, members.get(t)])), EDGE_MIN * 2))
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
    return { clusters: clusters.filter(c => c.size > 0 || c.tagIds.length), clusterOfTag, clusterOfArticle, otherId };
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

/**
 * How far an article has been worked: 'seed' (saved), 'growing' (opened or summarised), 'evergreen' (opened, summarised and
 * you added highlights or notes). `notes` = your highlights + notes on it (0 when unknown).
 */
export function maturityOf(a, notes = 0) {
    if (!a) return 'seed';
    const score = (a.lastOpened ? 1 : 0) + (String(a.summary || '').trim() ? 1 : 0) + (notes > 0 ? 1 : 0);
    return score >= 3 ? 'evergreen' : score >= 1 && (a.lastOpened || notes > 0) ? 'growing' : 'seed';
}
