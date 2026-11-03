// archiveGraph.js
// Knowledge graph visualization for article tags using D3.js with Pan/Zoom support
//
// Performance notes (v2):
// - By default, tags with fewer than MIN_TAG_DEGREE_DEFAULT connections are
//   hidden. On large archives most tags are one-offs; showing them all turns
//   the graph into an unreadable, slow-to-simulate hairball. A toggle lets
//   the user opt into "show everything".
// - Link/node coloring used to look up nodes via `nodes.find(...)` — O(n)
//   per link, O(links * nodes) overall. Replaced with a Map for O(1) lookup.
// - A hard NODE_CAP protects the simulation if someone has a huge archive
//   even after tag filtering.
//
// v3: articles whose only tags are one-offs (or that have no tags at all)
// used to just vanish from the graph — tag links were the only way to get
// a node placed at all. They now get one shot at attaching via content
// similarity instead, reusing the TF-IDF index localSearch.js already
// builds for search/"similar articles" (see mostSimilarIncluded below).
//
// v4 (interaction layer):
// - No graph-local search box — the archive's own search (history top bar)
//   already decides what this graph reacts to; a second search input here
//   would just duplicate it. Instead there's a Filtered/Entire-archive scope
//   switch for HOW it reacts: 'filtered' rebuilds to only the matching
//   articles (nodes for non-matches disappear); 'all' keeps every node in
//   the graph and just dims non-matches (Obsidian-style: matches + their
//   direct neighbors stay full opacity), so spatial context never breaks.
// - Neglected-article surfacing: article nodes fade/shrink and shift toward
//   the danger end of the palette the longer they sit unopened past
//   NEGLECT_THRESHOLD_DAYS, turning the graph into "here's what you're
//   quietly ignoring" rather than just "here's what you've read".
// - Tag nodes are now clickable: they dispatch a `filter-by-tag` event so
//   the archive list can filter to that tag (graph becomes a navigation
//   surface, not just a read-only map).
// - A minimal legend explains the solid/arrowed tag links vs the dashed
//   similarity links.

import { cosineSim } from './localSearch.js';
import { T, TN, uiLocale } from './feedI18n.js';
import { conceptKey, isKnownTopic, topicLabel } from './topicConcepts.js';
import { fetchAnnotationsForArticle, escapeHtml } from './annotationExporter.js';
import { setIconLabel } from './icons.js';
import { paperState } from './paperInfo.js';

import { topicClusters, bridgeArticles, neighborhood, shortestPath, sourceType, maturityOf } from './graphStructure.js';

// v5 (structure layer, see GRAPH.md): with enough articles the graph opens as an OVERVIEW — topic clusters worked out locally
// from the tags (graphStructure.js), one label per cluster, small unlabeled dots, no links — and the old node-and-link picture is
// one tap away as DETAIL. Article labels in DETAIL show on hover/focus instead of all at once. Focus mode, path mode, source-type
// rings, maturity fill and bridge articles sit on top of both.
const OVERVIEW_MIN_ARTICLES = 25;   // below this the plain graph is readable as it is
const FOCUS_CLASS = 'graph-focus-dim';
const PATH_CLASS = 'graph-path';
const GRAPH_SIM_MIN = 0.25;         // content-similarity links drawn between articles (graphSimilarity.js), best ones only
const GRAPH_SIM_PER_ARTICLE = 2;
const FOCUS_LABELS = 8;             // article labels shown when a cluster or neighbourhood is in focus
const MATURITY_FILL = { seed: 0.45, growing: 0.75, evergreen: 1 };   // fill strength by how far an article was worked
const RING_DASH = { paper: null, video: '3 2', pdf: '1 2' };         // ring style by source type (plain articles: no ring)
// literal T('…') calls so the string extractor (scripts/feed-i18n.mjs) finds them
const sourceName = (k) => (k === 'paper' ? T('Paper') : k === 'video' ? T('Video') : k === 'pdf' ? T('PDF') : '');

let d3LoadPromise = null;

// Brand-harmonious tag palette (anchored to accent blue #2563eb)
const TAG_PALETTE = [
    '#7c3aed', // violet
    '#0891b2', // cyan
    '#059669', // emerald
    '#d97706', // amber
    '#db2777', // pink
    '#0284c7', // sky
    '#65a30d', // lime
    '#dc2626', // red
    '#7c3aed', // violet (repeat for large tag sets)
    '#9333ea', // purple
];

const MIN_TAG_DEGREE_DEFAULT = 2; // default: hide tags used on fewer than 2 articles
const NODE_CAP = 300;             // hard safety cap even when "show all" is on

// Neglected-article surfacing: an article is "neglected" once it has sat
// unopened for this many days. We fade/shrink it and shift its ring toward
// the danger end of the palette, so the graph reads as "what you're quietly
// ignoring" rather than treating every save identically.
const NEGLECT_THRESHOLD_DAYS = 30;
// How much a neglected article fades/shrinks. Kept gentle — the point is to
// draw the eye to the stale ones, not to make the graph unreadable.
const NEGLECT_FADE = 0.55;
const NEGLECT_SHRINK = 0.8;
// CSS class applied to non-matching nodes/links/labels by applyGraphSearchDim()
// (see styles.css) instead of a per-element inline opacity style.
const DIM_CLASS = 'graph-search-dim';

// Deterministic color per tag name
function tagColor(tagLabel) {
    let hash = 0;
    for (let i = 0; i < tagLabel.length; i++) {
        hash = (hash * 31 + tagLabel.charCodeAt(i)) >>> 0;
    }
    return TAG_PALETTE[hash % TAG_PALETTE.length];
}

/**
 * Finds the most similar already-included article for a given orphan,
 * using the prebuilt TF-IDF index (see localSearch.js). Returns null if
 * there's no index, no vector for this article, or nothing clears the
 * similarity floor — in which case the article stays unconnected.
 */
function mostSimilarIncluded(similarityIndex, article, allArticles, includedArticleIds, minScore = 0.15) {
    if (!similarityIndex) return null;
    const vec = similarityIndex.vectors.get(article.timestamp);
    if (!vec || vec.size === 0) return null;

    let best = null;
    for (const candidate of allArticles) {
        const candidateId = 'article-' + (candidate.timestamp || '');
        if (!includedArticleIds.has(candidateId)) continue;
        const candidateVec = similarityIndex.vectors.get(candidate.timestamp);
        if (!candidateVec) continue;
        const sim = cosineSim(vec, candidateVec);
        if (sim >= minScore && (!best || sim > best.score)) best = { id: candidateId, score: sim };
    }
    return best;
}

/**
 * Builds { nodes, links, hiddenTagCount } from articles.
 * @param {Array} articles
 * @param {number} minTagDegree - tags appearing on fewer than this many
 *        articles are dropped entirely (their links too). Pass 1 to show all.
 * @param {object|null} similarityIndex - prebuilt TF-IDF index (from
 *        localSearch.js's buildIndex), shared with search/similar-articles
 *        so orphaned articles can be reconnected without any extra
 *        indexing pass. Pass null to skip reconnection entirely.
 */
// One node per topic, not per spelling: News / Nachrichten / Noticias share a node, shown in the UI language.
const tagIdOf = (tag) => 'tag-' + (isKnownTopic(tag) ? 'c-' + conceptKey(tag).replace(/^c:/, '') : tag.toLowerCase()).replace(/\s+/g, '-');
const tagLabelOf = (tag) => topicLabel(tag, uiLocale());

// "Started, never deepened": topics with at most GAP_MAX_ARTICLES saved articles where nothing was opened for GAP_DAYS.
const GAP_DAYS = 30;
const GAP_MAX_ARTICLES = 2;
const GAP_CAP = 25;
const stamp = (a) => { const t = new Date(a.lastOpened || a.timestamp).getTime(); return Number.isFinite(t) ? t : 0; };

/**
 * Topics that were started and never followed up: { id, label, articles, last, never } — never-opened topics first,
 * then the longest untouched. Counted over ALL articles (rarely-used tags are hidden in the graph, so this is
 * the one place they show up).
 */
export function findGaps(articles, { now = Date.now(), days = GAP_DAYS, maxArticles = GAP_MAX_ARTICLES, cap = GAP_CAP } = {}) {
    const byTag = new Map();
    (articles || []).forEach(a => (a.tags || []).forEach(tag => {
        const id = tagIdOf(tag);
        let e = byTag.get(id);
        if (!e) byTag.set(id, e = { id, label: tagLabelOf(tag), articles: [] });
        if (!e.articles.includes(a)) e.articles.push(a);
    }));
    const out = [];
    byTag.forEach(e => {
        if (e.articles.length > maxArticles) return;
        const last = Math.max(...e.articles.map(stamp));
        if ((now - last) / 86400000 < days) return;
        out.push({ ...e, last, never: e.articles.every(a => !a.lastOpened) });
    });
    return out.sort((a, b) => (b.never - a.never) || (a.last - b.last)).slice(0, cap);
}

/** The articles connected to one tag node (tag links only; similarity links do not make an article part of a topic). */
export function articlesOfTag(nodes, links, tagId) {
    const byId = new Map(nodes.map(n => [n.id, n]));
    const id = (x) => (typeof x === 'object' ? x.id : x);
    const out = new Map();
    links.forEach(l => {
        if (l.kind === 'similarity') return;
        const a = byId.get(id(l.source)), b = byId.get(id(l.target));
        if (!a || !b) return;
        const art = a.group === 'article' && b.id === tagId ? a : b.group === 'article' && a.id === tagId ? b : null;
        if (art && art.data) out.set(art.id, art.data);
    });
    return [...out.values()];
}

