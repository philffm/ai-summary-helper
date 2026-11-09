// modules/highlightMessages.js
// What the background worker does when a page's content script changes a highlight ({ action: 'hl:apply', ops }).
// Content scripts run in the website's origin and cannot take the extension's lock, so they never write highlights
// themselves. The page always comes from the tab the message arrived from, never from the message: a page can only change
// its own highlights. Sync-only operations (upsert, removeId) are not accepted from a page.
import { pageKeyForUrl } from './pageKey.js';

const HLM_OPS = new Set(['add', 'patch', 'remove', 'removeText', 'dismiss', 'clearPage']);
const HLM_MAX_OPS = 200;
const hlmStr = (v, n) => String(v == null ? '' : v).slice(0, n);
const hlmId = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(v) ? v : '');
const hlmQuote = (q) => (q && typeof q === 'object' && typeof q.exact === 'string'
  ? { exact: hlmStr(q.exact, 5000), prefix: hlmStr(q.prefix, 2000), suffix: hlmStr(q.suffix, 2000) } : undefined);

/** Only the fields a highlight has, with sane sizes; url is the sender's page. */
function hlmFields(src, page) {
  const out = { url: page };
  if (src.id !== undefined) { const id = hlmId(src.id); if (id) out.id = id; }
  if (src.text !== undefined) out.text = hlmStr(src.text, 5000);
  if (src.type !== undefined) out.type = src.type === 'ghost' ? 'ghost' : 'user';
  if (typeof src.timestamp === 'string') out.timestamp = hlmStr(src.timestamp, 40);
  const q = hlmQuote(src.quote); if (q) out.quote = q;
  if (typeof src.pos === 'number' && Number.isFinite(src.pos)) out.pos = src.pos;
  if (src.v === 1 || src.v === 2) out.v = src.v;
  return out;
}

/** The page key of the tab a message came from (web pages and local files), or ''. */
export function senderPage(sender) {
  const u = (sender && sender.tab && sender.tab.url) || '';
  return /^(https?|file):\/\//i.test(u) ? pageKeyForUrl(u) : '';
}

/** Checked ops for one page, or null when anything is malformed. */
export function cleanOps(ops, page) {
  if (!Array.isArray(ops) || !ops.length || ops.length > HLM_MAX_OPS) return null;
  const out = [];
  for (const o of ops) {
    if (!o || typeof o !== 'object' || !HLM_OPS.has(o.op)) return null;
    if (o.op === 'add') {
      if (!o.hl || typeof o.hl !== 'object') return null;
      const hl = hlmFields(o.hl, page);
      if (!hl.text || !hl.id) return null;
      out.push({ op: 'add', hl });
    } else if (o.op === 'patch') {
      if (!o.patch || typeof o.patch !== 'object') return null;
      const { url: _url, ...patch } = hlmFields(o.patch, page);
      const id = hlmId(o.id);
      if (id) out.push({ op: 'patch', page, id, patch });
      else if (typeof o.text === 'string') out.push({ op: 'patch', page, text: hlmStr(o.text, 5000), type: o.type === 'ghost' ? 'ghost' : 'user', patch });
      else return null;
    } else if (o.op === 'remove' || o.op === 'dismiss') {
      const id = hlmId(o.id); if (!id) return null;
      out.push({ op: o.op, page, id });
    } else if (o.op === 'removeText') {
      out.push({ op: 'removeText', page, text: hlmStr(o.text, 5000), type: o.type === 'ghost' ? 'ghost' : 'user' });
    } else {
      out.push({ op: 'clearPage', page });
    }
  }
  return out;
}

export function createHighlightMessages({ store, markDeleted = () => {} }) {
  return {
    /** → { ok, added, removed } or { ok: false, error } */
    async handle(msg, sender) {
      if (!msg || msg.action !== 'hl:apply') return { ok: false, error: 'unknown-action' };
      const page = senderPage(sender);
      if (!page) return { ok: false, error: 'no-page' };
      const ops = cleanOps(msg.ops, page);
      if (!ops) return { ok: false, error: 'bad-ops' };
      const res = await store.apply(ops);
      // a removed highlight gets a deletion marker for library sync (a dismissed one is kept, so it is not deleted)
      if (res.removed.length) { try { markDeleted(res.removed); } catch (_) { /* sync off */ } }
      return { ok: true, added: res.added, removed: res.removed };
    },
  };
}
