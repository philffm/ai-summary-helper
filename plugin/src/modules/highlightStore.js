// modules/highlightStore.js — the one place that writes highlights (claude/dev-brief-highlights-per-page.md).
//
// Storage (schema 2): one key per page, hl:page:<pageKey> → [highlight, …], plus a lean index hl:index → [{ k, n, d, t }]
// (page key, active count, dismissed count, last change). Before the migration has run (hl:schema ≠ 2) the store reads and
// writes the old single list hl:all instead, so callers can move over one by one and the migration is switched on last.
//
// Every change runs under one Web Lock ('aish-hl'), shared by the background worker and all extension pages (same origin).
// Page scripts run in the website's origin and cannot take that lock: they send { action: 'hl:apply' } to the background.
//
//   forPage(pageKey)          → highlights of one page (dismissed ones included)
//   all({ dismissed })        → every highlight (dismissed ones only when asked)
//   index()                   → [{ k, n, d, t }]
//   apply(ops)                → { added: [ids], removed: [ids], changed }
//
// ops: { op: 'add', hl }                         new highlight (skipped when the same one exists, see isDuplicate)
//      { op: 'patch', page, id?, text?, type?, patch }   change fields of one highlight (by id, else by text + type)
//      { op: 'remove', page, id }   { op: 'removeText', page, text, type }   { op: 'clearPage', page }
//      { op: 'dismiss', page, id }                kept as dismissed: an AI highlight the user rejected never comes back
//      { op: 'upsert', hl }                       sync: replace by id, or add
//      { op: 'removeId', id }                     sync: remove wherever it is
//      { op: 'merge', id, fn }                    sync: fn(current | null) → record to keep, or null to remove (inside the lock)
import { SK, hlPageKey, articleRecKey } from './storageKeys.js';
import { withLock } from './articleLock.js';
import { normalizeHighlight, normalizeHighlights } from './highlightRecords.js';
import { pageKeyForUrl } from './pageKey.js';
import { hashValue } from './syncStamps.js';

export const HL_SCHEMA = 2;
const HL_LOCK = 'aish-hl';
const HL_CHUNK = 25;
// storage may answer by callback (chrome.*, Safari, tests) or by promise (browser.*, the MCP worker's injected reader): accept both
const hlsCall = (storage, fn, arg) => new Promise((resolve, reject) => {
  let settled = false;
  const done = (v) => { if (!settled) { settled = true; resolve(v); } };
  try {
    const r = storage[fn](arg, done);
    if (r && typeof r.then === 'function') r.then(done, reject);
  } catch (e) { reject(e); }
});
const hlsGet = async (storage, keys) => (await hlsCall(storage, 'get', keys)) || {};
const hlsSet = (storage, obj) => hlsCall(storage, 'set', obj);
const hlsRm = (storage, keys) => hlsCall(storage, 'remove', keys).catch(() => {});
const hlsList = (v) => (Array.isArray(v) ? v : []);
// stored records as they are (sync compares them field by field); only the old object shapes are converted
const hlsRecords = (v) => (Array.isArray(v) ? v.filter((h) => h && typeof h === 'object' && typeof h.url === 'string' && typeof h.text === 'string') : normalizeHighlights(v));
const hlsNow = () => new Date().toISOString();
const hlsCtx = (q) => (q ? `${q.prefix || ''}\u0000${q.suffix || ''}` : '');

/** The same highlight already stored? Same id; or same page, text and type in the same context. AI highlights: same text is enough (also when dismissed). */
export function isDuplicate(list, hl) {
  return list.some((a) => (hl.id && a.id === hl.id)
    || (a.url === hl.url && a.text === hl.text && a.type === hl.type && (hl.type === 'ghost' || hlsCtx(a.quote) === hlsCtx(hl.quote))));
}

/** Index row for one page's list. */
export function indexRow(k, list, t = hlsNow()) {
  return { k, n: list.filter((h) => !h.dismissed).length, d: list.filter((h) => h.dismissed).length, t };
}

