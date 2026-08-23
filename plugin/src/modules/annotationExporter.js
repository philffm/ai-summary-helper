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
 */
function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
    if (!Array.isArray(list) || list.length === 0) return '';

    const userItems = list.filter(a => a.type !== 'ghost');
    const ghostItems = list.filter(a => a.type === 'ghost');

    const itemHtml = (items, cls) => items.map(a => `
          <li style="margin-bottom:8px;line-height:1.5;">
            <span style="color:#333;">"${escapeHtml(a.text)}"</span>
            <span style="display:block;font-size:11px;color:#888;margin-top:2px;">${cls === 'ghost' ? '🤖 AI highlight' : '📝 Your highlight'}</span>
          </li>`).join('');

    const parts = [];
    if (userItems.length) {
        parts.push(`
      <h2 style="font-size:18px;margin:24px 0 8px;color:#444;">📝 Highlights &amp; Notes</h2>
      <ul style="margin:0;padding-left:20px;color:#333;">${itemHtml(userItems, 'user')}</ul>`);
    }
    if (ghostItems.length) {
        parts.push(`
      <h2 style="font-size:18px;margin:24px 0 8px;color:#444;">🤖 AI Suggested Highlights</h2>
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