// Time window over the graph: article nodes outside [from, to] (whole months) fade, topics with nothing inside fade too.
const TIME_DIM_CLASS = 'graph-time-dim';
/** One row at the top of the graph: view switch (Graph / List / Gaps) with the filter chips (Research, Time) right next to it. */
function graphTopbar(container) {
    let t = container.querySelector(':scope > .graph-topbar');
    if (!t) { t = document.createElement('div'); t.className = 'graph-topbar'; container.prepend(t); }
    return t;
}
export function monthIndex(ts) { const d = new Date(ts); return d.getFullYear() * 12 + d.getMonth(); }
export function monthsOf(articles) {
    const idx = (articles || []).map(a => new Date(a.timestamp).getTime()).filter(Number.isFinite).map(monthIndex);
    return idx.length ? { min: Math.min(...idx), max: Math.max(...idx) } : null;
}
/** Articles per month from span.min..span.max (array index 0 = span.min). Pure. */
export function monthHistogram(articles, span) {
    if (!span) return [];
    const out = new Array(span.max - span.min + 1).fill(0);
    (articles || []).forEach((a) => { const t = new Date(a.timestamp).getTime(); if (Number.isFinite(t)) { const i = monthIndex(t) - span.min; if (i >= 0 && i < out.length) out[i]++; } });
    return out;
}
const monthLabel = (i) => new Date(Math.floor(i / 12), i % 12, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
/** Which node ids stay visible in [fromIdx, toIdx] (month indexes). Pure. */
export function visibleInRange(nodes, links, fromIdx, toIdx) {
    const id = (x) => (typeof x === 'object' ? x.id : x);
    const visible = new Set();
    nodes.forEach(n => {
        if (n.group !== 'article') return;
        const t = new Date(n.data && n.data.timestamp).getTime();
        if (!Number.isFinite(t)) { visible.add(n.id); return; }
        const m = monthIndex(t);
        if (m >= fromIdx && m <= toIdx) visible.add(n.id);
    });
    const tagsOn = new Set();
    links.forEach(l => { const s = id(l.source), t = id(l.target); if (visible.has(s)) tagsOn.add(t); if (visible.has(t)) tagsOn.add(s); });
    nodes.forEach(n => { if (n.group === 'tag' && tagsOn.has(n.id)) visible.add(n.id); });
    return visible;
}

function buildGraphData(articles, minTagDegree = MIN_TAG_DEGREE_DEFAULT, similarityIndex = null, simLinks = null) {
    // 1. Count tag degree first, so we can filter before building nodes/links.
    const tagDegree = new Map(); // tagId -> count
    const tagLabelById = new Map();

    articles.forEach(article => {
        (article.tags || []).forEach(tag => {
            const tagId = tagIdOf(tag);
            tagDegree.set(tagId, (tagDegree.get(tagId) || 0) + 1);
            tagLabelById.set(tagId, tagLabelOf(tag));
        });
    });

    const allowedTagIds = new Set(
        Array.from(tagDegree.entries())
            .filter(([, count]) => count >= minTagDegree)
            .map(([id]) => id)
    );
    const hiddenTagCount = tagDegree.size - allowedTagIds.size;

    // 2. Build nodes/links, skipping filtered-out tags and articles that end
    //    up with zero remaining tags (they'd just be disconnected dots) —
    //    those get a second chance below via content similarity.
    const nodes = [];
    const links = [];
    const nodeById = new Map();

    articles.forEach(article => {
        const articleTags = (article.tags || []).filter(tag => {
            const tagId = tagIdOf(tag);
            return allowedTagIds.has(tagId);
        });
        if (articleTags.length === 0) return;

        const title = article.title || article.content?.split('\n')[0] || T('Untitled');
        const id = 'article-' + (article.timestamp || Math.random());
        const articleNode = { id, label: title, group: 'article', data: article };
        nodeById.set(id, articleNode);
        nodes.push(articleNode);

        articleTags.forEach(tag => {
            const tagId = tagIdOf(tag);
            if (!nodeById.has(tagId)) {
                const tagNode = { id: tagId, label: tagLabelOf(tag), group: 'tag', degree: tagDegree.get(tagId) };
                nodeById.set(tagId, tagNode);
                nodes.push(tagNode);
            }
            links.push({ source: id, target: tagId });
        });
    });

    // 3. Reconnect orphans: articles that lost every tag link (no tags at
    //    all, or every tag they had was filtered out for being rarely
    //    used) would otherwise vanish from the graph entirely. Give each
    //    one shot at attaching to its most topically similar included
    //    article via the shared TF-IDF index instead.
    const includedArticleIds = new Set(nodes.filter(n => n.group === 'article').map(n => n.id));
    let reconnectedCount = 0;
    let stillOrphanCount = 0;

    // Content neighbours from the background similarity cache (graphSimilarity.js), keyed by article id.
    const nodeOfArticleId = new Map();
    nodes.forEach(n => { if (n.group === 'article' && n.data && n.data.id) nodeOfArticleId.set(n.data.id, n.id); });
    const cacheBest = (article) => {
        for (const [oid, score] of (simLinks && simLinks[article.id]) || []) {
            const nid = nodeOfArticleId.get(oid);
            if (nid && score >= GRAPH_SIM_MIN) return { id: nid, score };
        }
        return null;
    };

    articles.forEach(article => {
        if (!article.timestamp) { stillOrphanCount++; return; }
        const id = 'article-' + article.timestamp;
        if (includedArticleIds.has(id)) return; // already has a tag link

        const best = mostSimilarIncluded(similarityIndex, article, articles, includedArticleIds) || cacheBest(article);
        if (best) {
            const title = article.title || article.content?.split('\n')[0] || T('Untitled');
            const orphanNode = { id, label: title, group: 'article', data: article };
            nodeById.set(id, orphanNode);
            nodes.push(orphanNode);
            links.push({ source: id, target: best.id, kind: 'similarity', score: best.score });
            includedArticleIds.add(id);
            if (article.id) nodeOfArticleId.set(article.id, id);
            reconnectedCount++;
        } else {
            stillOrphanCount++;
        }
    });

    // 4. Content similarity between articles that already have tags too: a few dashed links to their closest neighbours. They make
    //    focus and path find more, and tag-poor articles follow them into a topic (graphStructure.js).
    if (simLinks) {
        const pairKey = (x, y) => (x < y ? x + '|' + y : y + '|' + x);
        const seen = new Set(links.filter(l => l.kind === 'similarity').map(l => pairKey(l.source, l.target)));
        nodeOfArticleId.forEach((nid, aid) => {
            (simLinks[aid] || []).slice(0, GRAPH_SIM_PER_ARTICLE).forEach(([oid, score]) => {
                const other = nodeOfArticleId.get(oid);
                if (!other || score < GRAPH_SIM_MIN) return;
                const k = pairKey(nid, other);
                if (seen.has(k)) return;
                seen.add(k);
                links.push({ source: nid, target: other, kind: 'similarity', score });
            });
        });
    }

    return { nodes, links, nodeById, hiddenTagCount, reconnectedCount, stillOrphanCount };
}

/**
 * Enforces NODE_CAP by keeping the highest-degree tag nodes and their
 * connected articles, dropping the rest. Cheap safety net for huge archives.
 */
function capGraphData({ nodes, links, nodeById }) {
    if (nodes.length <= NODE_CAP) return { nodes, links, nodeById };

    const tagNodesSorted = nodes
        .filter(n => n.group === 'tag')
        .sort((a, b) => (b.degree || 0) - (a.degree || 0));

    const keptTagIds = new Set(tagNodesSorted.slice(0, Math.floor(NODE_CAP * 0.4)).map(n => n.id));
    const tagLinks = links.filter(l => l.kind !== 'similarity' && keptTagIds.has(typeof l.target === 'object' ? l.target.id : l.target));
    const keptArticleIds = new Set(tagLinks.map(l => typeof l.source === 'object' ? l.source.id : l.source));

    // Similarity links only survive if both endpoints already made the cut
    // on tag connectivity — otherwise we'd be re-introducing nodes the cap
    // was specifically trying to drop.
    const similarityLinks = links.filter(l => {
        if (l.kind !== 'similarity') return false;
        const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
        const targetId = typeof l.target === 'object' ? l.target.id : l.target;
        return keptArticleIds.has(sourceId) && keptArticleIds.has(targetId);
    });

    const keptLinks = [...tagLinks, ...similarityLinks];
    const keptNodes = nodes.filter(n =>
        (n.group === 'tag' && keptTagIds.has(n.id)) ||
        (n.group === 'article' && keptArticleIds.has(n.id))
    );
    const keptNodeById = new Map(keptNodes.map(n => [n.id, n]));

    return { nodes: keptNodes, links: keptLinks, nodeById: keptNodeById, capped: true };
}

function loadD3() {
    if (typeof d3 !== 'undefined') return Promise.resolve();
    if (d3LoadPromise) return d3LoadPromise;
    d3LoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('lib/d3.min.js');
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('D3 library failed to load.'));
        document.head.appendChild(script);
    });
    return d3LoadPromise;
}

/**
 * @param {HTMLElement} container
 * @param {Array} articles - the node set to render. articleManager.js
 *        decides what this is (whole archive, or already narrowed to a
 *        search match) before calling in — this module never filters
 *        `articles` itself. Dimming non-matches when showing the whole
 *        archive is a separate step; see applyGraphSearchDim().
 * @param {string|number} highlightTimestamp
 * @param {object|null} similarityIndex
 * @returns {Promise<void>|undefined} resolves once the graph has finished
 *        rendering (undefined if `articles` was empty and nothing was
 *        rendered) — callers that need to act on the finished DOM, e.g.
 *        applying search dimming right after a scope switch, can chain on it.
 */
export function initArchiveGraph(container, articles, highlightTimestamp, similarityIndex = null) {
    if (!container || !articles || articles.length === 0) return undefined;

    // If a previous graph is still running in this container, tear it down
    // first. A D3 forceSimulation keeps ticking on an animation loop and
    // retains the whole node/link object graph; leaving one running while
    // we build a replacement leaks CPU + memory and stacks duplicate
    // ResizeObserver/window listeners.
    destroyArchiveGraph(container);

    container.innerHTML = '';
    container.style.position = 'relative';
    container.style.width = '100%';
    // Height comes from CSS (fills what is left below the top bar, above the bottom nav).
    container.style.removeProperty('height');
    container.style.overflow = 'hidden';

    // Has the person started using this picture? Then a better result from the background run is offered, not swapped in.
    container.__graphTouched = false;
    if (!container.__graphTouchListeners) {
        container.__graphTouchListeners = true;
        ['pointerdown', 'wheel', 'keydown', 'focusin'].forEach(ev => container.addEventListener(ev, () => { container.__graphTouched = true; }, { passive: true }));
    }

    return loadD3()
        .then(() => waitForLayout(container))
        .then(() => renderGraph(container, articles, highlightTimestamp, MIN_TAG_DEGREE_DEFAULT, similarityIndex))
        .catch(() => {
            container.innerHTML = `<div class="graph-empty">${T('D3 library failed to load.')}</div>`;
        });
}

/**
 * Resolves once `container` has a non-zero size (or after `maxMs`, so a
 * genuinely hidden container can't hang the render). When the extension
 * loads already in split mode, the graph can be rendered before the split
 * layout has settled: clientWidth/Height read 0 (or the pre-split size), the
 * SVG is built against the 400x400 fallback and nothing shows until a
 * resize triggers a re-measure. Waiting a few frames for real dimensions
 * avoids that.
 */
function waitForLayout(container, maxMs = 1000) {
    return new Promise(resolve => {
        const start = performance.now();
        const check = () => {
            if ((container.clientWidth > 0 && container.clientHeight > 0) || performance.now() - start > maxMs) {
                resolve();
            } else {
                requestAnimationFrame(check);
            }
        };
        check();
    });
}

/**
 * Restyles an already-rendered graph's opacity to dim non-matches against
 * `query`, without rebuilding — no simulation restart, nodes stay put. This
 * is what 'all' scope uses so search narrows visually (matches + their
 * direct neighbors at full opacity, everything else faded) while every
 * node/link stays present, instead of 'filtered' scope's hard rebuild that
 * removes non-matching nodes outright.
 *
 * No-ops if `container` has no rendered graph (e.g. still loading, or torn
 * down) — callers don't need to guard for that themselves.
 *
 * The actual DOM pass is deferred to the next animation frame rather than
 * run synchronously here, and a call that arrives before that frame paints
 * cancels and replaces the pending one — so even an un-debounced caller
 * can't stack up more than one restyle per frame. articleManager.js also
 * debounces its keystroke-driven calls (GRAPH_SEARCH_DIM_DELAY) on top of
 * this. Within that one pass, applyGraphSearchDimNow() dims via a CSS class
 * (not a per-node inline style) and only touches nodes/links/labels whose
 * dim state actually changed since the last query, so it stays cheap even
 * on a large archive.
 *
 * @param {HTMLElement} container
 * @param {string} query - raw search text (trimmed/lowercased inside); an
 *        empty query restores every node/link/label to its natural opacity.
 */
export function applyGraphSearchDim(container, query) {
    if (!container?.__archiveGraphSelections) return;

    // One rAF in flight per container — a call that arrives before the
    // previous one has painted replaces it instead of stacking, so bursts
    // (even post-debounce ones) still only ever do one DOM pass per frame.
    if (container.__archiveGraphDimRaf) {
        cancelAnimationFrame(container.__archiveGraphDimRaf);
    }
    container.__archiveGraphDimRaf = requestAnimationFrame(() => {
        container.__archiveGraphDimRaf = null;
        const selections = container.__archiveGraphSelections;
        if (!selections) return; // graph was torn down before this frame ran
        applyGraphSearchDimNow(selections, query);
    });
}

