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
import { T, TN } from './feedI18n.js';
import { fetchAnnotationsForArticle, escapeHtml } from './annotationExporter.js';

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
function buildGraphData(articles, minTagDegree = MIN_TAG_DEGREE_DEFAULT, similarityIndex = null) {
    // 1. Count tag degree first, so we can filter before building nodes/links.
    const tagDegree = new Map(); // tagId -> count
    const tagLabelById = new Map();

    articles.forEach(article => {
        (article.tags || []).forEach(tag => {
            const tagId = 'tag-' + tag.toLowerCase().replace(/\s+/g, '-');
            tagDegree.set(tagId, (tagDegree.get(tagId) || 0) + 1);
            tagLabelById.set(tagId, tag);
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
            const tagId = 'tag-' + tag.toLowerCase().replace(/\s+/g, '-');
            return allowedTagIds.has(tagId);
        });
        if (articleTags.length === 0) return;

        const title = article.title || article.content?.split('\n')[0] || T('Untitled');
        const id = 'article-' + (article.timestamp || Math.random());
        const articleNode = { id, label: title, group: 'article', data: article };
        nodeById.set(id, articleNode);
        nodes.push(articleNode);

        articleTags.forEach(tag => {
            const tagId = 'tag-' + tag.toLowerCase().replace(/\s+/g, '-');
            if (!nodeById.has(tagId)) {
                const tagNode = { id: tagId, label: tag, group: 'tag', degree: tagDegree.get(tagId) };
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

    articles.forEach(article => {
        if (!article.timestamp) { stillOrphanCount++; return; }
        const id = 'article-' + article.timestamp;
        if (includedArticleIds.has(id)) return; // already has a tag link

        const best = mostSimilarIncluded(similarityIndex, article, articles, includedArticleIds);
        if (best) {
            const title = article.title || article.content?.split('\n')[0] || T('Untitled');
            const orphanNode = { id, label: title, group: 'article', data: article };
            nodeById.set(id, orphanNode);
            nodes.push(orphanNode);
            links.push({ source: id, target: best.id, kind: 'similarity', score: best.score });
            includedArticleIds.add(id);
            reconnectedCount++;
        } else {
            stillOrphanCount++;
        }
    });

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

    if (!q) {
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
    if (container.__archiveGraphDimRaf) {
        cancelAnimationFrame(container.__archiveGraphDimRaf);
        container.__archiveGraphDimRaf = null;
    }
}

function renderGraph(container, articles, highlightTimestamp, minTagDegree, similarityIndex) {
    const raw = buildGraphData(articles, minTagDegree, similarityIndex);
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
    const measureAndResize = () => {
        const newWidth = container.clientWidth;
        const newHeight = container.clientHeight;
        if (newWidth <= 0 || newHeight <= 0) return;

        svg.attr('width', newWidth).attr('height', newHeight);
        simulation.force('center', d3.forceCenter(newWidth / 2, newHeight / 2));
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
            const base = highlightTimestamp && d.data?.timestamp === highlightTimestamp ? 12 : 8;
            // Neglected articles shrink slightly on top of fading, so the
            // stale ones read as smaller/quieter at a glance.
            return (neglectDays.get(d.id) || 0) >= NEGLECT_THRESHOLD_DAYS ? base * NEGLECT_SHRINK : base;
        }
        return tagRadiusScale(d.degree || 1);
    }

    // Create force simulation
    const simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id).distance(100))
        .force('charge', d3.forceManyBody().strength(-250))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(d => nodeRadius(d) + 6));

    // Keep a handle on the container so destroyArchiveGraph() (and the
    // next initArchiveGraph call) can stop this simulation and release its
    // node/link object graph instead of letting it tick forever.
    container.__archiveGraphSimulation = simulation;

    // Draw links into mainContainer — color lookup via Map (O(1)) instead of
    // the old nodes.find() (O(n) per link).
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
        .attr('r', nodeRadius)
        .attr('fill', d => {
            if (d.group === 'article') return 'var(--accent)';
            return tagColor(d.label);
        })
        .attr('stroke', d => {
            if (highlightTimestamp && d.group === 'article' && d.data?.timestamp === highlightTimestamp) {
                return '#fbbf24'; // amber highlight ring
            }
            // Neglected articles shift their ring toward the danger end of
            // the palette — a quiet "this one's gone stale" cue.
            if (d.group === 'article' && (neglectDays.get(d.id) || 0) >= NEGLECT_THRESHOLD_DAYS) {
                return 'var(--danger)';
            }
            return 'var(--bg-primary, #fff)';
        })
        .attr('stroke-width', d => {
            if (highlightTimestamp && d.group === 'article' && d.data?.timestamp === highlightTimestamp) return 3;
            return 1.5;
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
        .text(d => d.label.length > 20 ? d.label.slice(0, 20) + '…' : d.label)
        .attr('font-size', d => d.group === 'tag' ? `${tagFontScale(d.degree || 1)}px` : '10px')
        .attr('font-weight', d => d.group === 'tag' ? '700' : 'normal')
        .attr('fill', d => d.group === 'tag' ? tagColor(d.label) : 'var(--text-muted)')
        .attr('text-anchor', 'middle')
        .attr('dy', d => -(nodeRadius(d) + 4))
        .style('pointer-events', 'none')
        .style('text-shadow', '0 1px 2px var(--bg-primary)');

    // Kept on the container so applyGraphSearchDim() can restyle the
    // already-rendered graph (no rebuild, no simulation restart) when the
    // 'all' scope wants to dim non-matches against the archive search box
    // instead of removing them.
    container.__archiveGraphSelections = { node, link, label };

    // Tick function
    simulation.on('tick', () => {
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

    // Click handler for article nodes — show a preview card. Tag nodes
    // dispatch a `filter-by-tag` event so the archive list can filter to
    // that tag, turning the graph into a navigation surface.
    node.on('click', (event, d) => {
        if (d.group === 'article' && d.data) {
            event.stopPropagation();
            showPreviewCard(container, d.data);
        } else if (d.group === 'tag') {
            event.stopPropagation();
            container.dispatchEvent(new CustomEvent('filter-by-tag', {
                detail: { tag: d.label },
                bubbles: true,
                composed: true
            }));
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
    renderGraphList(container, nodes, links);
    renderGraphControls(container, {
        hiddenTagCount,
        capped,
        currentlyFiltered: minTagDegree > 1,
        stillOrphanCount,
        neglectedCount,
        onToggleDegree: () => {
            const nextMinDegree = minTagDegree > 1 ? 1 : MIN_TAG_DEGREE_DEFAULT;
            simulation.stop();
            renderGraph(container, articles, highlightTimestamp, nextMinDegree, similarityIndex);
        },
    });
}


/**
 * Text twin of the graph for screen readers and keyboard users: a "Graph | List" switch (top-left) and a list of the tags
 * (most connected first) with article counts and neighbours. Enter on a tag filters the archive by it, like clicking the node.
 * A polite live region says what the view contains and announces every switch.
 */
export function renderGraphList(container, nodes, links) {
    container.querySelectorAll('.graph-view-toggle, .graph-list, .graph-live').forEach(el => el.remove());
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

    const toggle = document.createElement('div');
    toggle.className = 'segmented-control segmented-control-buttons graph-view-toggle'; toggle.setAttribute('role', 'group'); toggle.setAttribute('aria-label', T('Graph view'));
    const mk = (label) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; return b; };
    const gBtn = mk(T('Graph')), lBtn = mk(T('List'));
    const set = (listMode, announce = true) => {
        list.hidden = !listMode;
        if (svgEl) svgEl.style.visibility = listMode ? 'hidden' : '';
        gBtn.classList.toggle('active', !listMode); lBtn.classList.toggle('active', listMode);
        gBtn.setAttribute('aria-pressed', String(!listMode)); lBtn.setAttribute('aria-pressed', String(listMode));
        if (announce) live.textContent = listMode ? T('List view: {tags} tags. Press Tab to browse, Enter to filter.', { tags: tags.length }) : T('Graph view');
        if (listMode) { const f = list.querySelector('button'); if (f) f.focus({ preventScroll: true }); }
    };
    gBtn.addEventListener('click', () => set(false)); lBtn.addEventListener('click', () => set(true));
    // "L" switches the view while this graph is on screen (one document listener per container, replaced on re-render).
    if (container.__graphKeyDoc) document.removeEventListener('keydown', container.__graphKeyDoc);
    container.__graphKeyDoc = (e) => {
        if (!container.isConnected || container.style.display === 'none' || container.getClientRects().length === 0) return;
        if (e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== 'l' || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
        set(list.hidden);
    };
    document.addEventListener('keydown', container.__graphKeyDoc);
    toggle.append(gBtn, lBtn);
    set(false, false);
    container.append(toggle, list, live);
}

/**
 * Overlay controls around the graph: a stats readout (top-right), the
 * well-connected/all-tags toggle and its dismissable stats readout
 * (bottom-center, stacked above the toggle, alongside the bottom nav's
 * visual language), and the link-kind legend (bottom-right). (The
 * filtered/highlight search scope switch lives in the archive search box
 * itself now, not here — see articleManager.js.)
 */
function renderGraphControls(container, { hiddenTagCount, capped, currentlyFiltered, stillOrphanCount, neglectedCount, onToggleDegree }) {
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