// modules/articleBlocks.js
// Turns an article's HTML into a compact list of text blocks for the phone reader: [["h2","Heading"],["p","Paragraph"],["li","Item"],["q","Quote"],["pre","code"]].
// No images, no links, no markup: the phone renders the blocks natively, so there is nothing to sanitize or execute there.
//
// DOM-agnostic on purpose: it only reads nodeType, nodeValue/textContent, tagName and childNodes, so it runs on a browser
// Document, in jsdom (tests) or on any compatible tree. Pure: no chrome.*, no fetch.

export const BLOCK_TYPES = ['h1', 'h2', 'h3', 'p', 'li', 'q', 'pre'];
export const MAX_BLOCKS = 6000;
export const MAX_BLOCK_TEXT = 20000;

const SKIP = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'svg', 'canvas', 'form', 'button', 'select', 'input', 'textarea',
    'nav', 'aside', 'footer', 'img', 'picture', 'video', 'audio', 'object', 'embed', 'head', 'dialog']);
const HEADING = { h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h3', h5: 'h3', h6: 'h3' };
const BLOCKISH = new Set(['p', 'div', 'section', 'article', 'main', 'ul', 'ol', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'figure', 'figcaption',
    'dl', 'dt', 'dd', 'details', 'summary', 'header', 'address', 'hr', 'body', 'html']);

const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const textOf = (n) => (n.textContent != null ? n.textContent : (n.nodeValue || ''));

/** `root` is any node with childNodes (an Element, a Document or a DocumentFragment). Returns the blocks, in reading order. */
export function htmlToBlocks(root, { maxBlocks = MAX_BLOCKS } = {}) {
    const blocks = [];
    let buf = '';
    let kind = 'p';
    const flush = () => {
        const t = squash(buf);
        buf = '';
        if (t && blocks.length < maxBlocks) blocks.push([kind, t.slice(0, MAX_BLOCK_TEXT)]);
    };
    const walk = (node) => {
        for (const c of Array.from(node.childNodes || [])) {
            if (blocks.length >= maxBlocks) return;
            if (c.nodeType === 3) { buf += c.nodeValue || ''; continue; }
            if (c.nodeType !== 1) continue;
            const tag = String(c.tagName || '').toLowerCase();
            if (SKIP.has(tag)) continue;
            if (HEADING[tag]) { flush(); const t = squash(textOf(c)); if (t) blocks.push([HEADING[tag], t.slice(0, 500)]); continue; }
            if (tag === 'pre') { flush(); const t = textOf(c).replace(/\r/g, '').replace(/\s+$/g, '').slice(0, MAX_BLOCK_TEXT); if (t.trim()) blocks.push(['pre', t]); continue; }
            if (tag === 'br') { buf += ' '; continue; }
            if (tag === 'li' || tag === 'blockquote') {
                flush();
                const prev = kind; kind = tag === 'li' ? 'li' : 'q';
                walk(c); flush();
                kind = prev;
                continue;
            }
            if (BLOCKISH.has(tag)) { flush(); walk(c); flush(); continue; }
            walk(c);   // inline element: a, span, b, i, em, strong, code, sup ...
        }
    };
    walk(root);
    flush();
    return blocks;
}

/** Plain text (no tags at all) becomes paragraphs split at blank lines. */
export function textToBlocks(text) {
    return String(text || '').replace(/\r/g, '').split(/\n{2,}/).map(squash).filter(Boolean).slice(0, MAX_BLOCKS).map((t) => ['p', t.slice(0, MAX_BLOCK_TEXT)]);
}

/** Validates blocks from an untrusted source: known types only, strings only, clipped. */
export function cleanBlocks(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const b of list) {
        if (out.length >= MAX_BLOCKS) break;
        if (!Array.isArray(b) || typeof b[0] !== 'string' || typeof b[1] !== 'string' || !BLOCK_TYPES.includes(b[0])) continue;
        const t = b[0] === 'pre' ? b[1].slice(0, MAX_BLOCK_TEXT) : squash(b[1]).slice(0, MAX_BLOCK_TEXT);
        if (t.trim()) out.push([b[0], t]);
    }
    return out;
}

/**
 * The AI summary is stored as HTML (lists, bold, headings). The phone shows plain text, so it becomes lines: list items start with
 * "- ", other blocks are paragraphs separated by a blank line.
 */
export function summaryToText(summary, parseHtml) {
    const s = String(summary || '').trim();
    if (!s) return '';
    if (!/<[a-z][\s\S]*>/i.test(s)) return s;
    let blocks;
    try { blocks = parseHtml ? htmlToBlocks(parseHtml(s)) : textToBlocks(s.replace(/<[^>]*>/g, ' ')); } catch (_) { blocks = textToBlocks(s.replace(/<[^>]*>/g, ' ')); }
    const lines = [];
    blocks.forEach(([type, text], i) => {
        if (type === 'li') lines.push('- ' + text);
        else {
            if (i > 0 && lines.length && lines[lines.length - 1] !== '') lines.push('');
            lines.push(text, '');
        }
    });
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The article fields the phone needs, from a saved article record. `parseHtml(html)` returns a DOM root (DOMParser in the browser). */
export function articleForPhone(article, parseHtml) {
    const a = article || {};
    const html = String(a.content || a.html || a.text || '');
    const hasTags = /<[a-z][\s\S]*>/i.test(html);
    let blocks = [];
    if (html) {
        try { blocks = hasTags && parseHtml ? htmlToBlocks(parseHtml(html)) : textToBlocks(html); } catch (_) { blocks = textToBlocks(html.replace(/<[^>]*>/g, ' ')); }
    }
    let site = '';
    try { site = new URL(a.url).hostname.replace(/^www\./, ''); } catch (_) { /* no url */ }
    return {
        url: a.url,
        title: squash(a.title) || (blocks[0] ? blocks[0][1].slice(0, 120) : ''),
        site,
        byline: squash(a.byline || a.author),
        lang: squash(a.language || a.lang || a.summaryLanguage).slice(0, 20),
        summary: summaryToText(a.summary, parseHtml),
        blocks,
    };
}
