// previewText.js — the plain-text preview of a summary (the cards on the Summarize screen).
// Headings ("Key points", "Context, evidence …") are labels, not text, and blocks are separated by a space: "Key pointsWhy …" is not a preview.
// An inert parse (no loads, no handlers), so entities and half tags from a restored or synced summary end up as text.

export function previewText(html, max = 100, doc = (typeof document !== 'undefined' ? document : null)) {
    const Parser = (doc && doc.defaultView && doc.defaultView.DOMParser) || (typeof DOMParser !== 'undefined' ? DOMParser : null);
    const body = new Parser().parseFromString(String(html || ''), 'text/html').body;
    body.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => h.remove());
    body.querySelectorAll('p, li, div, br, blockquote, tr').forEach((b) => b.append(' '));
    const text = (body.textContent || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? text.slice(0, max) + '…' : text;
}
