// modules/highlightRecords.js — the shape of one saved highlight, shared by the page script (bundled into content.js),
// the highlight store, the migration and the tests. Pure: no storage, no DOM.
//
// A highlight's `url` is its page key (pageKeyForUrl): origin + path + the query parameters that identify the content
// (YouTube ?v=, LinkedIn currentJobId, HN item?id=, …). Normalising must keep those parameters: cutting the whole query
// (as the page script did up to 2.2.44) moved highlights on such pages to a key no page has, and they disappeared.
import { pageKeyForUrl } from './pageKey.js';

const hlrClean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

/** One stored highlight in its canonical form, or null when it has no page or no text. */
export function normalizeHighlight(a, now = () => new Date().toISOString()) {
  if (!a || typeof a !== 'object') return null;
  const url = typeof a.url === 'string' && a.url ? pageKeyForUrl(a.url.split('#')[0]) : '';
  const text = hlrClean(a.text);
  if (!url || !text) return null;
  const out = { url, text, type: a.type === 'ghost' ? 'ghost' : 'user', timestamp: typeof a.timestamp === 'string' ? a.timestamp : now() };
  if (typeof a.id === 'string' && a.id) out.id = a.id;
  if (a.quote && typeof a.quote.exact === 'string') out.quote = { exact: a.quote.exact, prefix: a.quote.prefix || '', suffix: a.quote.suffix || '' };
  if (typeof a.pos === 'number') out.pos = a.pos;
  if (a.v) out.v = a.v;
  if (a.dismissed) out.dismissed = true;
  return out;
}

/**
 * Every stored shape → an array of canonical highlights. Accepts the current array and the old object shapes
 * ({ url: ['text', …] } and { url: { user: [...], ghost: [...] } }).
 */
export function normalizeHighlights(raw, now = () => new Date().toISOString()) {
  if (Array.isArray(raw)) return raw.map((a) => normalizeHighlight(a, now)).filter(Boolean);
  if (!raw || typeof raw !== 'object') return [];
  const out = [];
  for (const [urlKey, value] of Object.entries(raw)) {
    if (!urlKey || !value) continue;
    const push = (text, type, timestamp) => { const h = normalizeHighlight({ url: urlKey, text, type, timestamp }, now); if (h) out.push(h); };
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (typeof item === 'string') push(item, 'user');
        else if (item && typeof item === 'object') push(item.text, item.type, item.timestamp);
      });
    } else if (typeof value === 'object') {
      (Array.isArray(value.user) ? value.user : []).forEach((t) => { if (typeof t === 'string') push(t, 'user'); });
      (Array.isArray(value.ghost) ? value.ghost : []).forEach((t) => { if (typeof t === 'string') push(t, 'ghost'); });
    }
  }
  return out;
}

const HLR_FIELDS = ['url', 'text', 'type', 'timestamp', 'id', 'pos', 'v', 'dismissed'];
const hlrSameQuote = (a, b) => (!a && !b) || (!!a && !!b && a.exact === b.exact && (a.prefix || '') === (b.prefix || '') && (a.suffix || '') === (b.suffix || ''));

/** Same content, whatever the order of the fields. */
export function sameHighlight(a, b) {
  if (!a || !b) return a === b;
  return HLR_FIELDS.every((f) => a[f] === b[f]) && hlrSameQuote(a.quote, b.quote);
}

/**
 * Does the stored value need rewriting to be canonical? Only when it is an old shape, or an entry was dropped or changed.
 * Field order does not count (comparing JSON strings made almost every read rewrite the whole list).
 */
export function needsRewrite(raw, normalized) {
  if (!Array.isArray(raw)) return raw != null;
  if (raw.length !== normalized.length) return true;
  return raw.some((a, i) => !sameHighlight(a, normalized[i]));
}