function applyGraphSearchDimNow(selections, query) {
    const { node, link, label } = selections;
    const q = (query || '').trim().toLowerCase();

    // A DIM_CLASS is a CSS class (see styles.css), not a per-element inline
    // style — the browser can restyle a class toggle without the layout
    // engine evaluating a function per node, which is what made the old
    // .style('opacity', fn) pass slow on large archives. On top of that,
    // we diff against the previously-dimmed set and only touch elements
    // whose dim state actually changed between keystrokes, instead of
    // rewriting the class on every node/link/label every time — so typing
    // one more character into an already-narrow match set costs O(delta),
    // not O(graph size).
    const prevNeighborIds = selections.__prevNeighborIds || null;

    // Quiet titles (overview / large graphs) come back for the articles that match the search, as long as there are few enough to read.
    const matchLabels = (ids) => label.each(function(d) { this.classList.toggle('graph-label-match', !!ids && ids.has(d.id) && ids.size <= 40); });
    if (!q) {
        matchLabels(null);
        if (prevNeighborIds) {
            node.each(function(d) { if (!prevNeighborIds.has(d.id)) this.classList.remove(DIM_CLASS); });
            label.each(function(d) { if (!prevNeighborIds.has(d.id)) this.classList.remove(DIM_CLASS); });
            link.each(function(l) {
                const s = typeof l.source === 'object' ? l.source.id : l.source;
                const t = typeof l.target === 'object' ? l.target.id : l.target;
                if (!(prevNeighborIds.has(s) && prevNeighborIds.has(t))) this.classList.remove(DIM_CLASS);
            });
        }
        selections.__prevNeighborIds = null;
        return;
    }

    const matchedIds = new Set(
        node.data().filter(d => d.label.toLowerCase().includes(q)).map(d => d.id)
    );
    matchLabels(matchedIds);
    // Pull in direct neighbors so matches don't look disconnected from
    // their context — a match with its cluster dimmed is confusing.
    const neighborIds = new Set(matchedIds);
    link.data().forEach(l => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        if (matchedIds.has(s)) neighborIds.add(t);
        if (matchedIds.has(t)) neighborIds.add(s);
    });

    node.each(function(d) {
        const shouldDim = !neighborIds.has(d.id);
        const wasDim = prevNeighborIds ? !prevNeighborIds.has(d.id) : false;
        if (shouldDim !== wasDim) this.classList.toggle(DIM_CLASS, shouldDim);
    });
    label.each(function(d) {
        const shouldDim = !neighborIds.has(d.id);
        const wasDim = prevNeighborIds ? !prevNeighborIds.has(d.id) : false;
        if (shouldDim !== wasDim) this.classList.toggle(DIM_CLASS, shouldDim);
    });
    link.each(function(l) {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        const shouldDim = !(neighborIds.has(s) && neighborIds.has(t));
        const wasDim = prevNeighborIds ? !(prevNeighborIds.has(s) && prevNeighborIds.has(t)) : false;
        if (shouldDim !== wasDim) this.classList.toggle(DIM_CLASS, shouldDim);
    });

    selections.__prevNeighborIds = neighborIds;
}

/**
 * Stop the D3 force simulation and release every resource a graph render
 * attached to `container`: the simulation's animation loop, the
 * ResizeObserver, the window resize listener, and the pulse transition
 * timers. Safe to call on a container that was never rendered (all the
 * __archiveGraph* fields are absent). Call this when the graph tab is
 * hidden, the popup closes, or before re-rendering the same container.
 *
 * @param {HTMLElement} container
 */
export function destroyArchiveGraph(container) {
    if (!container) return;

    // Stop the force simulation so it stops consuming CPU on its tick loop
    // and releases its reference to the node/link object graph.
    if (container.__archiveGraphSimulation) {
        try { container.__archiveGraphSimulation.stop(); } catch (e) { /* best-effort */ }
        container.__archiveGraphSimulation = null;
    }

    if (container.__graphKeyDoc) { document.removeEventListener('keydown', container.__graphKeyDoc); container.__graphKeyDoc = null; }
    if (container.__graphFocusKey) { document.removeEventListener('keydown', container.__graphFocusKey); container.__graphFocusKey = null; }
    container.__graphClear = null;
    if (container.__graphReplayTimer) { clearInterval(container.__graphReplayTimer); container.__graphReplayTimer = null; }
    if (container.__graphSimStop) { container.__graphSimStop(); container.__graphSimStop = null; }
    container.classList.remove('graph-overview', 'graph-quiet');

    // Cancel any in-flight pulse transition on the highlighted node.
    if (container.__archiveGraphPulse) {
        try { container.__archiveGraphPulse.stop(); } catch (e) { /* best-effort */ }
        container.__archiveGraphPulse = null;
    }

    if (container.__archiveGraphResizeObserver) {
        try { container.__archiveGraphResizeObserver.disconnect(); } catch (e) { /* best-effort */ }
        container.__archiveGraphResizeObserver = null;
    }
    if (container.__archiveGraphWindowResizeHandler) {
        window.removeEventListener('resize', container.__archiveGraphWindowResizeHandler);
        container.__archiveGraphWindowResizeHandler = null;
    }
    if (container.__archiveGraphResizeDebounce) {
        clearTimeout(container.__archiveGraphResizeDebounce);
        container.__archiveGraphResizeDebounce = null;
    }
    if (container.__archiveGraphSelections) {
        container.__archiveGraphSelections = null;
    }
    if (container.__graphBrief) { container.__graphBrief.destroy(); container.__graphBrief = null; }
    if (container.__archiveGraphDimRaf) {
        cancelAnimationFrame(container.__archiveGraphDimRaf);
        container.__archiveGraphDimRaf = null;
    }
}

