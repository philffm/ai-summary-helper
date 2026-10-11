// connectionMap.js
// A static "how are these articles connected" overview for exported bundles (Kindle, LocalSend, Share).
// E-readers cannot run the interactive D3 graph, so this builds a small, deterministic picture instead:
// articles on the left (numbered like the bundle's table of contents), shared tags on the right, dashed
// arcs between articles that are close in content but share no tag. A plain-text list of the same
// connections always goes with it, so the page still makes sense where the image does not render.
//   buildConnectionGraph()  pure data: { nodes, tags, tagLinks, simLinks }
//   renderConnectionSvg()   pure string: grayscale SVG (e-ink safe: no colour-only meaning)
//   renderConnectionText()  pure string: HTML list
//   buildConnectionMapHtml() async: picks SVG / PNG / text for the target

import { cosineSim } from './localSearch.js';
import { T, TN } from './feedI18n.js';
import { escapeHtml } from './textUtils.js';

export const MAP_MAX_ARTICLES = 12;
export const MAP_MAX_TAGS = 10;
export const MAP_MIN_SIM = 0.2;
export const MAP_MAX_SIM_LINKS = 6;

const tagKey = (t) => String(t).trim().toLowerCase();

/**
 * @param {Array<object>} articles  already in bundle order (index i = anchor #aish-mag-i)
 * @param {{vectors: Map}|null} index  TF-IDF index (localSearch.buildIndex); null = tag links only
 */
export function buildConnectionGraph(articles, index = null, { maxArticles = MAP_MAX_ARTICLES, maxTags = MAP_MAX_TAGS, minSim = MAP_MIN_SIM, maxSimLinks = MAP_MAX_SIM_LINKS } = {}) {
    const list = articles.slice(0, maxArticles);
    const nodes = list.map((a, i) => ({ i, title: a.title || T('Untitled'), timestamp: a.timestamp }));

    // Only tags that tie at least two of the bundled articles together are a "connection".
    const byTag = new Map();
    list.forEach((a, i) => {
        const seen = new Set();
        (a.tags || []).forEach((t) => {
            const k = tagKey(t); if (!k || seen.has(k)) return; seen.add(k);
            if (!byTag.has(k)) byTag.set(k, { key: k, label: String(t).trim(), members: [] });
            byTag.get(k).members.push(i);
        });
    });
    const tags = [...byTag.values()].filter(t => t.members.length >= 2)
        .sort((a, b) => b.members.length - a.members.length || a.label.localeCompare(b.label))
        .slice(0, maxTags);
    // Order tags by the mean row of their articles so edges cross as little as possible.
    tags.sort((a, b) => mean(a.members) - mean(b.members) || a.label.localeCompare(b.label));
    const tagLinks = [];
    tags.forEach((t, ti) => t.members.forEach(i => tagLinks.push({ article: i, tag: ti })));

    const tied = new Set();
    tags.forEach(t => t.members.forEach((i) => t.members.forEach((j) => { if (i < j) tied.add(i + ':' + j); })));
    const simLinks = [];
    if (index && index.vectors) {
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
            if (tied.has(i + ':' + j)) continue;
            const va = index.vectors.get(list[i].timestamp), vb = index.vectors.get(list[j].timestamp);
            if (!va || !vb || !va.size || !vb.size) continue;
            const score = cosineSim(va, vb);
            if (score >= minSim) simLinks.push({ a: i, b: j, score });
        }
        simLinks.sort((x, y) => y.score - x.score);
        simLinks.length = Math.min(simLinks.length, maxSimLinks);
    }
    const linked = new Set([...tagLinks.map(l => l.article), ...simLinks.flatMap(l => [l.a, l.b])]);
    nodes.forEach(n => { n.isolated = !linked.has(n.i); });
    return { nodes, tags, tagLinks, simLinks, truncated: Math.max(0, articles.length - list.length) };
}

function mean(a) { return a.reduce((s, x) => s + x, 0) / (a.length || 1); }
const clip = (s, n) => { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };

export const hasConnections = (g) => g.tagLinks.length > 0 || g.simLinks.length > 0;

const W = 800, ROW = 38, TOP = 44, PAD = 24, LEFT_X = 40, RIGHT_X = 560;

