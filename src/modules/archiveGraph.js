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

import { cosineSim } from './localSearch.js';

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

        const title = article.title || article.content?.split('\n')[0] || 'Untitled';
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
            const title = article.title || article.content?.split('\n')[0] || 'Untitled';
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

export function initArchiveGraph(container, articles, highlightTimestamp, similarityIndex = null) {
    if (!container || !articles || articles.length === 0) return;

    container.innerHTML = '';
    container.style.position = 'relative';
    container.style.width = '100%';
    container.style.height = '90%';
    container.style.overflow = 'hidden';

    loadD3()
        .then(() => renderGraph(container, articles, highlightTimestamp, MIN_TAG_DEGREE_DEFAULT, similarityIndex))
        .catch(() => {
            container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">D3 library failed to load.</div>';
        });
}

function renderGraph(container, articles, highlightTimestamp, minTagDegree, similarityIndex) {
    const raw = buildGraphData(articles, minTagDegree, similarityIndex);
    const { nodes, links, nodeById, capped } = capGraphData(raw);
    const { hiddenTagCount, reconnectedCount, stillOrphanCount } = raw;

    if (typeof d3 === 'undefined') {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">D3 library failed to load.</div>';
        return;
    }

    // A previous render (e.g. from the filter toggle) may still have a
    // ResizeObserver/window listener watching this container — stop them
    // before replacing the DOM, or we'd end up with duplicate handlers
    // stacking up.
    if (container.__archiveGraphResizeObserver) {
        container.__archiveGraphResizeObserver.disconnect();
        container.__archiveGraphResizeObserver = null;
    }
    if (container.__archiveGraphWindowResizeHandler) {
        window.removeEventListener('resize', container.__archiveGraphWindowResizeHandler);
        container.__archiveGraphWindowResizeHandler = null;
    }

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
            return highlightTimestamp && d.data?.timestamp === highlightTimestamp ? 12 : 8;
        }
        return tagRadiusScale(d.degree || 1);
    }

    // Create force simulation
    const simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id).distance(100))
        .force('charge', d3.forceManyBody().strength(-250))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(d => nodeRadius(d) + 6));

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
            return 'var(--bg-primary, #fff)';
        })
        .attr('stroke-width', d => {
            if (highlightTimestamp && d.group === 'article' && d.data?.timestamp === highlightTimestamp) return 3;
            return 1.5;
        })
        .style('cursor', 'pointer')
        .call(drag(simulation));

    // Pulse animation for highlighted node
    if (highlightTimestamp) {
        node.filter(d => d.group === 'article' && d.data?.timestamp === highlightTimestamp)
            .each(function() {
                const el = d3.select(this);
                (function pulse() {
                    el.transition().duration(700).attr('r', 15).attr('stroke-opacity', 0.4)
                      .transition().duration(700).attr('r', 12).attr('stroke-opacity', 1)
                      .on('end', pulse);
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

    // Click handler for article nodes — show a preview card
    node.on('click', (event, d) => {
        if (d.group === 'article' && d.data) {
            event.stopPropagation();
            showPreviewCard(container, d.data);
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

    // ── Filter toggle + status badge ────────────────────────────────────
    // Only bother showing the toggle/status when there's something to say.
    if (hiddenTagCount > 0 || capped || stillOrphanCount > 0 || reconnectedCount > 0) {
        renderGraphControls(container, {
            hiddenTagCount,
            capped,
            currentlyFiltered: minTagDegree > 1,
            reconnectedCount,
            stillOrphanCount,
            onToggle: () => {
                const nextMinDegree = minTagDegree > 1 ? 1 : MIN_TAG_DEGREE_DEFAULT;
                simulation.stop();
                renderGraph(container, articles, highlightTimestamp, nextMinDegree, similarityIndex);
            },
        });
    }
}

/**
 * Small overlay control in the corner of the graph: lets the user toggle
 * between "only tags with 2+ connections" (default, faster, readable) and
 * "show every tag". Also surfaces the NODE_CAP safety message and how many
 * articles were reconnected via content similarity vs. still not shown.
 */
function renderGraphControls(container, { hiddenTagCount, capped, currentlyFiltered, reconnectedCount, stillOrphanCount, onToggle }) {
    const existing = container.querySelector('.graph-controls');
    if (existing) existing.remove();

    const bar = document.createElement('div');
    bar.className = 'graph-controls';
    bar.style.cssText = `
        position: absolute;
        top: 10px;
        right: 10px;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 6px;
        z-index: 5;
        max-width: 70%;
    `;

    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const label = document.createElement('span');
    label.style.cssText = `
        font-size: 11px;
        color: var(--text-muted);
        background: var(--glass-base, #fff);
        border: 1px solid var(--outline, #ddd);
        border-radius: 8px;
        padding: 4px 8px;
        text-align: right;
    `;
    const parts = [];
    if (capped) {
        parts.push('Showing top tags (archive is large)');
    } else if (currentlyFiltered && hiddenTagCount > 0) {
        parts.push(`${hiddenTagCount} rarely-used tag${hiddenTagCount === 1 ? '' : 's'} hidden`);
    } else {
        parts.push('Showing all tags');
    }
    if (stillOrphanCount > 0) {
        parts.push(`${stillOrphanCount} article${stillOrphanCount === 1 ? '' : 's'} not shown`);
    }
    label.textContent = parts.join(' · ');

    const button = document.createElement('button');
    button.className = 'graph-controls-toggle';
    button.style.cssText = `
        font-size: 11px;
        border: 1px solid var(--outline, #ddd);
        border-radius: 8px;
        padding: 4px 10px;
        background: var(--accent, #007bff);
        color: #fff;
        cursor: pointer;
        white-space: nowrap;
    `;
    button.textContent = currentlyFiltered ? 'Show all tags' : 'Only well-connected tags';
    button.addEventListener('click', onToggle);

    row.appendChild(label);
    row.appendChild(button);
    bar.appendChild(row);

    if (reconnectedCount > 0) {
        const legend = document.createElement('span');
        legend.style.cssText = `
            font-size: 10px;
            color: var(--text-muted);
            background: var(--glass-base, #fff);
            border: 1px solid var(--outline, #ddd);
            border-radius: 8px;
            padding: 3px 8px;
        `;
        legend.textContent = `- - - ${reconnectedCount} connected by similar content, no shared tag`;
        bar.appendChild(legend);
    }

    container.appendChild(bar);
}

/**
 * Shows a floating preview card for an article inside the graph container.
 * Card can be dismissed by clicking its close button or clicking outside it.
 */
function showPreviewCard(container, article) {
    const containerEl = container;
    // Remove any existing preview card
    const existing = containerEl.querySelector('.graph-preview-card');
    if (existing) existing.remove();

    const safeTitle = article.title || (article.content && article.content.split('\n')[0]) || 'Untitled';
    const summaryPlain = (article.summary || '')
        .replace(/<[^>]+>/g, '').trim()
        .slice(0, 200);
    const date = article.timestamp ? new Date(article.timestamp).toLocaleDateString() : '';
    const tags = (article.tags || []).map(t => `<span class="tag-chip" style="font-size:10px;">${t}</span>`).join('');

    const card = document.createElement('div');
    card.className = 'graph-preview-card';
    card.style.cssText = `
        position: absolute;
        bottom: 12px;
        left: 12px;
        right: 12px;
        background: var(--glass-base, #fff);
        border: 1px solid var(--outline, #ddd);
        border-radius: 12px;
        padding: 14px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        z-index: 10;
        max-height: 180px;
        overflow-y: auto;
        font-size: 13px;
        line-height: 1.4;
    `;
    card.innerHTML = `
        <div class="graph-preview-card-close" style="
            float: right;
            background: none;
            border: none;
            font-size: 18px;
            cursor: pointer;
            opacity: 0.5;
            padding: 0 4px;
            line-height: 1;
        ">✕</div>
        <strong style="display:block;margin-bottom:4px;padding-right:24px;">${safeTitle.length > 60 ? safeTitle.slice(0, 60) + '…' : safeTitle}</strong>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">${date}</div>
        <div style="font-size:12px;margin-bottom:6px;max-height:48px;overflow:hidden;">${summaryPlain}${summaryPlain.length >= 200 ? '…' : ''}</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;">${tags}</div>
        <div style="margin-top:8px;display:flex;gap:6px;">
            <button class="graph-preview-open" style="flex:1;padding:6px;border:none;border-radius:6px;background:var(--accent,#007bff);color:#fff;font-size:11px;cursor:pointer;">Open in History</button>
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
}