function renderGraph(container, allArticles, highlightTimestamp, minTagDegree, similarityIndex) {
    // "🎓 Research" filter: only papers (detected or marked by the user). Offered only when the archive has any.
    const paperCount = allArticles.reduce((n, a) => n + (paperState(a) ? 1 : 0), 0);
    if (!paperCount) container.__graphResearchOnly = false;
    const researchOnly = !!container.__graphResearchOnly;
    const articles = researchOnly ? allArticles.filter(a => paperState(a)) : allArticles;
    const simNow = container.__graphSim || null;           // latest result of the background similarity run (graphSimilarityCache.js)
    container.__graphSimUsed = simNow ? simNow.sig : null; // which result this picture was drawn from
    const raw = buildGraphData(articles, minTagDegree, similarityIndex, simNow && simNow.links);
    const { nodes, links, nodeById, capped } = capGraphData(raw);
    const { hiddenTagCount, stillOrphanCount } = raw;

    // Neglect info: how long each article has sat unopened (0 = opened
    // recently or no lastOpened recorded). Used to fade/shrink stale saves.
    const now = Date.now();
    const neglectDays = new Map(); // article id -> days since lastOpened
    nodes.forEach(n => {
        if (n.group !== 'article' || !n.data?.timestamp) return;
        const lastOpened = n.data.lastOpened || n.data.timestamp;
        neglectDays.set(n.id, Math.max(0, (now - new Date(lastOpened).getTime()) / 86400000));
    });
    const neglectedCount = Array.from(neglectDays.values()).filter(d => d >= NEGLECT_THRESHOLD_DAYS).length;

    // Structure, worked out here from the tags alone (graphStructure.js): clusters, bridge articles, source types.
    const struct = topicClusters(nodes, links, { otherLabel: T('Everything else') });
    const bridges = bridgeArticles(nodes, links, struct);
    const clusterIndex = new Map(struct.clusters.map((c, i) => [c.id, i]));
    const clusterColor = (id) => {
        const c = struct.clusters[clusterIndex.get(id)];
        return !c ? 'var(--accent)' : c.other ? 'var(--text-muted)' : TAG_PALETTE[clusterIndex.get(id) % TAG_PALETTE.length];
    };
    const clusterOfNode = (d) => (d.group === 'article' ? struct.clusterOfArticle.get(d.id) : struct.clusterOfTag.get(d.id));
    nodes.forEach(n => { n.cluster = clusterOfNode(n) || null; });
    const articleTotal = nodes.filter(n => n.group === 'article').length;
    const canOverview = struct.clusters.length >= 2;
    const overview = canOverview && (container.__graphLayout ? container.__graphLayout === 'overview' : articleTotal >= OVERVIEW_MIN_ARTICLES);
    const quietLabels = overview || articleTotal > 40;   // article titles on hover/focus only; all at once is the hairball
    const typeOf = new Map();
    nodes.forEach(n => { if (n.group === 'article') typeOf.set(n.id, sourceType(n.data)); });
    const typesPresent = new Set([...typeOf.values()].filter(t => t !== 'article'));

    // Colour by: Topic (the cluster), Age (when it was saved) or Mood (the AI's score for the article, where there is one).
    const savedAt = (a) => { const t = new Date(a && a.timestamp).getTime(); return Number.isFinite(t) ? t : 0; };
    const stampsSorted = nodes.filter(n => n.group === 'article').map(n => savedAt(n.data)).sort((x, y) => x - y);
    const ageQ = (d) => {   // 0 = oldest … 1 = newest, by rank (a few big import days must not wash out the scale)
        if (stampsSorted.length < 2) return 1;
        let lo = 0, hi = stampsSorted.length - 1; const t = savedAt(d.data);
        while (lo < hi) { const mid = (lo + hi) >> 1; if (stampsSorted[mid] < t) lo = mid + 1; else hi = mid; }
        return lo / (stampsSorted.length - 1);
    };
    const moodOf = (d) => (d.data && typeof d.data.moodScore === 'number' ? Math.max(-1, Math.min(1, d.data.moodScore)) : null);
    const moodScored = nodes.filter(n => n.group === 'article' && moodOf(n) !== null).length;
    const colorModes = ['topic', 'age', ...(moodScored ? ['mood'] : [])];
    let colorMode = colorModes.includes(container.__graphColorBy) ? container.__graphColorBy : 'topic';
    const moodColor = (m) => (m < 0 ? d3.interpolateRgb('#94a3b8', '#d9480f')(-m) : d3.interpolateRgb('#94a3b8', '#2563eb')(m));   // orange ← slate → blue (safe for red-green colour blindness)
    const ageColor = (q) => d3.interpolateViridis(0.08 + 0.84 * q);                                                                   // old: purple … new: yellow
    const colorFor = (d, mode) => (mode === 'age' ? ageColor(ageQ(d)) : mode === 'mood' ? (moodOf(d) === null ? 'var(--text-muted)' : moodColor(moodOf(d))) : clusterColor(d.cluster));
    let notesOf = new Map();   // article id → your highlights and notes (read from storage after the first paint)
    const fillStrength = (d) => (d.group !== 'article' ? 1
        : colorMode === 'mood' && moodOf(d) === null ? 0.3
        : MATURITY_FILL[maturityOf(d.data, (notesOf.get(d.data && d.data.id) || 0))]);

    if (typeof d3 === 'undefined') {
        container.innerHTML = `<div class="graph-empty">${T('D3 library failed to load.')}</div>`;
        return;
    }

    // A previous render (e.g. from the filter toggle) may still have a
    // ResizeObserver/window listener watching this container — stop them
    // before replacing the DOM, or we'd end up with duplicate handlers
    // stacking up.
    destroyArchiveGraph(container);

    const width = container.clientWidth || 400;
    const height = container.clientHeight || 400;

    // Clear and set up SVG
    container.innerHTML = '';
    container.classList.toggle('graph-overview', overview);
    container.classList.toggle('graph-quiet', quietLabels);
    const svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .style('background', 'transparent')
        .style('cursor', 'grab');

    const defs = svg.append('defs');

    // 1. Create the Main Container Group
    // This group will hold all nodes/links and receive the zoom transform
    const mainContainer = svg.append('g').attr('class', 'graph-content');

    // 2. Define Zoom/Pan Behavior
    const zoom = d3.zoom()
        .scaleExtent([0.3, 5]) // Min/Max zoom levels
        .on('zoom', (event) => {
            mainContainer.attr('transform', event.transform);
            // Quiet titles keep their on-screen size while you zoom in, so a focused cluster reads instead of piling up.
            if (quietLabels) mainContainer.selectAll('text.graph-node-label.is-article').attr('font-size', `${10 / Math.max(1, event.transform.k)}px`);
            mainContainer.selectAll('text.graph-cluster-label').attr('font-size', c => `${clusterFont(c) / Math.max(1, event.transform.k) ** 0.7}px`);
        });

    svg.call(zoom);

    // ── Auto-resize ──────────────────────────────────────────────────────
    // The popup/side panel can be resized by the user independent of any
    // window 'resize' event, so we watch the container itself via
    // ResizeObserver. We deliberately re-measure container.clientWidth/
    // Height live inside the handler rather than trusting the observer's
    // own contentRect — with backdrop-filter on #graphContainer, relying
    // on the entry's reported rect occasionally lagged one paint behind
    // the real layout, which looked like "resize does nothing until you
    // close and reopen". A `window.resize` listener is added as a backup
    // in case the container-level observer ever misses a resize (e.g. the
    // extension popped out into its own resizable window). Both paths are
    // debounced and funnel into the same live-measurement function.
    let resizeDebounce = null;
    let viewW = width, viewH = height;
    const measureAndResize = () => {
        const newWidth = container.clientWidth;
        const newHeight = container.clientHeight;
        if (newWidth <= 0 || newHeight <= 0) return;

        viewW = newWidth; viewH = newHeight;
        svg.attr('width', newWidth).attr('height', newHeight);
        if (overview) {   // the cluster centres follow the size; the pull toward them reads viewW/viewH live
            simulation.force('x', d3.forceX(d => clusterCenter(d).x).strength(0.16));
            simulation.force('y', d3.forceY(d => clusterCenter(d).y).strength(0.16));
        } else simulation.force('center', d3.forceCenter(newWidth / 2, newHeight / 2));
        simulation.alpha(0.3).restart();
    };
    const scheduleResize = () => {
        clearTimeout(resizeDebounce);
        resizeDebounce = setTimeout(measureAndResize, 150);
        container.__archiveGraphResizeDebounce = resizeDebounce;
    };

    const resizeObserver = new ResizeObserver(scheduleResize);
    resizeObserver.observe(container);
    window.addEventListener('resize', scheduleResize);

    container.__archiveGraphResizeObserver = resizeObserver;
    container.__archiveGraphWindowResizeHandler = scheduleResize;

    // Arrow marker for links
    defs.append('marker')
        .attr('id', 'arrow')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 20)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', 'var(--outline)');

    // ── Size tags by how many articles use them (tag-cloud style) ────────
    // Tags act as hub nodes; scaling them up communicates structure at a
    // glance. sqrt scale (not linear) because the eye perceives circle
    // *area*, not radius — a tag with 2x the connections shouldn't look
    // 4x heavier.
    const tagDegrees = nodes.filter(n => n.group === 'tag').map(n => n.degree || 1);
    const maxTagDegree = tagDegrees.length ? Math.max(...tagDegrees) : 1;
    const tagRadiusScale = d3.scaleSqrt().domain([1, maxTagDegree]).range([6, 16]).clamp(true);
    const tagFontScale = d3.scaleSqrt().domain([1, maxTagDegree]).range([11, 17]).clamp(true);

    function nodeRadius(d) {
        if (d.group === 'article') {
            const isHi = highlightTimestamp && d.data?.timestamp === highlightTimestamp;
            const base = isHi ? (overview ? 8 : 12) : (overview ? 4 : 8) + (bridges.has(d.id) ? (overview ? 1.5 : 2) : 0);
            // Neglected articles shrink slightly on top of fading, so the
            // stale ones read as smaller/quieter at a glance.
            return (neglectDays.get(d.id) || 0) >= NEGLECT_THRESHOLD_DAYS ? base * NEGLECT_SHRINK : base;
        }
        return tagRadiusScale(d.degree || 1);
    }

    // Overview: every cluster gets a home. Biggest in the middle, the rest spread around it (phyllotaxis, so any count looks even).
    const clusterCenter = (d) => {
        const i = clusterIndex.get(d.cluster);
        const n = struct.clusters.length;
        if (i === undefined || n < 2) return { x: viewW / 2, y: viewH / 2 };
        const R = 0.42 * Math.min(viewW, viewH);
        const r = i === 0 ? 0 : R * Math.sqrt(i / Math.max(1, n - 1)) * 1.05;
        const a = i * 2.399963 + 0.6;   // golden angle
        return { x: viewW / 2 + Math.cos(a) * r * (viewW / Math.min(viewW, viewH)) * 0.9, y: viewH / 2 + Math.sin(a) * r };
    };

    // Create force simulation
    const linkForce = d3.forceLink(links).id(d => d.id).distance(overview ? 30 : 100);
    if (overview) linkForce.strength(0.04);   // detail keeps d3's default strength, as before
    const simulation = d3.forceSimulation(nodes)
        .force('link', linkForce)
        .force('charge', d3.forceManyBody().strength(overview ? -14 : -250))
        .force('collision', d3.forceCollide().radius(d => nodeRadius(d) + (overview ? 1.5 : 6)));
    if (overview) {
        simulation.force('x', d3.forceX(d => clusterCenter(d).x).strength(0.16))
            .force('y', d3.forceY(d => clusterCenter(d).y).strength(0.16));
    } else {
        simulation.force('center', d3.forceCenter(width / 2, height / 2));
    }

    // Keep a handle on the container so destroyArchiveGraph() (and the
    // next initArchiveGraph call) can stop this simulation and release its
    // node/link object graph instead of letting it tick forever.
    container.__archiveGraphSimulation = simulation;

    // Draw links into mainContainer — color lookup via Map (O(1)) instead of
    // the old nodes.find() (O(n) per link).
    // Overview only: one soft blob per cluster behind everything, sized from where its members ended up (updated on tick).
    const clusterMembers = new Map(struct.clusters.map(c => [c.id, nodes.filter(n => n.cluster === c.id && n.group === 'article')]));
    const blobs = overview
        ? mainContainer.append('g').attr('class', 'graph-blobs').selectAll('circle').data(struct.clusters.filter(c => clusterMembers.get(c.id).length)).join('circle')
            .attr('class', 'graph-blob').attr('fill', c => clusterColor(c.id)).attr('fill-opacity', 0.1).style('cursor', 'pointer')
        : null;

    const link = mainContainer.append('g')
        .selectAll('line')
        .data(links)
        .join('line')
        .attr('class', d => d.kind === 'similarity' ? 'graph-link graph-link-similarity' : 'graph-link')
        .attr('stroke', d => {
            if (d.kind === 'similarity') return 'var(--text-muted)';
            const targetId = typeof d.target === 'object' ? d.target.id : d.target;
            const tagNode = nodeById.get(targetId);
            return tagNode?.group === 'tag' ? tagColor(tagNode.label) : 'var(--outline)';
        })
        .attr('stroke-width', d => d.kind === 'similarity' ? 1 : 1.5)
        .attr('stroke-dasharray', d => d.kind === 'similarity' ? '3,3' : null)
        .attr('stroke-opacity', d => d.kind === 'similarity' ? 0.3 : 0.35)
        .attr('marker-end', d => d.kind === 'similarity' ? null : 'url(#arrow)');

    // Draw nodes into mainContainer
    const node = mainContainer.append('g')
        .selectAll('circle')
        .data(nodes)
        .join('circle')
        .attr('class', d => 'graph-node ' + (d.group === 'tag' ? 'is-tag' : 'is-article'))
        .attr('r', nodeRadius)
        .attr('fill', d => {
            // Articles take their cluster's colour (the topic they sit in); tags keep their own.
            if (d.group === 'article') return colorFor(d, colorMode);
            return tagColor(d.label);
        })
        // How far you got with an article: saved (faint) → worked on (solid). Separate from `opacity`, which carries the neglect fade.
        .attr('fill-opacity', fillStrength)
        .attr('stroke', d => {
            if (highlightTimestamp && d.group === 'article' && d.data?.timestamp === highlightTimestamp) {
                return '#fbbf24'; // amber highlight ring
            }
            // Neglected articles shift their ring toward the danger end of
            // the palette — a quiet "this one's gone stale" cue.
            if (!overview && d.group === 'article' && (neglectDays.get(d.id) || 0) >= NEGLECT_THRESHOLD_DAYS) {
                return 'var(--danger)';
            }
            // Source type reads from the ring: solid dark = paper, dashed = video, dotted = PDF (no ring for plain articles).
            if (d.group === 'article' && typeOf.get(d.id) !== 'article') return 'var(--text-primary, #111)';
            return 'var(--bg-primary, #fff)';
        })
        .attr('stroke-dasharray', d => (d.group === 'article' ? RING_DASH[typeOf.get(d.id)] || null : null))
        .attr('stroke-width', d => {
            if (highlightTimestamp && d.group === 'article' && d.data?.timestamp === highlightTimestamp) return 3;
            if (d.group === 'article' && typeOf.get(d.id) !== 'article') return overview ? 1.6 : 2.2;
            return overview && d.group === 'article' ? 0.8 : 1.5;
        })
        .attr('opacity', d => {
            // Set as the SVG attr, not a style — applyGraphSearchDim() dims
            // via the DIM_CLASS CSS class instead, so a node's own baseline
            // opacity here (e.g. the neglect fade) stays intact underneath
            // and comes back untouched once the class is removed.
            if (d.group !== 'article') return 1;
            return (neglectDays.get(d.id) || 0) >= NEGLECT_THRESHOLD_DAYS ? NEGLECT_FADE : 1;
        })
        .style('cursor', 'pointer')
        .call(drag(simulation));
    // Native tooltip = the title on hover, plus what kind of source it is and which topics it bridges.
    node.append('title').text(d => {
        if (d.group !== 'article') return d.label;
        const kind = typeOf.get(d.id);
        const reach = (bridges.get(d.id) || []).map(id => struct.clusters[clusterIndex.get(id)].label);
        return [d.label, kind !== 'article' ? sourceName(kind) : '', reach.length ? T('Connects: {topics}', { topics: reach.join(' · ') }) : ''].filter(Boolean).join(' — ');
    });

    // Pulse animation for highlighted node
    if (highlightTimestamp) {
        node.filter(d => d.group === 'article' && d.data?.timestamp === highlightTimestamp)
            .each(function() {
                const el = d3.select(this);
                (function pulse() {
                    const t = el.transition().duration(700).attr('r', 15).attr('stroke-opacity', 0.4)
                      .transition().duration(700).attr('r', 12).attr('stroke-opacity', 1)
                      .on('end', pulse);
                    // Keep a handle so destroyArchiveGraph() can stop the
                    // loop; otherwise the pulse keeps scheduling transitions
                    // forever even after the graph is hidden/closed.
                    container.__archiveGraphPulse = t;
                })();
            });
    }

    // Labels into mainContainer
    const label = mainContainer.append('g')
        .selectAll('text')
        .data(nodes)
        .join('text')
        .attr('class', d => 'graph-node-label ' + (d.group === 'tag' ? 'is-tag' : 'is-article graph-label-quietable'))
        .text(d => d.label.length > 20 ? d.label.slice(0, 20) + '…' : d.label)
        .attr('font-size', d => d.group === 'tag' ? `${tagFontScale(d.degree || 1)}px` : '10px')
        .attr('font-weight', d => d.group === 'tag' ? '700' : 'normal')
        .attr('fill', d => d.group === 'tag' ? tagColor(d.label) : 'var(--text-muted)')
        .attr('text-anchor', 'middle')
        .attr('dy', d => -(nodeRadius(d) + 4))
        .style('pointer-events', 'none')
        .style('text-shadow', '0 1px 2px var(--bg-primary)');

    // Unread = not marked read (`readAt`: set when opened or marked Read, removed by "Unread"; the Inbox tab and the 🆕 badge use the same).
    const unreadIds = new Set(nodes.filter(n => n.group === 'article' && !(n.data && n.data.readAt)).map(n => n.id));
    const unreadIn = new Map(struct.clusters.map(c => [c.id, (clusterMembers.get(c.id) || []).filter(m => unreadIds.has(m.id)).length]));
    const clusterName = (c) => (c.label.length > 22 ? c.label.slice(0, 22) + '…' : c.label);
    const clusterFont = (c) => Math.round(12 + 6 * Math.sqrt(c.size / Math.max(1, articleTotal)));
    // Overview: one label per cluster, named after its most used tag, drawn above the dots. Click = focus that cluster.
    const clusterLabels = overview
        ? mainContainer.append('g').attr('class', 'graph-cluster-labels').selectAll('text')
            .data(struct.clusters.filter(c => clusterMembers.get(c.id).length)).join('text')
            .attr('class', 'graph-cluster-label')
            .attr('text-anchor', 'middle').attr('fill', c => clusterColor(c.id))
            .attr('font-size', c => `${clusterFont(c)}px`)
            .text(c => clusterName(c))
            .style('cursor', 'pointer')
            .attr('role', 'button').attr('tabindex', 0)
            .attr('aria-label', c => T('{topic}: {n} articles, {u} unread', { topic: c.label, n: c.size, u: unreadIn.get(c.id) || 0 }))
        : null;

    // Kept on the container so applyGraphSearchDim() can restyle the
    // already-rendered graph (no rebuild, no simulation restart) when the
    // 'all' scope wants to dim non-matches against the archive search box
    // instead of removing them.
    container.__archiveGraphSelections = { node, link, label };

    // Tick function
    simulation.on('tick', () => {
        if (overview) {
            const blobFor = new Map();
            clusterMembers.forEach((ms, id) => {
                let cx = 0, cy = 0; ms.forEach(m => { cx += m.x || 0; cy += m.y || 0; }); cx /= ms.length; cy /= ms.length;
                let sq = 0; ms.forEach(m => { sq += ((m.x || 0) - cx) ** 2 + ((m.y || 0) - cy) ** 2; });
                blobFor.set(id, { cx, cy, r: Math.sqrt(sq / ms.length) * 1.3 + 12 });
            });
            blobs.attr('cx', c => blobFor.get(c.id).cx).attr('cy', c => blobFor.get(c.id).cy).attr('r', c => blobFor.get(c.id).r);
            clusterLabels.attr('x', c => blobFor.get(c.id).cx).attr('y', c => blobFor.get(c.id).cy + 4);
        }
        link
            .attr('x1', d => d.source.x)
            .attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x)
            .attr('y2', d => d.target.y);

        node
            .attr('cx', d => d.x)
            .attr('cy', d => d.y);

        label
            .attr('x', d => d.x)
            .attr('y', d => d.y);
    });

    // ── Focus and path ───────────────────────────────────────────────────
    // Focus: one cluster, or an article with what hangs on it, stays bright; the rest steps back and its titles stay quiet.
    // Path: pick two items and see how they connect (through shared tags or similar content). Esc or a tap on the background resets.
    const linkId = (x) => (typeof x === 'object' ? x.id : x);
    const nodeOf = new Map(nodes.map(n => [n.id, n]));
    let focusSet = null, labelSet = new Set(), pathFrom = null;
    const announce = (text) => { const live = container.querySelector('.graph-live'); if (live) live.textContent = text; };
    function setFocus(ids, bar, extraLabels) {
        focusSet = ids && ids.size ? ids : null;
        const dim = (d) => !!focusSet && !focusSet.has(d.id);
        node.classed(FOCUS_CLASS, dim); label.classed(FOCUS_CLASS, dim);
        link.classed(FOCUS_CLASS, l => !!focusSet && !(focusSet.has(linkId(l.source)) && focusSet.has(linkId(l.target))));
        labelSet = new Set(extraLabels || []);
        if (focusSet) nodes.filter(n => n.group === 'article' && focusSet.has(n.id)).sort((a, b) => stamp(b.data) - stamp(a.data)).slice(0, FOCUS_LABELS).forEach(n => labelSet.add(n.id));
        label.classed('graph-label-on', d => labelSet.has(d.id));
        container.querySelectorAll(':scope > .graph-focusbar').forEach(b => b.remove());
        if (focusSet && bar) container.appendChild(buildFocusBar({ ...bar, onClear: clearAll }));
    }
    // Bring a group of nodes into view (focus on a cluster); the next reset returns to where you were.
    const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let zoomedByFocus = false, savedView = null;
    function zoomToNodes(list) {
        const pts = list.filter(n => Number.isFinite(n.x) && Number.isFinite(n.y));
        if (!pts.length) return;
        const xs = pts.map(n => n.x), ys = pts.map(n => n.y);
        const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        const k = Math.max(0.6, Math.min(3, 0.8 * Math.min(viewW / Math.max(60, x1 - x0), viewH / Math.max(60, y1 - y0))));
        if (!zoomedByFocus) savedView = d3.zoomTransform(svg.node());
        zoomedByFocus = true;
        const t = d3.zoomIdentity.translate(viewW / 2 - k * (x0 + x1) / 2, viewH / 2 - k * (y0 + y1) / 2).scale(k);
        (calm() ? svg : svg.transition().duration(450)).call(zoom.transform, t);
    }
    function clearAll() {
        pathFrom = null;
        node.classed(PATH_CLASS, false); link.classed(PATH_CLASS, false);
        setFocus(null);
        if (zoomedByFocus) { zoomedByFocus = false; (calm() ? svg : svg.transition().duration(350)).call(zoom.transform, savedView || d3.zoomIdentity); }
    }
    container.__graphClear = clearAll;
    function pathPick(d) {
        if (!pathFrom || pathFrom === d.id) {
            pathFrom = d.id; node.classed(PATH_CLASS, false); link.classed(PATH_CLASS, false);
            setFocus(new Set([d.id]), { caption: T('Path from “{a}”: pick a second item', { a: d.label }) });
            announce(T('Path mode: first item {a} chosen. Pick a second one.', { a: d.label }));
            return;
        }
        const path = shortestPath(nodes, links, pathFrom, d.id);
        pathFrom = null;
        if (!path) {
            node.classed(PATH_CLASS, false); link.classed(PATH_CLASS, false);
            setFocus(new Set([d.id]), { caption: T('Not connected: no shared tag or similar content links these two') });
            announce(T('These two are not connected.'));
            return;
        }
        const inPath = new Set(path);
        const edges = new Set(); path.forEach((id, i) => { if (i) { edges.add(path[i - 1] + '|' + id); edges.add(id + '|' + path[i - 1]); } });
        node.classed(PATH_CLASS, n => inPath.has(n.id));
        link.classed(PATH_CLASS, l => edges.has(linkId(l.source) + '|' + linkId(l.target)));
        const chain = path.map(id => { const t = nodeOf.get(id).label; return t.length > 28 ? t.slice(0, 28) + '…' : t; }).join(' → ');
        setFocus(inPath, { caption: TN(path.length - 1, '{n} step: {chain}', '{n} steps: {chain}', { chain }) }, path);
        announce(T('Connected in {n} steps: {chain}', { n: path.length - 1, chain }));
    }
    container.__graphPathMode = (on) => { container.__graphPathOn = !!on; clearAll(); announce(on ? T('Path mode on: pick two items to see how they connect.') : T('Path mode off.')); };
    const focusCluster = (c) => {
        const ids = new Set([...c.articleIds, ...c.tagIds]);
        const members = [...c.articleIds].map(id => nodeOf.get(id) && nodeOf.get(id).data).filter(Boolean);
        setFocus(ids, {
            caption: c.label + ' · ' + TN(c.size, '{n} article', '{n} articles'),
            openLabel: T('Open topic'),
            onOpen: () => import('./graphClusters.js').then(m => m.showClusterCard(container, { label: c.label, articles: members }))
        });
        zoomToNodes(nodes.filter(n => n.cluster === c.id && n.group === 'article'));
        announce(c.label + ': ' + TN(c.size, '{n} article', '{n} articles'));
    };
    if (overview) {
        const pick = (event, c) => { event.stopPropagation(); if (!container.__graphPathOn) focusCluster(c); };
        blobs.on('click', pick);
        clusterLabels.on('click', pick).on('keydown', (event, c) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(event, c); } });
    }
    node.on('mouseenter.label', (e, d) => label.filter(l => l === d).classed('graph-label-on', true))
        .on('mouseleave.label', (e, d) => label.filter(l => l === d).classed('graph-label-on', labelSet.has(d.id)));
    svg.on('click.clear', () => { if (focusSet) clearAll(); });
    container.__graphFocusKey = (e) => { if (e.key === 'Escape' && focusSet && !container.querySelector('.graph-cluster-page')) clearAll(); };
    document.addEventListener('keydown', container.__graphFocusKey);

    // Click handler for article nodes — show a preview card. Tag nodes
    // dispatch a `filter-by-tag` event so the archive list can filter to
    // that tag, turning the graph into a navigation surface.
    // Topic selection for bar-briefings (graphBrief.js): long-press, or ⇧ / Ctrl / ⌘ + tap, adds a topic; once something is selected a plain tap toggles too.
    let lpTimer = null, lpFired = false, lpStart = null;
    const lpCancel = () => { clearTimeout(lpTimer); lpTimer = null; };
    node.on('pointerdown.lp', (event, d) => {
        if (d.group !== 'tag' || !container.__graphBrief) return;
        lpFired = false; lpStart = [event.clientX, event.clientY]; lpCancel();
        lpTimer = setTimeout(() => { lpFired = true; if (container.__graphBrief) container.__graphBrief.toggle(d.id); }, 500);
    });
    node.on('pointermove.lp', (event) => { if (lpTimer && lpStart && Math.hypot(event.clientX - lpStart[0], event.clientY - lpStart[1]) > 8) lpCancel(); });
    node.on('pointerup.lp pointerleave.lp pointercancel.lp', lpCancel);
    node.on('click', (event, d) => {
        if (container.__graphPathOn) { event.stopPropagation(); pathPick(d); return; }
        if (d.group === 'article' && d.data) {
            event.stopPropagation();
            showPreviewCard(container, d.data);
            // Focus on this article and what hangs on it (its topics and the articles that share them).
            const near = neighborhood(nodes, links, d.id, 2);
            setFocus(near, { caption: T('Around this article') + ' · ' + TN(near.size - 1, '{n} connected item', '{n} connected items') });
        } else if (d.group === 'tag') {
            event.stopPropagation();
            if (lpFired) { lpFired = false; return; }
            const gb = container.__graphBrief;
            if (gb && (event.shiftKey || event.ctrlKey || event.metaKey || gb.size > 0)) { gb.toggle(d.id); return; }
            // A plain tap opens the topic's page (briefing / question / export / "Show list" = the old one-tap filter).
            const members = articlesOfTag(nodes, links, d.id);
            import('./graphClusters.js').then(m => m.showClusterCard(container, { label: d.label, articles: members }));
        }
    });

    // Drag behavior for individual nodes
    function drag(simulation) {
        function dragstarted(event, d) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
            svg.style('cursor', 'grabbing');
        }

        function dragged(event, d) {
            d.fx = event.x;
            d.fy = event.y;
        }

        function dragended(event, d) {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
            svg.style('cursor', 'grab');
        }

        return d3.drag()
            .on('start', dragstarted)
            .on('drag', dragged)
            .on('end', dragended);
    }

    // Optional: Center the graph initially
    const initialTransform = d3.zoomIdentity.translate(0, 0).scale(1);
    svg.call(zoom.transform, initialTransform);

    // ── Controls ─────────────────────────────────────────────────────────
    // Always shown, not just when there's a status message to display — the
    // well-connected/all-tags toggle is primary navigation, not optional
    // status text. (The filtered/highlight scope switch lives in the
    // archive search box itself now, not here — see articleManager.js.)
    renderGraphList(container, nodes, links, findGaps(articles));
    if (paperCount) renderResearchChip(container, paperCount, researchOnly, () => {
        container.__graphResearchOnly = !researchOnly;
        simulation.stop();
        renderGraph(container, allArticles, highlightTimestamp, minTagDegree, similarityIndex);
        const again = container.querySelector('.graph-research-chip'); if (again) again.focus();
    });
    renderTimeRange(container, nodes, links, articles);
    // "Unread": everything you have read steps back; in Topics each cluster label shows how many are still unread.
    function applyUnread(on, say) {
        node.classed('graph-read-dim', d => on && d.group === 'article' && !unreadIds.has(d.id));
        label.classed('graph-read-dim', d => on && d.group === 'article' && !unreadIds.has(d.id));
        if (blobs) blobs.classed('graph-read-dim', c => on && !(unreadIn.get(c.id) > 0));
        if (clusterLabels) clusterLabels.text(c => (on ? clusterName(c) + ' · ' + (unreadIn.get(c.id) || 0) : clusterName(c)));
        if (say) announce(on ? TN(unreadIds.size, '{n} unread article stands out', '{n} unread articles stand out') : T('Showing all articles'));
    }
    // Colour by: recolour the dots in place, no redraw.
    function applyColor(mode, say) {
        colorMode = mode; container.__graphColorBy = mode;
        node.filter(d => d.group === 'article').attr('fill', d => colorFor(d, mode)).attr('fill-opacity', fillStrength);
        renderColorLegend(container, mode, { ageColor, moodColor });
        if (say) announce(mode === 'age' ? T('Dots coloured by age: purple is old, yellow is recent') : mode === 'mood' ? T('Dots coloured by mood: orange is negative, blue is positive, grey is not scored') : T('Dots coloured by topic'));
    }
    applyColor(colorMode, false);
    applyUnread(!!container.__graphUnreadOnly, false);
    renderStructureChips(container, {
        canOverview, overview,
        color: { mode: colorMode, modes: colorModes, onChange: (m) => applyColor(m, true) },
        unread: unreadIds.size ? { count: unreadIds.size, on: !!container.__graphUnreadOnly, onToggle: (on) => { container.__graphUnreadOnly = on; applyUnread(on, true); } } : null,
        onLayout: (mode) => {
            container.__graphLayout = mode;
            simulation.stop();
            renderGraph(container, allArticles, highlightTimestamp, minTagDegree, similarityIndex);
            const again = container.querySelector('.graph-layout-toggle button.active'); if (again) again.focus();
        }
    });
    // Maturity also counts your own highlights and notes; they live in storage, so the fill is refined once they are read.
    import('./notesView.js').then((m) => m.noteCountsByArticle()).then((counts) => {
        if (container.__archiveGraphSelections?.node !== node || !counts || !counts.size) return;
        counts.forEach((c, id) => notesOf.set(id, (c.mine || 0) + (c.notes || 0)));
        node.attr('fill-opacity', fillStrength);
    }).catch(() => { /* the fill stays at what the record alone tells */ });
    import('./graphBrief.js').then((m) => {
        if (container.__archiveGraphSelections?.node !== node) return;   // re-rendered meanwhile
        if (container.__graphBrief) container.__graphBrief.destroy();
        const topics = nodes.filter(n => n.group === 'tag').map(n => ({ id: n.id, label: n.label }));
        const gb = m.createGraphBrief(container, {
            topics, membersOf: (id) => articlesOfTag(nodes, links, id), monthIndex,
            onSelection: (set) => node.classed('graph-sel', (d) => set.has(d.id))
        });
        container.__graphBrief = gb;
        if (container.__graphBriefRange) container.removeEventListener('graph-time-range', container.__graphBriefRange);
        container.__graphBriefRange = (e) => gb.setRange(e.detail);
        container.addEventListener('graph-time-range', container.__graphBriefRange);
    });
    renderGraphControls(container, {
        hiddenTagCount,
        capped,
        currentlyFiltered: minTagDegree > 1,
        stillOrphanCount,
        neglectedCount,
        typesPresent,
        onToggleDegree: () => {
            const nextMinDegree = minTagDegree > 1 ? 1 : MIN_TAG_DEGREE_DEFAULT;
            simulation.stop();
            renderGraph(container, allArticles, highlightTimestamp, nextMinDegree, similarityIndex);
        },
    });
    renderColorLegend(container, colorMode, { ageColor, moodColor });   // the legend only exists now
    followSimilarity(container, () => { simulation.stop(); renderGraph(container, allArticles, highlightTimestamp, minTagDegree, similarityIndex); });
}