/** Grayscale SVG. Fixed viewBox, so it scales to any screen; text is real <text> (escaped), never markup. */
export function renderConnectionSvg(g, { withBackground = true } = {}) {
    const rows = Math.max(g.nodes.length, g.tags.length, 1);
    const H = TOP + rows * ROW + PAD;
    const ay = (i) => TOP + i * ROW + ROW / 2;
    // Tags are spread across the same vertical span as the articles.
    const ty = (ti) => g.tags.length <= 1 ? TOP + (rows * ROW) / 2 : TOP + ROW / 2 + ti * ((rows - 1) * ROW) / (g.tags.length - 1);
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="sans-serif" role="img" aria-label="${escapeHtml(T('Connections between the articles'))}">`];
    if (withBackground) out.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
    out.push(`<text x="${LEFT_X}" y="26" font-size="15" font-weight="bold" fill="#000">${escapeHtml(T('Articles'))}</text>`,
        `<text x="${RIGHT_X}" y="26" font-size="15" font-weight="bold" fill="#000">${escapeHtml(T('Shared topics'))}</text>`);
    // similarity arcs (dashed) on the far left, bowing out proportional to the distance
    g.simLinks.forEach((l) => {
        const y1 = ay(l.a), y2 = ay(l.b), bow = 14 + (l.b - l.a) * 7;
        out.push(`<path d="M ${LEFT_X - 6} ${y1} C ${LEFT_X - 6 - bow} ${y1}, ${LEFT_X - 6 - bow} ${y2}, ${LEFT_X - 6} ${y2}" fill="none" stroke="#000" stroke-width="2" stroke-dasharray="6 5"/>`);
    });
    g.tagLinks.forEach((l) => {
        out.push(`<line x1="${LEFT_X + 330}" y1="${ay(l.article)}" x2="${RIGHT_X - 10}" y2="${ty(l.tag)}" stroke="#000" stroke-width="1.6"/>`);
    });
    g.nodes.forEach((n) => {
        const y = ay(n.i);
        out.push(`<circle cx="${LEFT_X + 10}" cy="${y}" r="12" fill="${n.isolated ? '#fff' : '#000'}" stroke="#000" stroke-width="2"/>`,
            `<text x="${LEFT_X + 10}" y="${y + 5}" font-size="13" font-weight="bold" text-anchor="middle" fill="${n.isolated ? '#000' : '#fff'}">${n.i + 1}</text>`,
            `<text x="${LEFT_X + 30}" y="${y + 5}" font-size="14" fill="#000">${escapeHtml(clip(n.title, 38))}</text>`);
    });
    g.tags.forEach((t, ti) => {
        const y = ty(ti);
        out.push(`<circle cx="${RIGHT_X - 10}" cy="${y}" r="5" fill="#000"/>`,
            `<text x="${RIGHT_X + 4}" y="${y + 5}" font-size="14" fill="#000">${escapeHtml(clip(t.label, 22))} <tspan font-size="12">(${t.members.length})</tspan></text>`);
    });
    // legend
    out.push(`<line x1="${LEFT_X}" y1="${H - 10}" x2="${LEFT_X + 30}" y2="${H - 10}" stroke="#000" stroke-width="2" stroke-dasharray="6 5"/>`,
        `<text x="${LEFT_X + 38}" y="${H - 6}" font-size="12" fill="#000">${escapeHtml(T('similar content'))}</text>`,
        `<line x1="${LEFT_X + 190}" y1="${H - 10}" x2="${LEFT_X + 220}" y2="${H - 10}" stroke="#000" stroke-width="1.6"/>`,
        `<text x="${LEFT_X + 228}" y="${H - 6}" font-size="12" fill="#000">${escapeHtml(T('shares a topic'))}</text>`);
    out.push('</svg>');
    return { svg: out.join(''), width: W, height: H };
}

/** The same connections as text; each article number links to its section in the bundle. */
export function renderConnectionText(g) {
    const ref = (i) => `<a href="#aish-mag-${i}">${i + 1}</a>`;
    const item = (html) => `<li>${html}</li>`;
    const items = [];
    g.tags.forEach((t) => items.push(item(`<b>${escapeHtml(t.label)}</b>: ${t.members.map(ref).join(', ')}`)));
    g.simLinks.forEach((l) => items.push(item(`${ref(l.a)} ↔ ${ref(l.b)} — ${escapeHtml(T('similar content'))} (${Math.round(l.score * 100)}%)`)));
    const alone = g.nodes.filter(n => n.isolated);
    if (alone.length) items.push(item(`${escapeHtml(T('Stand-alone'))}: ${alone.map(n => ref(n.i)).join(', ')}`));
    return items.length ? `<ul class="aish-conn">${items.join('')}</ul>` : '';
}

/** SVG → PNG data URL via canvas (the popup has a DOM). Rejects when the environment cannot rasterize. */
export function svgToPngDataUrl(svg, width, height, scale = 1.5) {
    return new Promise((resolve, reject) => {
        try {
            const img = new Image();
            img.onload = () => {
                try {
                    const c = document.createElement('canvas');
                    c.width = Math.round(width * scale); c.height = Math.round(height * scale);
                    const ctx = c.getContext('2d');
                    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
                    ctx.drawImage(img, 0, 0, c.width, c.height);
                    resolve(c.toDataURL('image/png'));
                } catch (e) { reject(e); }
            };
            img.onerror = () => reject(new Error('svg render failed'));
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        } catch (e) { reject(e); }
    });
}

/**
 * HTML block for the top of a bundle. image: 'svg' (inline vector), 'png' (embedded raster; for Kindle,
 * whose converter is unreliable with SVG), or 'none' (text list only). A failed PNG falls back to text.
 * Returns '' when the articles have nothing in common (no point in a map of unconnected dots).
 */
export async function buildConnectionMapHtml(articles, index, { image = 'svg' } = {}) {
    const g = buildConnectionGraph(articles, index);
    if (!hasConnections(g)) return '';
    let picture = '';
    if (image !== 'none') {
        const { svg, width, height } = renderConnectionSvg(g);
        const alt = escapeHtml(T('How these articles are connected'));
        if (image === 'png') {
            try { picture = `<p><img src="${await svgToPngDataUrl(svg, width, height)}" width="${width}" height="${height}" alt="${alt}" style="max-width:100%;height:auto;"/></p>`; }
            catch (_) { picture = ''; }
        } else picture = `<div class="aish-conn-map" style="max-width:100%;">${svg}</div>`;
    }
    const more = g.truncated ? `<p style="color:#666;font-size:0.9em;">${escapeHtml(TN(g.truncated, '+{n} more article not shown on the map', '+{n} more articles not shown on the map'))}</p>` : '';
    return `<h2>${escapeHtml(T('How these articles connect'))}</h2>${picture}${renderConnectionText(g)}${more}<hr />`;
}
