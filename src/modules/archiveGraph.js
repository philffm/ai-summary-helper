// archiveGraph.js
// Knowledge graph visualization for article tags using D3.js with Pan/Zoom support

let graphInitialized = false;

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

// Deterministic color per tag name
function tagColor(tagLabel) {
    let hash = 0;
    for (let i = 0; i < tagLabel.length; i++) {
        hash = (hash * 31 + tagLabel.charCodeAt(i)) >>> 0;
    }
    return TAG_PALETTE[hash % TAG_PALETTE.length];
}

function buildGraphData(articles) {
    const nodes = [];
    const links = [];
    const tagSet = new Set();
    const nodeMap = new Map();

    articles.forEach(article => {
        const title = article.title || article.content?.split('\n')[0] || 'Untitled';
        const id = 'article-' + (article.timestamp || Math.random());
        nodeMap.set(id, { id, label: title, group: 'article', data: article });
        nodes.push(nodeMap.get(id));

        (article.tags || []).forEach(tag => {
            const tagId = 'tag-' + tag.toLowerCase().replace(/\s+/g, '-');
            if (!tagSet.has(tagId)) {
                tagSet.add(tagId);
                nodeMap.set(tagId, { id: tagId, label: tag, group: 'tag' });
                nodes.push(nodeMap.get(tagId));
            }
            links.push({ source: id, target: tagId });
        });
    });

    return { nodes, links };
}

export function initArchiveGraph(container, articles, highlightTimestamp) {
    if (!container || !articles || articles.length === 0) return;

    container.innerHTML = '';
    container.style.position = 'relative';
    container.style.width = '100%';
    container.style.height = '90%';
    container.style.overflow = 'hidden';

    // Load D3 from bundled library
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('lib/d3.min.js');
    script.onload = () => {
        renderGraph(container, articles, highlightTimestamp);
    };
    document.head.appendChild(script);
}

function renderGraph(container, articles, highlightTimestamp) {
    const data = buildGraphData(articles);
    const { nodes, links } = data;

    if (typeof d3 === 'undefined') {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);">D3 library failed to load.</div>';
        return;
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

    // Create force simulation
    const simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id).distance(100))
        .force('charge', d3.forceManyBody().strength(-250))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(40));

    // Draw links into mainContainer
    const link = mainContainer.append('g')
        .selectAll('line')
        .data(links)
        .join('line')
        .attr('class', 'graph-link')
        .attr('stroke', d => {
            // Color link by the tag node it connects to
            const tagNode = nodes.find(n => n.id === (d.target?.id || d.target));
            return tagNode?.group === 'tag' ? tagColor(tagNode.label) : 'var(--outline)';
        })
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.35)
        .attr('marker-end', 'url(#arrow)');

    // Draw nodes into mainContainer
    const node = mainContainer.append('g')
        .selectAll('circle')
        .data(nodes)
        .join('circle')
        .attr('r', d => {
            if (d.group === 'article') {
                return highlightTimestamp && d.data?.timestamp === highlightTimestamp ? 12 : 8;
            }
            return 5;
        })
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
        .attr('font-size', d => d.group === 'article' ? '11px' : '10px')
        .attr('font-weight', d => d.group === 'tag' ? '600' : 'normal')
        .attr('fill', d => d.group === 'tag' ? tagColor(d.label) : 'var(--text-primary)')
        .attr('text-anchor', 'middle')
        .attr('dy', d => d.group === 'article' ? -12 : -8)
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