/** Joins the background similarity run: swaps in a new result while the picture is untouched, otherwise offers it in a chip. */
function followSimilarity(container, rerender) {
    if (container.__graphSimStop) { container.__graphSimStop(); container.__graphSimStop = null; }
    import('./graphSimilarityCache.js').then((m) => {
        if (!container.isConnected) return;
        container.__graphSimStop = m.watchSimilarity((u) => {
            if (!container.isConnected) return;
            container.__graphSim = { links: u.links, sig: u.sig };
            const fresh = u.sig !== container.__graphSimUsed;
            if (fresh && !container.__graphTouched && container.dataset.graphMode !== 'list') { rerender(); return; }
            showSimilarityChip(container, { fresh, running: !u.complete, done: u.done, total: u.total }, rerender);
        });
    }).catch(() => { /* no similarity run: the graph stays on tags */ });
}

function showSimilarityChip(container, { fresh, running, done, total }, rerender) {
    const bar = filterBar(container);
    let chip = bar.querySelector('.graph-sim-chip');
    if (!fresh && !running) { if (chip) chip.remove(); return; }
    if (!chip) { chip = document.createElement('button'); chip.type = 'button'; chip.className = 'graph-sim-chip'; bar.append(chip); }
    chip.disabled = !fresh;
    chip.textContent = fresh ? T('Better connections ready') : T('Matching articles…') + (total ? ' ' + Math.round(100 * done / total) + '%' : '');
    chip.title = fresh ? T('Redraw the graph with the new matches') : T('Reading your saved articles in the background');
    chip.onclick = fresh ? () => { chip.remove(); rerender(); } : null;
}


