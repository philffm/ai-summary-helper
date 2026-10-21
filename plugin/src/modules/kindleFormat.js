// kindleFormat.js — what the server attaches to the Send-to-Kindle mail (stored as `kindleFormat`).
// 'epub' is the default: Amazon reads it natively, the HTML path is converted on their side and can come out as a fixed-layout, PDF-like book.
export const KINDLE_FORMATS = ['epub', 'epub-images', 'html'];
export const normalizeKindleFormat = (v) => (KINDLE_FORMATS.includes(v) ? v : 'epub');