/** Apply ops to an in-memory list of one page (or of everything, in the old single-list mode). Returns what changed. */
export function applyToList(list, ops, out = { added: [], removed: [], changed: false }) {
  for (const o of ops) {
    if (!o || typeof o !== 'object') continue;
    if (o.op === 'add' || o.op === 'upsert') {
      const hl = normalizeHighlight(o.hl);
      if (!hl) continue;
      if (o.op === 'upsert' && hl.id) {
        const at = list.findIndex((a) => a.id === hl.id);
        if (at >= 0) { list[at] = hl; out.changed = true; continue; }
      } else if (isDuplicate(list, hl)) continue;
      list.push(hl); out.changed = true;
      if (hl.id) out.added.push(hl.id);
    } else if (o.op === 'patch') {
      const a = list.find((x) => (o.id ? x.id === o.id : x.url === o.page && x.text === o.text && x.type === (o.type || 'user')));
      if (!a || !o.patch || typeof o.patch !== 'object') continue;
      const next = normalizeHighlight({ ...a, ...o.patch, url: a.url });
      if (!next) continue;
      Object.keys(a).forEach((k) => delete a[k]); Object.assign(a, next); out.changed = true;
    } else if (o.op === 'merge') {
      // sync: fn(current copy | null) → the record to keep, or null to remove it; runs inside the lock, so nothing written meanwhile is lost
      if (typeof o.fn !== 'function') continue;
      const at = list.findIndex((a) => a.id === o.id);
      const next = o.fn(at >= 0 ? JSON.parse(JSON.stringify(list[at])) : null);
      if (next == null) { if (at >= 0) { out.removed.push(list[at].id); list.splice(at, 1); out.changed = true; } continue; }
      const hl = normalizeHighlight({ ...next, id: o.id });
      if (!hl) continue;
      if (at >= 0) list[at] = hl; else { list.push(hl); out.added.push(hl.id); }
      out.changed = true;
    } else if (o.op === 'dismiss') {
      const a = list.find((x) => x.id === o.id);
      if (a && !a.dismissed) { a.dismissed = true; out.changed = true; }
    } else {
      const drop = o.op === 'remove' || o.op === 'removeId' ? (a) => a.id === o.id
        : o.op === 'removeText' ? (a) => a.url === o.page && a.text === String(o.text || '').replace(/\s+/g, ' ').trim() && a.type === (o.type || 'user')
          : o.op === 'clearPage' ? (a) => a.url === o.page : null;
      if (!drop) continue;
      for (let i = list.length - 1; i >= 0; i--) {
        if (drop(list[i])) { if (list[i].id) out.removed.push(list[i].id); list.splice(i, 1); out.changed = true; }
      }
    }
  }
  return out;
}

/** The page an op belongs to (null: it needs every page — removeId and merge only know the id). */
function opPage(o) {
  if (o.op === 'add' || o.op === 'upsert') { const h = normalizeHighlight(o.hl); return h ? h.url : undefined; }
  if (o.op === 'removeId' || o.op === 'merge') return null;
  return typeof o.page === 'string' && o.page ? o.page : undefined;
}