/** The bar that says what is in focus: caption, optional "Open topic", and a reset. */
function buildFocusBar({ caption, openLabel, onOpen, onClear }) {
    const bar = document.createElement('div');
    bar.className = 'graph-focusbar'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', T('Focus'));
    const text = document.createElement('span'); text.className = 'graph-focusbar-text'; text.textContent = caption; text.title = caption;
    bar.append(text);
    if (onOpen) {
        const open = document.createElement('button'); open.type = 'button'; open.className = 'graph-focusbar-open'; open.textContent = openLabel;
        open.addEventListener('click', (e) => { e.stopPropagation(); onOpen(); });
        bar.append(open);
    }
    const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'graph-focusbar-clear';
    clear.textContent = '✕'; clear.title = T('Show everything again'); clear.setAttribute('aria-label', T('Show everything again'));
    clear.addEventListener('click', (e) => { e.stopPropagation(); onClear(); });
    bar.append(clear);
    return bar;
}

/** The graph as an SVG file with its colours resolved (the stylesheet's variables do not exist outside the extension). */
export function graphSvgMarkup(container) {
    const svg = container.querySelector('svg');
    if (!svg) return '';
    const cs = getComputedStyle(container);
    const resolve = (v) => String(v).replace(/var\((--[\w-]+)(?:,\s*([^)]+))?\)/g, (_, name, fb) => cs.getPropertyValue(name).trim() || (fb || '#888').trim());
    const copy = svg.cloneNode(true);
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.querySelectorAll('*').forEach(n => ['fill', 'stroke', 'style'].forEach(a => { const v = n.getAttribute(a); if (v && v.includes('var(')) n.setAttribute(a, resolve(v)); }));
    copy.querySelectorAll('.is-tag').forEach(n => { if (container.classList.contains('graph-overview')) n.remove(); });
    copy.querySelectorAll('.graph-link').forEach(n => { if (container.classList.contains('graph-overview')) n.remove(); });
    copy.querySelectorAll('title').forEach(n => n.remove());
    const bg = cs.getPropertyValue('--bg-page').trim() || '#ffffff';
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', '100%'); rect.setAttribute('height', '100%'); rect.setAttribute('fill', bg);
    copy.insertBefore(rect, copy.firstChild);
    // Titles on quiet nodes stay out of the file; the picture is for sharing, not for hovering.
    copy.querySelectorAll('text').forEach(n => n.setAttribute('font-family', 'sans-serif'));
    if (container.classList.contains('graph-quiet')) copy.querySelectorAll('text.is-article').forEach(n => n.remove());
    return new XMLSerializer().serializeToString(copy);
}

