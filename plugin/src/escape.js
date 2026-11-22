// escape.js — the one place that escapes text for HTML and XML. A leaf module (no imports) so content scripts, the worker
// and the pages can all use it. Do not write another `.replace(/&/g, '&amp;')…`: the copies differed (some left quotes alone).

/** Escape text for safe interpolation into HTML (element content and quoted attributes). */
export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Escape text for XML (docx / odt parts): like escapeHtml, and drops the control characters XML 1.0 forbids. */
export function escapeXml(str) {
  return escapeHtml(str).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

/** Escape text for element content only (quotes stay readable): Anki fields, where the card shows the text as typed. */
export function escapeText(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
