// modules/syncStamps.js
// Revision stamps for library sync (see .briefs/prd-library-sync.md, .briefs/library-sync-write-audit.md section 6).
// Pure: no storage, no network, no DOM, no clock of its own (the caller passes `now`), so the same rules can run in the
// background worker, the tests and the phone apps.
//
// A sidecar entry per record:  { rev: { t, d }, f: { <field>: { t, h } }, deleted?: true }
//   t  hybrid logical clock value (ms, never below the highest stamp the device has seen)
//   d  device id (tie-break)
//   h  hash of the field's current value: a field is stamped ONLY when its hash changes, so stamping is idempotent. It
//      can run from storage events and from a full scan, and a record pulled from the remote (written with matching
//      hashes) is never re-stamped.
//
// Rules this module enforces:
//   • a record that is missing from storage is NOT a deletion: tombstones come only from tombstone(), called by the
//     explicit delete paths. Space pruning, reset and restore therefore never reach the remote;
//   • fields that are local, derived or per device are never stamped (LOCAL_ONLY);
//   • the full text of a pruned record is "unknown", not "empty".

/** Fields that never sync. Everything else is user data (deny-list: a new field is synced rather than silently lost). */
export const LOCAL_ONLY = {
    article: ['lastOpened', 'sentTo', 'qaCount', 'contentWordCount', 'summaryWordCount', 'favicon', 'moodScore', 'fromPhone',
        'contentPruned', 'feedStub', 'summary', 'suggested', 'suggestedAnswers', 'summaryBase', 'conversation', 'content'],
    highlight: [],
    collection: ['updated'],
};

// ── hashing ──────────────────────────────────────────────────────────────

function canonical(v) {
    if (v === undefined) return 'u';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

/** 53-bit string hash (cyrb53) of the canonical JSON of a value: key order does not matter. Change detection, not security. */
export function hashValue(v) {
    const s = canonical(v);
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 2654435761);
        h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// ── clock ────────────────────────────────────────────────────────────────

/** A new stamp time: the wall clock, but always above everything this device has stamped or seen. Mutates `clock` ({ t }). */
export function tick(clock, now) {
    clock.t = Math.max(Number(now) || 0, (clock.t || 0) + 1);
    return clock.t;
}

/** Remember a stamp that arrived from another device, so the next local stamp is above it. */
export function observe(clock, t) {
    if (Number.isFinite(t) && t > (clock.t || 0)) clock.t = t;
}

/** Order two record stamps { t, d }: negative when a is older. */
export function compareRev(a, b) {
    const x = a || { t: 0, d: '' }, y = b || { t: 0, d: '' };
    return x.t !== y.t ? x.t - y.t : (x.d < y.d ? -1 : x.d > y.d ? 1 : 0);
}

// ── what is synced ───────────────────────────────────────────────────────

/**
 * The syncable fields of one record as a flat { field: value } object.
 *   article    entry = lean index entry, rec = the full record (or null)
 *   highlight  entry = the annotation
 *   collection entry = the collection record
 * Derived data is rebuilt from its parts: the effective summary base and the pinned conversation sync, the displayed
 * `summary` (base + pinned questions) is recomputed on the receiving device.
 */
export function syncFields(type, entry, rec) {
    const deny = new Set(LOCAL_ONLY[type] || []);
    const out = {};
    const take = (obj) => { for (const [k, v] of Object.entries(obj || {})) if (!deny.has(k) && v !== undefined) out[k] = v; };
    take(entry);
    if (type !== 'article') return out;
    const r = rec || {};
    take(r);
    const base = r.summaryBase !== undefined ? r.summaryBase : (r.summary !== undefined ? r.summary : (entry && entry.summary));
    if (base !== undefined) out.summaryBase = base;
    if (Array.isArray(r.conversation) && r.conversation.length) out.conversation = r.conversation;
    if (!textUnknown(entry, r)) out.content = r.content;
    return out;
}

// Pruned or empty text means "not on this device", never "deleted here".
const textUnknown = (entry, r) => !(typeof r.content === 'string' && r.content) || !!(entry && entry.contentPruned) || !!r.contentPruned;

/** Fields whose absence says nothing (stampRecord must neither stamp nor clear them). Pass the result as `skip`. */
export function unknownFields(type, entry, rec) {
    return type === 'article' && textUnknown(entry, rec || {}) ? ['content'] : [];
}

// ── stamping ─────────────────────────────────────────────────────────────

/**
 * Stamp one record. `prev` is its sidecar entry (or undefined), `fields` the result of syncFields().
 * Returns { entry, changed }. Nothing changes (and the same object content is returned) when every hash matches.
 * A record with a tombstone stays dead unless `opts.resurrect` is true (a real new save or edit, never a restore).
 */
export function stampRecord(prev, fields, { clock, now, device, resurrect = false, skip = [] }) {
    if (prev && prev.deleted && !resurrect) return { entry: prev, changed: false };
    const f = { ...((prev && !prev.deleted && prev.f) || {}) };
    let changed = !!(prev && prev.deleted);
    let t = 0;
    const names = new Set([...Object.keys(f), ...Object.keys(fields || {})]);
    for (const name of names) {
        if (skip.includes(name)) continue;   // unknown here: keep whatever stamp it has
        const h = hashValue((fields || {})[name]);
        if (f[name] && f[name].h === h) continue;
        if (!f[name] && (fields || {})[name] === undefined) continue;   // never set, still not set
        if (!t) t = tick(clock, now);
        f[name] = { t, h };
        changed = true;
    }
    if (!changed) return { entry: prev, changed: false };
    const top = Math.max(0, ...Object.values(f).map((x) => x.t));
    return { entry: { rev: { t: top, d: device }, f }, changed: true };
}

/** The explicit deletion marker. Only the delete paths call this. */
export function tombstone(prev, { clock, now, device }) {
    if (prev && prev.deleted) return { entry: prev, changed: false };
    return { entry: { rev: { t: tick(clock, now), d: device }, f: {}, deleted: true }, changed: true };
}

/**
 * Full scan: stamp every current record against the sidecar. `records` is { id: { fields, skip? } }. Never creates a tombstone.
 * Returns { stamps, changedIds }. Running it twice, or after the event path already stamped, changes nothing.
 */
export function scan(stamps, records, ctx) {
    const next = { ...(stamps || {}) };
    const changedIds = [];
    for (const [id, rec] of Object.entries(records || {})) {
        const r = stampRecord(next[id], rec.fields, { ...ctx, skip: rec.skip || [] });
        if (r.changed) { next[id] = r.entry; changedIds.push(id); }
    }
    return { stamps: next, changedIds };
}

/** Records that have a live stamp but no data now (pruned away, reset, restored from an older backup): the engine asks, it does not delete. */
export function orphans(stamps, presentIds) {
    const here = presentIds instanceof Set ? presentIds : new Set(presentIds || []);
    return Object.entries(stamps || {}).filter(([id, e]) => e && !e.deleted && !here.has(id)).map(([id]) => id);
}