export function createHighlightStore({ storage }) {
  const schema = async () => (await hlsGet(storage, { [SK.hlSchema]: 0 }))[SK.hlSchema] === HL_SCHEMA;

  async function legacyList() {
    return hlsRecords((await hlsGet(storage, [SK.annotations]))[SK.annotations]);
  }

  async function index() {
    if (!(await schema())) {
      const by = new Map();
      for (const h of await legacyList()) { if (!by.has(h.url)) by.set(h.url, []); by.get(h.url).push(h); }
      return [...by].map(([k, l]) => indexRow(k, l, ''));
    }
    return hlsList((await hlsGet(storage, { [SK.hlIndex]: [] }))[SK.hlIndex]);
  }

  async function forPage(pageKey) {
    if (!pageKey) return [];
    if (!(await schema())) return (await legacyList()).filter((h) => h.url === pageKey);
    const k = hlPageKey(pageKey);
    return hlsRecords((await hlsGet(storage, [k]))[k]);
  }

  async function readPages(keys) {
    const out = new Map();
    for (let i = 0; i < keys.length; i += HL_CHUNK) {
      const part = keys.slice(i, i + HL_CHUNK);
      const got = await hlsGet(storage, part.map(hlPageKey));
      for (const k of part) out.set(k, hlsRecords(got[hlPageKey(k)]));
    }
    return out;
  }

  async function all({ dismissed = false } = {}) {
    let list;
    if (!(await schema())) list = await legacyList();
    else list = [...(await readPages((await index()).map((r) => r.k))).values()].flat();
    return dismissed ? list : list.filter((h) => !h.dismissed);
  }

  /** Write changed pages and the index (pages left empty are removed). Caller holds the lock. */
  async function writePages(pages, idx) {
    const writes = {}, drops = [];
    const rows = new Map(idx.map((r) => [r.k, r]));
    for (const [k, list] of pages) {
      if (list.length) { writes[hlPageKey(k)] = list; rows.set(k, indexRow(k, list)); } else { drops.push(hlPageKey(k)); rows.delete(k); }
    }
    const keys = Object.keys(writes);
    for (let i = 0; i < keys.length; i += HL_CHUNK) await hlsSet(storage, Object.fromEntries(keys.slice(i, i + HL_CHUNK).map((k) => [k, writes[k]])));
    await hlsSet(storage, { [SK.hlIndex]: [...rows.values()] });
    if (drops.length) await hlsRm(storage, drops);
  }

  function apply(ops) {
    const list = hlsList(ops);
    if (!list.length) return Promise.resolve({ added: [], removed: [], changed: false });
    return withLock(HL_LOCK, async () => {
      if (!(await schema())) {
        const all = hlsRecords((await hlsGet(storage, [SK.annotations]))[SK.annotations]);
        const out = applyToList(all, list);
        if (out.changed) await hlsSet(storage, { [SK.annotations]: all });
        return out;
      }
      const idx = hlsList((await hlsGet(storage, { [SK.hlIndex]: [] }))[SK.hlIndex]);
      const own = [...new Set(list.map(opPage).filter(Boolean))];
      if (list.some((o) => opPage(o) === null)) {
        // ops that only know an id (sync): work on every page at once, then write back the pages that changed
        const pages = await readPages([...new Set([...idx.map((r) => r.k), ...own])]);
        const before = new Map([...pages].map(([k, l]) => [k, JSON.stringify(l)]));
        const combined = [...pages.values()].flat();
        const out = applyToList(combined, list);
        if (!out.changed) return out;
        const after = new Map([...before.keys()].map((k) => [k, []]));
        for (const h of combined) { if (!after.has(h.url)) after.set(h.url, []); after.get(h.url).push(h); }
        const touched = new Map([...after].filter(([k, l]) => JSON.stringify(l) !== (before.get(k) || '[]')));
        if (touched.size) await writePages(touched, idx);
        return out;
      }
      const pages = await readPages(own);
      const out = { added: [], removed: [], changed: false };
      const touched = new Map();
      for (const o of list) {
        const k = opPage(o);
        if (!k) continue;
        const was = out.changed; out.changed = false;
        applyToList(pages.get(k), [o], out);
        if (out.changed) touched.set(k, pages.get(k));
        out.changed = was || out.changed;
      }
      if (touched.size) await writePages(touched, idx);
      return out;
    });
  }

  /**
   * hl:all → hl:page:<pageKey> + hl:index (schema 2). Safe to run again: pages already there are merged by id, and the old
   * list is removed only after everything is written. Runs again when hl:all shows up later (an old backup, an old build).
   * Highlights whose page key lost its content parameter (?v=, ?id=, … cut by the page script up to 2.2.44) are moved back
   * to the one saved article on that path whose text contains them; when there is no such article or more than one, they stay.
   */
  function migrate() {
    return withLock(HL_LOCK, async () => {
      const d = await hlsGet(storage, { [SK.hlSchema]: 0 });
      const rawAll = (await hlsGet(storage, [SK.annotations]))[SK.annotations];
      if (d[SK.hlSchema] === HL_SCHEMA && rawAll === undefined) return { ran: false };
      const res = { ran: true, highlights: 0, pages: 0, ids: 0, repaired: 0, unrepaired: 0 };
      // ids for old highlights: the same derivation as the sync backfill, so every device makes the same id
      const raw = Array.isArray(rawAll) ? rawAll.map((h) => {
        if (!h || typeof h !== 'object' || h.id || !h.url || !h.text) return h;
        res.ids++;
        return { ...h, id: 'hl_l' + hashValue([h.url, h.text, h.type || 'user', h.timestamp || '']) };
      }) : rawAll;
      const list = normalizeHighlights(raw);
      const rep = await repairCutKeys(list);
      res.repaired = rep.repaired; res.unrepaired = rep.unrepaired;
      const by = new Map();
      for (const h of list) { if (!by.has(h.url)) by.set(h.url, []); by.get(h.url).push(h); }
      const idx = hlsList((await hlsGet(storage, { [SK.hlIndex]: [] }))[SK.hlIndex]);   // also after a run that stopped half-way
      const existing = await readPages([...by.keys()]);
      const pages = new Map();
      for (const [k, incoming] of by) {
        const merged = existing.get(k) || [];
        for (const h of incoming) {
          const at = h.id ? merged.findIndex((a) => a.id === h.id) : -1;
          if (at >= 0) { if (String(h.timestamp) > String(merged[at].timestamp)) merged[at] = h; } else if (!isDuplicate(merged, h)) merged.push(h);
        }
        pages.set(k, merged);
      }
      if (pages.size) await writePages(pages, idx);
      else await hlsSet(storage, { [SK.hlIndex]: idx });
      await hlsSet(storage, { [SK.hlSchema]: HL_SCHEMA });
      await hlsRm(storage, [SK.annotations]);
      res.highlights = list.length; res.pages = pages.size;
      return res;
    });
  }

  /** Move highlights whose key lost its content parameter back to the one matching article. Changes `list` in place. */
  async function repairCutKeys(list) {
    const out = { repaired: 0, unrepaired: 0 };
    const cut = list.filter((h) => !h.url.includes('?'));
    if (!cut.length) return out;
    const articles = hlsList((await hlsGet(storage, { [SK.articlesIndex]: [] }))[SK.articlesIndex]).filter((a) => a && a.id && typeof a.url === 'string');
    const withParam = new Map();   // path key → [{ id, key }] of articles whose page key has a content parameter
    for (const a of articles) {
      const key = pageKeyForUrl(a.url);
      const q = key.indexOf('?');
      if (q < 0) continue;
      const base = key.slice(0, q);
      if (!withParam.has(base)) withParam.set(base, []);
      withParam.get(base).push({ id: a.id, key });
    }
    const texts = new Map();
    const textOf = async (id) => {
      if (!texts.has(id)) {
        const rec = (await hlsGet(storage, [articleRecKey(id)]))[articleRecKey(id)] || {};
        const html = String(rec.content || '') + ' ' + String(rec.summary || '');
        texts.set(id, html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' '));
      }
      return texts.get(id);
    };
    for (const h of cut) {
      const cands = withParam.get(h.url);
      if (!cands) continue;
      const hits = [];
      for (const c of cands) if ((await textOf(c.id)).includes(h.text)) hits.push(c);
      if (hits.length === 1) { h.url = hits[0].key; out.repaired++; } else out.unrepaired++;
    }
    return out;
  }

  return { schema, index, forPage, all, apply, migrate, legacyList, readPages, writePages };
}