/** Saves the current picture as a local .svg file (nothing is uploaded). */
function exportGraphSvg(container) {
    const markup = graphSvgMarkup(container);
    if (!markup) return;
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
    const a = document.createElement('a'); a.href = url; a.download = 'archive-graph.svg';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Topics | Detail switch, "Path" chip and "Save image" in the same row as the other chips. */
const COLOR_LABEL = { topic: () => T('Topic'), age: () => T('Age'), mood: () => T('Mood') };

/** A colour bar in the legend for Age and Mood (Topic needs none: the labels say it). */
function renderColorLegend(container, mode, { ageColor, moodColor }) {
    const legend = container.querySelector('.graph-legend');
    if (!legend) return;
    legend.querySelectorAll('.graph-legend-color').forEach(n => n.remove());
    if (mode === 'topic') return;
    const stops = (fn, n) => Array.from({ length: n }, (_, i) => fn(i / (n - 1))).join(', ');
    const item = document.createElement('span');
    item.className = 'graph-legend-item graph-legend-color';
    const bar = document.createElement('span'); bar.className = 'graph-legend-grad';
    bar.style.background = 'linear-gradient(90deg, ' + (mode === 'age' ? stops(ageColor, 6) : stops((q) => moodColor(q * 2 - 1), 7)) + ')';
    const a = document.createElement('span'); a.textContent = mode === 'age' ? T('older') : T('negative');
    const b = document.createElement('span'); b.textContent = mode === 'age' ? T('newer') : T('positive');
    item.append(a, bar, b);
    if (mode === 'mood') { const none = document.createElement('span'); none.textContent = '· ' + T('grey: not scored'); item.append(none); }
    legend.append(item);
}

function renderStructureChips(container, { canOverview, overview, onLayout, unread, color }) {
    const bar = filterBar(container);
    bar.querySelectorAll('.graph-layout-toggle, .graph-path-chip, .graph-save-chip, .graph-unread-chip, .graph-color-chip').forEach(n => n.remove());
    if (color && color.modes.length > 1) {
        const chip = document.createElement('button');
        chip.type = 'button'; chip.className = 'graph-color-chip';
        let mode = color.mode;
        const paint = () => { chip.textContent = T('Color: {mode}', { mode: COLOR_LABEL[mode]() }); };
        chip.title = T('Change what the dot colours mean');
        paint();
        chip.addEventListener('click', () => { mode = color.modes[(color.modes.indexOf(mode) + 1) % color.modes.length]; paint(); color.onChange(mode); });
        bar.append(chip);
    }
    if (canOverview) {
        const g = document.createElement('div');
        g.className = 'segmented-control segmented-control-buttons graph-layout-toggle'; g.setAttribute('role', 'group'); g.setAttribute('aria-label', T('Graph layout'));
        [['overview', T('Topics')], ['detail', T('Detail')]].forEach(([mode, text]) => {
            const b = document.createElement('button'); b.type = 'button'; b.textContent = text;
            const on = (mode === 'overview') === overview;
            b.className = on ? 'active' : ''; b.setAttribute('aria-pressed', String(on));
            b.addEventListener('click', () => { if (!on) onLayout(mode); });
            g.append(b);
        });
        bar.prepend(g);
    }
    const path = document.createElement('button');
    path.type = 'button'; path.className = 'graph-path-chip' + (container.__graphPathOn ? ' on' : '');
    path.setAttribute('aria-pressed', String(!!container.__graphPathOn));
    path.textContent = T('Path'); path.title = T('Pick two items to see how they connect');
    path.addEventListener('click', () => {
        const on = !container.__graphPathOn;
        path.classList.toggle('on', on); path.setAttribute('aria-pressed', String(on));
        if (container.__graphPathMode) container.__graphPathMode(on);
    });
    const save = document.createElement('button');
    save.type = 'button'; save.className = 'graph-save-chip'; save.textContent = T('Save image');
    save.title = T('Save this picture as an SVG file on your device');
    save.addEventListener('click', () => exportGraphSvg(container));
    if (unread) {
        const chip = document.createElement('button');
        chip.type = 'button'; chip.className = 'graph-unread-chip' + (unread.on ? ' on' : '');
        chip.setAttribute('aria-pressed', String(unread.on));
        chip.textContent = T('Unread') + ' · ' + unread.count;
        chip.title = T('Show only what you have not read yet');
        chip.addEventListener('click', () => {
            const on = chip.getAttribute('aria-pressed') !== 'true';
            chip.classList.toggle('on', on); chip.setAttribute('aria-pressed', String(on));
            unread.onToggle(on);
        });
        bar.append(chip);
    }
    bar.append(path, save);
}

/** Row (top-left, under the Graph|List switch) that holds the filter chips side by side. */
function filterBar(container) {
    let bar = container.querySelector(':scope > .graph-filterbar');
    if (!bar) { bar = document.createElement('div'); bar.className = 'graph-filterbar'; graphTopbar(container).append(bar); }
    return bar;
}

/** "🎓 Research" toggle chip: show only papers in the graph. */
function renderResearchChip(container, count, on, onToggle) {
    const chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'graph-research-chip' + (on ? ' on' : '');
    chip.setAttribute('aria-pressed', String(on));
    chip.textContent = T('🎓 Research') + ' · ' + count;
    chip.title = T('Show only research papers');
    chip.addEventListener('click', onToggle);
    filterBar(container).append(chip);
}

/** "🕐 Time" chip (top-left, under the Graph|List switch) that opens a from/to month window over the graph. */
function renderTimeRange(container, nodes, links, articles) {
    const span = monthsOf(articles);
    if (!span || span.max - span.min < 1 || !container.__archiveGraphSelections) return;
    const sel = container.__archiveGraphSelections;
    const wrap = document.createElement('div');
    wrap.className = 'graph-time';
    const chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'graph-time-chip'; chip.setAttribute('aria-expanded', 'false');
    setIconLabel(chip, 'clock', T('🕐 Time'));
    const panel = document.createElement('div');
    panel.className = 'graph-time-panel'; panel.hidden = true;
    const text = document.createElement('div'); text.className = 'graph-time-label';
    const counts = monthHistogram(articles, span);
    const peak = Math.max(1, ...counts);
    const total = counts.reduce((a, b) => a + b, 0);
    const mkRange = (label, value) => {
        const r = document.createElement('input');
        r.type = 'range'; r.min = String(span.min); r.max = String(span.max); r.step = '1'; r.value = String(value);
        r.setAttribute('aria-label', label);
        return r;
    };
    // Histogram of articles per month; the two range inputs sit on top of it (keyboard and screen readers keep working).
    const track = document.createElement('div'); track.className = 'graph-time-track';
    const bars = document.createElement('div'); bars.className = 'graph-time-bars'; bars.setAttribute('aria-hidden', 'true');
    const barEls = counts.map((n) => { const b = document.createElement('span'); b.style.height = Math.max(8, Math.round(n / peak * 100)) + '%'; if (!n) b.classList.add('is-empty'); bars.append(b); return b; });
    const from = mkRange(T('From'), span.min), to = mkRange(T('To'), span.max);
    track.append(bars, from, to);
    const ends = document.createElement('div'); ends.className = 'graph-time-ends'; ends.setAttribute('aria-hidden', 'true');
    const e1 = document.createElement('span'); e1.textContent = monthLabel(span.min);
    const e2 = document.createElement('span'); e2.textContent = monthLabel(span.max);
    ends.append(e1, e2);
    const reset = document.createElement('button');
    reset.type = 'button'; reset.className = 'graph-time-reset'; reset.textContent = T('Reset');
    const paint = () => {
        let lo = Number(from.value), hi = Number(to.value);
        if (lo > hi) { if (document.activeElement === from) { hi = lo; to.value = String(hi); } else { lo = hi; from.value = String(lo); } }
        const full = lo === span.min && hi === span.max;
        const inWin = counts.reduce((a, n, i) => a + ((span.min + i >= lo && span.min + i <= hi) ? n : 0), 0);
        barEls.forEach((b, i) => b.classList.toggle('in', span.min + i >= lo && span.min + i <= hi));
        track.style.setProperty('--lo', ((lo - span.min) / Math.max(1, span.max - span.min) * 100) + '%');
        track.style.setProperty('--hi', ((hi - span.min) / Math.max(1, span.max - span.min) * 100) + '%');
        text.textContent = full ? T('All time') + ' · ' + TN(total, '{n} article', '{n} articles') : T('{a} of {b} articles in window', { a: inWin, b: total });
        setIconLabel(chip, 'clock', full ? T('🕐 Time') : '🕐 ' + monthLabel(lo) + ' – ' + monthLabel(hi));
        const vis = full ? null : visibleInRange(nodes, links, lo, hi);
        const dim = (d) => !!vis && !vis.has(d.id);
        sel.node.each(function (d) { this.classList.toggle(TIME_DIM_CLASS, dim(d)); });
        sel.label.each(function (d) { this.classList.toggle(TIME_DIM_CLASS, dim(d)); });
        sel.link.each(function (l) {
            const s = typeof l.source === 'object' ? l.source.id : l.source, t = typeof l.target === 'object' ? l.target.id : l.target;
            this.classList.toggle(TIME_DIM_CLASS, !!vis && !(vis.has(s) && vis.has(t)));
        });
        chip.classList.toggle('on', !full);
        container.dispatchEvent(new CustomEvent('graph-time-range', { detail: { from: lo, to: hi, full }, bubbles: true }));
    };
    // Replay: the window grows from the first month to the last, so you watch the archive (and its topics) build up.
    // Under reduced motion there is no animation: the same button steps one month per press.
    const calmMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const stepMs = Math.max(150, Math.min(700, Math.round(15000 / (span.max - span.min + 1))));   // about 15 s for any archive
    const play = document.createElement('button');
    play.type = 'button'; play.className = 'graph-time-play';
    let timer = null;
    const say = (t) => { const live = container.querySelector('.graph-live'); if (live) live.textContent = t; };
    const paintPlay = () => { play.textContent = calmMotion ? T('Next month →') : timer ? T('⏸ Pause') : T('▶ Replay'); play.setAttribute('aria-pressed', String(!!timer)); };
    const stopReplay = (finished) => {
        if (timer) { clearInterval(timer); timer = null; container.__graphReplayTimer = null; }
        paintPlay();
        if (finished) say(T('Replay finished: all {n} articles in view', { n: total }));
    };
    const advance = () => {
        const hi = Number(to.value);
        if (hi >= span.max) { stopReplay(true); return; }
        to.value = String(hi + 1); paint();
        if (hi + 1 >= span.max) stopReplay(true);
    };
    const restart = () => { from.value = String(span.min); to.value = String(span.min); paint(); };
    play.addEventListener('click', () => {
        if (timer) { stopReplay(false); return; }
        if (calmMotion) { if (Number(to.value) >= span.max) restart(); else advance(); return; }
        restart(); say(T('Replay started: {a}', { a: monthLabel(span.min) }));
        timer = setInterval(advance, stepMs); container.__graphReplayTimer = timer; paintPlay();
    });
    paintPlay();
    from.addEventListener('input', () => stopReplay(false)); to.addEventListener('input', () => stopReplay(false));
    from.addEventListener('input', paint); to.addEventListener('input', paint);
    reset.addEventListener('click', () => { stopReplay(false); from.value = String(span.min); to.value = String(span.max); paint(); });
    chip.addEventListener('click', () => { panel.hidden = !panel.hidden; chip.setAttribute('aria-expanded', String(!panel.hidden)); });
    const actions = document.createElement('div'); actions.className = 'graph-time-actions'; actions.append(play, reset);
    panel.append(text, track, ends, actions);
    wrap.append(chip, panel);
    filterBar(container).append(wrap);
    paint();
}

/**
 * Text twin of the graph for screen readers and keyboard users: a "Graph | List" switch (top-left) and a list of the tags
 * (most connected first) with article counts and neighbours. Enter on a tag filters the archive by it, like clicking the node.
 * A polite live region says what the view contains and announces every switch.
 */
export function renderGraphList(container, nodes, links, gaps = []) {
    container.querySelectorAll('.graph-view-toggle, .graph-list, .graph-live, .graph-gaps').forEach(el => el.remove());
    const id = (x) => (typeof x === 'object' ? x.id : x);
    const byId = new Map(nodes.map(n => [n.id, n]));
    const tags = nodes.filter(n => n.group === 'tag');
    const articleCount = nodes.filter(n => n.group === 'article').length;
    const articlesOf = new Map(); const tagsOf = new Map();
    links.forEach(l => {
        const a = byId.get(id(l.source)), b = byId.get(id(l.target));
        if (!a || !b) return;
        const [art, tag] = a.group === 'article' && b.group === 'tag' ? [a, b] : b.group === 'article' && a.group === 'tag' ? [b, a] : [null, null];
        if (!art) return;
        (articlesOf.get(tag.id) || articlesOf.set(tag.id, new Set()).get(tag.id)).add(art.id);
        (tagsOf.get(art.id) || tagsOf.set(art.id, new Set()).get(art.id)).add(tag.id);
    });
    const related = (tag) => { const out = new Set(); (articlesOf.get(tag.id) || []).forEach(a => (tagsOf.get(a) || []).forEach(t => { if (t !== tag.id) out.add(t); })); return [...out].map(t => byId.get(t).label); };
    const summary = T('Graph of your archive. {tags} tags, {articles} articles. Press L for the list view.', { tags: tags.length, articles: articleCount });
    const svgEl = container.querySelector('svg');
    if (svgEl) { svgEl.setAttribute('role', 'img'); svgEl.setAttribute('aria-label', summary); }

    const live = document.createElement('div');
    live.className = 'graph-live'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
    live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;';
    live.textContent = summary;

    const list = document.createElement('ul');
    list.className = 'graph-list'; list.hidden = true; list.setAttribute('aria-label', T('Tags in your archive'));
    [...tags].sort((x, y) => (articlesOf.get(y.id)?.size || 0) - (articlesOf.get(x.id)?.size || 0) || String(x.label).localeCompare(String(y.label))).forEach((tag) => {
        const li = document.createElement('li');
        const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'graph-list-item';
        const n = articlesOf.get(tag.id)?.size || 0; const rel = related(tag).slice(0, 4);
        const t = document.createElement('span'); t.className = 'graph-list-t'; t.textContent = tag.label;
        const sub = document.createElement('span'); sub.className = 'graph-list-s';
        sub.textContent = TN(n, '{n} article', '{n} articles') + (rel.length ? ' · ' + T('linked to {tags}', { tags: rel.join(', ') }) : '');
        btn.append(t, sub);
        btn.addEventListener('click', () => {
            live.textContent = T('Filter on: {tag}. {n} articles shown.', { tag: tag.label, n });
            container.dispatchEvent(new CustomEvent('filter-by-tag', { detail: { tag: tag.label }, bubbles: true, composed: true }));
        });
        li.append(btn); list.append(li);
    });

    // Third view: topics you started and never followed up (see findGaps). Each article opens like a node would.
    const gapList = document.createElement('ul');
    gapList.className = 'graph-list graph-gaps'; gapList.hidden = true; gapList.setAttribute('aria-label', T('Started, never followed up'));
    const gapNote = document.createElement('li');
    gapNote.className = 'graph-gaps-note';
    gapNote.textContent = T('Topics with one or two saved articles that you have not opened for 30 days. A reading list for what you started.');
    gapList.append(gapNote);
    (gaps || []).forEach((g) => {
        const li = document.createElement('li'); li.className = 'graph-gap';
        const head = document.createElement('div'); head.className = 'graph-list-t'; head.textContent = g.label;
        const sub = document.createElement('div'); sub.className = 'graph-list-s';
        sub.textContent = g.never ? T('never opened') : T('last opened {d}', { d: new Date(g.last).toLocaleDateString() });
        li.append(head, sub);
        // A gap is a to-do, not just a list: one tap opens the topic page (briefing of what you saved, questions, export).
        const act = document.createElement('button'); act.type = 'button'; act.className = 'graph-gap-brief';
        act.textContent = T('Brief me on this'); act.title = T('Open the topic page: a short briefing from the {n} saved summaries', { n: g.articles.length });
        act.addEventListener('click', () => import('./graphClusters.js').then(m => m.showClusterCard(container, { label: g.label, articles: g.articles })));
        li.append(act);
        g.articles.forEach((a) => {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'graph-list-item';
            b.textContent = a.title || (a.content && String(a.content).split('\n')[0]) || T('Untitled');
            b.addEventListener('click', () => container.dispatchEvent(new CustomEvent('open-article', { detail: a, bubbles: true, composed: true })));
            li.append(b);
        });
        gapList.append(li);
    });

    const toggle = document.createElement('div');
    toggle.className = 'segmented-control segmented-control-buttons graph-view-toggle'; toggle.setAttribute('role', 'group'); toggle.setAttribute('aria-label', T('Graph view'));
    const mk = (label) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; return b; };
    const gBtn = mk(T('Graph')), lBtn = mk(T('List'));
    const pBtn = (gaps && gaps.length) ? mk(T('Gaps') + ' ' + gaps.length) : null;
    const btns = { graph: gBtn, list: lBtn, ...(pBtn ? { gaps: pBtn } : {}) };
    let mode = 'graph';
    const set = (next, announce = true) => {
        mode = next === 'list' || (next === 'gaps' && pBtn) ? next : 'graph';
        list.hidden = mode !== 'list'; gapList.hidden = mode !== 'gaps';
        container.dataset.graphMode = mode;
        if (svgEl) svgEl.style.visibility = mode === 'graph' ? '' : 'hidden';
        Object.entries(btns).forEach(([k, b]) => { b.classList.toggle('active', k === mode); b.setAttribute('aria-pressed', String(k === mode)); });
        if (announce) live.textContent = mode === 'list' ? T('List view: {tags} tags. Press Tab to browse, Enter to filter.', { tags: tags.length })
            : mode === 'gaps' ? T('{n} topics started and never followed up', { n: gaps.length }) : T('Graph view');
        const shown = mode === 'list' ? list : mode === 'gaps' ? gapList : null;
        if (shown && announce) { const f = shown.querySelector('button'); if (f) f.focus({ preventScroll: true }); }
    };
    gBtn.addEventListener('click', () => set('graph')); lBtn.addEventListener('click', () => set('list'));
    if (pBtn) pBtn.addEventListener('click', () => set('gaps'));
    // "L" switches the view while this graph is on screen (one document listener per container, replaced on re-render).
    if (container.__graphKeyDoc) document.removeEventListener('keydown', container.__graphKeyDoc);
    container.__graphKeyDoc = (e) => {
        if (!container.isConnected || container.style.display === 'none' || container.getClientRects().length === 0) return;
        if (e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== 'l' || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
        set(mode === 'list' ? 'graph' : 'list');
    };
    document.addEventListener('keydown', container.__graphKeyDoc);
    toggle.append(gBtn, lBtn, ...(pBtn ? [pBtn] : []));
    set('graph', false);
    graphTopbar(container).prepend(toggle);
    container.append(list, gapList, live);
}

/**
 * Overlay controls around the graph: a stats readout (top-right), the
 * well-connected/all-tags toggle and its dismissable stats readout
 * (bottom-center, stacked above the toggle, alongside the bottom nav's
 * visual language), and the link-kind legend (bottom-right). (The
 * filtered/highlight search scope switch lives in the archive search box
 * itself now, not here — see articleManager.js.)
 */
function renderGraphControls(container, { hiddenTagCount, capped, currentlyFiltered, stillOrphanCount, neglectedCount, onToggleDegree, typesPresent = new Set() }) {
    container.querySelectorAll('.graph-controls, .graph-controls-bottom-center, .graph-controls-bottom-right').forEach(el => el.remove());

    // ── Bottom-center: stats readout + well-connected/all toggle ─────────
    // Sits higher than the bottom-right legend (bottom: 10px) so the two
    // don't collide on a narrow graph view.
    const centerBar = document.createElement('div');
    centerBar.className = 'graph-controls-bottom-center';
    centerBar.style.cssText = `
        position: absolute;
        bottom: 46px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 5;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        max-width: 90%;
    `;

    // Dismissable — re-appears on the next render (e.g. toggling well-
    // connected/all-tags) since the underlying counts may have changed, but
    // won't reappear from an unrelated re-render within the same session
    // once the user has closed it (tracked on the container, not per-render
    // local state).
    const parts = [];
    if (capped) {
        parts.push(T('Showing top tags (archive is large)'));
    } else if (currentlyFiltered && hiddenTagCount > 0) {
        parts.push(TN(hiddenTagCount, '{n} rarely-used tag hidden', '{n} rarely-used tags hidden'));
    }
    if (neglectedCount > 0) {
        parts.push(T('{n} unopened 30d+', { n: neglectedCount }));
    }
    if (stillOrphanCount > 0) {
        parts.push(TN(stillOrphanCount, '{n} article not shown', '{n} articles not shown'));
    }
    if (parts.length && !container.__archiveGraphStatsDismissed) {
        const statsRow = document.createElement('div');
        statsRow.style.cssText = `
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 11px;
            color: var(--text-muted);
            background: var(--glass-base, #fff);
            border: 1px solid var(--outline, #ddd);
            border-radius: 8px;
            padding: 4px 6px 4px 10px;
        `;
        const labelEl = document.createElement('span');
        labelEl.textContent = parts.join(' · ');
        statsRow.appendChild(labelEl);

        const dismissBtn = document.createElement('button');
        dismissBtn.type = 'button';
        dismissBtn.textContent = '✕';
        dismissBtn.title = T('Dismiss');
        dismissBtn.setAttribute('aria-label', T('Dismiss graph stats'));
        dismissBtn.style.cssText = `
            border: none;
            background: transparent;
            color: var(--text-muted);
            cursor: pointer;
            font-size: 11px;
            line-height: 1;
            padding: 2px 4px;
        `;
        dismissBtn.addEventListener('click', () => {
            container.__archiveGraphStatsDismissed = true;
            statsRow.remove();
        });
        statsRow.appendChild(dismissBtn);

        centerBar.appendChild(statsRow);
    }

    // A two-segment pill (same visual language as the bottom nav bar)
    // instead of a single "Show all tags" / "Only well-connected tags"
    // button whose label changes meaning depending on current state —
    // both options are always visible, so the current view is a glance,
    // not a read.
    const toggleGroup = document.createElement('div');
    toggleGroup.className = 'segmented-control segmented-control-buttons graph-toggle-large';

    const wellBtn = document.createElement('button');
    wellBtn.type = 'button';
    wellBtn.textContent = T('Well-connected');
    wellBtn.className = currentlyFiltered ? 'active' : '';

    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.textContent = T('All');
    allBtn.className = currentlyFiltered ? '' : 'active';

    wellBtn.addEventListener('click', () => { if (!currentlyFiltered) onToggleDegree(); });
    allBtn.addEventListener('click', () => { if (currentlyFiltered) onToggleDegree(); });

    toggleGroup.appendChild(wellBtn);
    toggleGroup.appendChild(allBtn);
    centerBar.appendChild(toggleGroup);
    container.appendChild(centerBar);

    // ── Bottom-right: link-kind legend ────────────────────────────────────
    const rightBar = document.createElement('div');
    rightBar.className = 'graph-controls-bottom-right';

    // The dashed/thin similarity links vs solid/arrowed tag links carry
    // real meaning; make it visible instead of only documented in code.
    const legendRow = document.createElement('div');
    legendRow.className = 'graph-legend';
    legendRow.innerHTML = `
        <span class="graph-legend-item"><span class="graph-legend-line graph-legend-line--tag"></span> ${T('shared tag')}</span>
        <span class="graph-legend-item"><span class="graph-legend-line graph-legend-line--similar"></span> ${T('similar content')}</span>
        ${['paper', 'video', 'pdf'].filter(k => typesPresent.has(k)).map(k => `<span class="graph-legend-item"><span class="graph-legend-ring graph-legend-ring--${k}"></span> ${sourceName(k)}</span>`).join('')}
        <span class="graph-legend-item"><span class="graph-legend-fill"></span> ${T('fainter = only saved')}</span>
    `;
    rightBar.appendChild(legendRow);

    container.appendChild(rightBar);
}

/**
 * Fetches the article's highlights (user + AI ghost annotations, same
 * source annotationExporter.js's export paths use) and appends a compact
 * list into the preview card's scroll area. Fire-and-forget from
 * showPreviewCard — the card renders immediately with title/summary/tags,
 * this fills in underneath once storage responds, instead of blocking the
 * card open on a chrome.storage round trip.
 *
 * No-ops if the card was already closed (or replaced by a newer one) by
 * the time the fetch resolves, and if the article has no highlights at
 * all — an empty section would just be dead space.
 */
async function renderPreviewHighlights(card, article) {
    const scrollEl = card.querySelector('.graph-preview-card-scroll');
    if (!scrollEl) return;

    let list;
    try {
        list = await fetchAnnotationsForArticle(article);
    } catch (_) {
        return;
    }
    if (!card.isConnected) return; // closed/replaced while the fetch was in flight
    if (!Array.isArray(list) || list.length === 0) return;

    const userItems = list.filter(a => a.type !== 'ghost');
    const ghostItems = list.filter(a => a.type === 'ghost');

    const itemsHtml = items => items.map(a => `<li>"${escapeHtml(a.text)}"</li>`).join('');

    const parts = [];
    if (userItems.length) {
        parts.push(`
            <div class="graph-preview-label">${T('📝 Your highlights')}</div>
            <ul>${itemsHtml(userItems)}</ul>`);
    }
    if (ghostItems.length) {
        parts.push(`
            <div class="graph-preview-label">${T('🤖 AI-suggested highlights')}</div>
            <ul>${itemsHtml(ghostItems)}</ul>`);
    }
    if (!parts.length) return;

    const highlightsEl = document.createElement('div');
    highlightsEl.className = 'graph-preview-highlights';
    highlightsEl.innerHTML = parts.join('');
    scrollEl.appendChild(highlightsEl);
}

/**
 * Shows a floating preview card for an article inside the graph container.
 * Card can be dismissed by clicking its close button or clicking outside it.
 */
export const __test_showPreviewCard = (container, article) => showPreviewCard(container, article);
export const __test_renderTimeRange = (container, nodes, links, articles) => renderTimeRange(container, nodes, links, articles);
function showPreviewCard(container, article) {
    const containerEl = container;
    // Remove any existing preview card
    const existing = containerEl.querySelector('.graph-preview-card');
    if (existing) existing.remove();

    const title = article.title || (article.content && article.content.split('\n')[0]) || T('Untitled');
    const summaryPlain = (new DOMParser().parseFromString(article.summary || '', 'text/html').body.textContent || '').trim();
    const date = article.timestamp ? new Date(article.timestamp).toLocaleDateString() : '';
    const tags = (article.tags || []).map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('');
    const clip = (str, n) => str.length > n ? str.slice(0, n) + '…' : str;

    const card = document.createElement('div');
    card.className = 'graph-preview-card';
    // Flush to the bottom edge of the graph view: a scrollable content area + a pinned action row so
    // "Open in History" stays reachable however long the summary/tag list is (styles.css: .graph-preview-card).
    card.innerHTML = `
        <div class="graph-preview-head">
            <strong>${escapeHtml(clip(title, 60))}</strong>
            <button type="button" class="graph-preview-card-close" aria-label="${escapeHtml(T('Close'))}">✕</button>
        </div>
        <div class="graph-preview-card-scroll">
            <div class="graph-preview-date">${escapeHtml(date)}</div>
            <div class="graph-preview-summary">${escapeHtml(clip(summaryPlain, 200))}</div>
            <div class="graph-preview-tags">${tags}</div>
        </div>
        <div class="graph-preview-foot">
            <button type="button" class="graph-preview-open">${T('Open in History')}</button>
        </div>
    `;

    // Close button
    card.querySelector('.graph-preview-card-close').addEventListener('click', (e) => {
        e.stopPropagation();
        card.remove();
    });

    // Open in history button
    card.querySelector('.graph-preview-open').addEventListener('click', (e) => {
        e.stopPropagation();
        card.remove();
        containerEl.dispatchEvent(new CustomEvent('open-article', {
            detail: article,
            bubbles: true,
            composed: true
        }));
    });

    containerEl.appendChild(card);
    renderPreviewHighlights(card, article);
}