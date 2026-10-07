// annotationExporter.js
// Builds an HTML "Highlights & Notes" section for a saved article from the
// on-page annotations the extension captured (user highlights + AI ghost
// annotations). Consumed by all delivery paths — LocalSend, Kindle, Markdown
// export, copy, share — so the reader gets the highlights even when the AI
// ghost annotations were never explicitly "kept".

/**
 * Normalize a URL to the stable per-page key used by the highlighter
 * (origin + pathname), so annotations saved against the page match the
 * article URL even if the article has query params/fragments appended.
 */
function pageKeyForUrl(url) {
    if (!url) return '';
    try {
        const u = new URL(url);
        return `${u.origin}${u.pathname}`;
    } catch (_) {
        // Fall back to stripping query/fragment heuristically.
        return url.split('#')[0].split('?')[0];
    }
}

/**
 * Escape HTML so annotation text survives interpolation into HTML/XML docs.
 * Exported so other modules building their own (differently-styled) markup
 * around the same annotation text — e.g. archiveGraph.js's preview card —
 * don't need to duplicate it.
 */
export { escapeHtml } from './textUtils.js';
import { escapeHtml } from './textUtils.js';

const MARK_STYLE = {
    user: 'background-color:#fff3a3;color:inherit;padding:0 1px;',
    ghost: 'background-color:#cfe3ff;color:inherit;padding:0 1px;border-bottom:1px solid #93c5fd;',
};

/**
 * Wrap every annotation's text (user highlights AND AI ghost highlights) in <mark> inside an HTML string,
 * so a delivered article/digest shows the highlighted passages in place. Matching ignores whitespace
 * differences and works across inline tags; quotes that cannot be found are simply left unmarked
 * (they still appear in the Highlights list).
 */
export function markHighlights(html, annotations) {
    if (!html || !Array.isArray(annotations) || annotations.length === 0) return html || '';
    const doc = new DOMParser().parseFromString(`<div id="aish-root">${html}</div>`, 'text/html');
    const root = doc.getElementById('aish-root');
    if (!root) return html;
    const textNodes = () => {
        const out = [];
        const walk = (n) => {
            for (let c = n.firstChild; c; c = c.nextSibling) {
                if (c.nodeType === 3) out.push(c);
                else if (c.nodeType === 1 && !/^(MARK|SCRIPT|STYLE)$/i.test(c.nodeName)) walk(c);
            }
        };
        walk(root);
        return out;
    };
    for (const a of annotations) {
        const t = String((a && a.text) || '').replace(/\s+/g, ' ').trim();
        if (t.length < 5) continue;
        const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));
        const nodes = textNodes();
        let full = '';
        const starts = nodes.map(n => { const st = full.length; full += n.nodeValue; return st; });
        const m = re.exec(full);
        if (!m) continue;
        const s0 = m.index, e0 = m.index + m[0].length;
        const style = MARK_STYLE[a.type === 'ghost' ? 'ghost' : 'user'];
        nodes.forEach((n, i) => {
            const ns = starts[i], ne = ns + n.nodeValue.length;
            if (ne <= s0 || ns >= e0) return;
            const from = Math.max(s0, ns) - ns, to = Math.min(e0, ne) - ns;
            const val = n.nodeValue;
            const frag = doc.createDocumentFragment();
            if (from > 0) frag.append(doc.createTextNode(val.slice(0, from)));
            const mk = doc.createElement('mark');
            mk.setAttribute('style', style);
            mk.textContent = val.slice(from, to);
            frag.append(mk);
            if (to < val.length) frag.append(doc.createTextNode(val.slice(to)));
            n.parentNode.replaceChild(frag, n);
        });
    }
    return root.innerHTML;
}

/**
 * Fetch stored annotations (both user highlights AND ghost/AI annotations —
 * the latter included even if never marked "keep") for a given article URL.
 * Returns a promise resolving to an array of { text, type, timestamp }.
 */
export async function fetchAnnotationsForArticle(article) {
    const url = article?.url;
    if (!url) return [];

    return new Promise((resolve) => {
        chrome.storage.local.get(['annotations'], (res) => {
            if (chrome.runtime.lastError) { resolve([]); return; }
            const all = Array.isArray(res.annotations) ? res.annotations : [];
            const key = pageKeyForUrl(url);
            resolve(all.filter(a => a && a.url === key));
        });
    });
}

/**
 * Build an `<section>` HTML block listing the article's highlights/notes.
 * The AI ghost highlights are labeled distinctly from user highlights.
 *
 * @param {object} article the saved article
 * @param {{text:string,type:string,timestamp:string}[]} [annotations] optional
 *        pre-fetched annotations (avoids a duplicate storage read when the
 *        caller already fetched them). Fetched lazily if omitted.
 * @returns {Promise<string>} HTML string ('' when there are no annotations)
 */
export async function buildAnnotationsSection(article, annotations = null) {
    const list = annotations || await fetchAnnotationsForArticle(article);
    return renderAnnotationsHtml(list, { level: 2 });
}

/** Synchronous renderer behind buildAnnotationsSection; `level` is the heading level (2 for a document, 3 inside a digest). */
export function renderAnnotationsHtml(list, { level = 2 } = {}) {
    if (!Array.isArray(list) || list.length === 0) return '';

    const userItems = list.filter(a => a.type !== 'ghost');
    const ghostItems = list.filter(a => a.type === 'ghost');
    const H = `h${level}`;

    const itemHtml = (items, cls) => items.map(a => `
          <li style="margin-bottom:8px;line-height:1.5;">
            <mark style="${MARK_STYLE[cls]}">${escapeHtml(a.text)}</mark>
            <span style="display:block;font-size:11px;color:#888;margin-top:2px;">${cls === 'ghost' ? '🤖 AI highlight' : '📝 Your highlight'}</span>
          </li>`).join('');

    const parts = [];
    if (userItems.length) {
        parts.push(`
      <${H} style="font-size:${level === 2 ? 18 : 15}px;margin:24px 0 8px;color:#444;">📝 Highlights &amp; Notes</${H}>
      <ul style="margin:0;padding-left:20px;color:#333;">${itemHtml(userItems, 'user')}</ul>`);
    }
    if (ghostItems.length) {
        parts.push(`
      <${H} style="font-size:${level === 2 ? 18 : 15}px;margin:24px 0 8px;color:#444;">🤖 AI Suggested Highlights</${H}>
      <ul style="margin:0;padding-left:20px;color:#333;">${itemHtml(ghostItems, 'ghost')}</ul>`);
    }

    return parts.join('\n');
}

/**
 * Convenience: build a plain-text (Markdown-ish) version of the annotations
 * for clipboard / Markdown export.
 */
export async function buildAnnotationsPlainText(article, annotations = null) {
    const list = annotations || (await fetchAnnotationsForArticle(article));
    if (!Array.isArray(list) || list.length === 0) return '';

    const userItems = list.filter(a => a.type !== 'ghost');
    const ghostItems = list.filter(a => a.type === 'ghost');

    const lines = [];
    if (userItems.length) {
        lines.push('## 📝 Your Highlights & Notes');
        userItems.forEach(a => lines.push(`- "${a.text}"`));
    }
    if (ghostItems.length) {
        lines.push('## 🤖 AI Suggested Highlights');
        ghostItems.forEach(a => lines.push(`- "${a.text}"`));
    }
    return lines.join('\n');
}