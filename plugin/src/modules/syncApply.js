// modules/syncApply.js
// The other half of syncFields(): a merged flat field map ({ field: value }, see syncMerge.js) applied back onto this device's storage
// shape. Pure: it returns the new objects and never touches storage, so the engine can write them in one place.
//
//   article     { entry, rec } → { entry, rec }   fields of RECORD_SIDE go to the full record, the others to the lean index entry
//   highlight   annotation → annotation
//   collection  record → record                    (src:<articleId> elements become `sources`)
//   note        record → record                    (tag:<name> elements become `tags`)
//
// Only fields the merge knows about (`stamped`: the names in the merged record's `f`) are touched. A stamped field without a value was
// removed on the other device and is removed here; local-only fields and fields the merge says nothing about stay exactly as they are.
// The round trip holds: syncFields(type, apply(type, x, syncFields(type, y))) carries y's fields for every stamped name.
import { LOCAL_ONLY, RECORD_SIDE, TAG, SRC } from './syncStamps.js';

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

/** Update a set element by element: stamped names with a value are added or replaced, stamped names without one are removed, the rest stays. */
function mergeSet(current, names, values, prefix, keyOf) {
    const put = new Map(), drop = new Set();
    for (const n of names) { if (!n.startsWith(prefix)) continue; const k = n.slice(prefix.length); if (n in values && values[n] !== undefined && values[n] !== null) put.set(k, clone(values[n])); else drop.add(k); }
    const out = [];
    for (const v of current || []) { const k = keyOf(v); if (drop.has(k)) continue; if (put.has(k)) { out.push(put.get(k)); put.delete(k); } else out.push(v); }
    for (const v of put.values()) out.push(v);
    return out;
}
const tagKey = (t) => String(t || '').trim().toLowerCase();
const srcKey = (x) => (x && x.articleId) || '';

function setFields(target, names, values, deny) {
    for (const n of names) {
        if (deny.has(n) || n.startsWith(TAG) || n.startsWith(SRC)) continue;
        if (n in values && values[n] !== undefined) target[n] = clone(values[n]); else delete target[n];
    }
}
const stampedNames = (merged) => Object.keys((merged && merged.f) || {});
const touches = (names, prefix) => names.some((n) => n.startsWith(prefix));

/**
 * @param {'article'|'highlight'|'collection'|'note'} type
 * @param {object} current  article: { entry, rec } (either may be null); the others: the record or null
 * @param {{ f: object, values: object }} merged  the merged record from mergeRecord()
 * @param {{ compose?: (base: string, turns: any[]) => string, count?: (html: string) => number, id?: string }} [hooks]
 *   compose = the summary shown for a base text and its pinned questions (conversation.js withQuestions), count = word count
 */
export function applyFields(type, current, merged, hooks = {}) {
    const names = stampedNames(merged), values = (merged && merged.values) || {};
    const deny = new Set(LOCAL_ONLY[type] || []);

    if (type === 'highlight' || type === 'collection' || type === 'note') {
        const out = current ? clone(current) : {};
        if (hooks.id && !out.id) out.id = hooks.id;
        setFields(out, names, values, deny);
        if (type === 'collection' && touches(names, SRC)) out.sources = mergeSet(out.sources, names, values, SRC, srcKey);
        if (type === 'note' && touches(names, TAG)) out.tags = mergeSet(out.tags, names, values, TAG, tagKey);
        return out;
    }

    // article
    const entry = (current && current.entry) ? clone(current.entry) : {};
    let rec = (current && current.rec) ? clone(current.rec) : null;
    if (hooks.id && !entry.id) entry.id = hooks.id;
    const recNames = names.filter((n) => RECORD_SIDE.includes(n)), entryNames = names.filter((n) => !RECORD_SIDE.includes(n));
    setFields(entry, entryNames, values, deny);
    if (touches(names, TAG)) entry.tags = mergeSet(entry.tags, names, values, TAG, tagKey);

    if (recNames.length) {
        rec = rec || {};
        setFields(rec, recNames, values, new Set());   // LOCAL_ONLY lists these only so the plain copy in syncFields skips them
        if (rec.content !== undefined && recNames.includes('content')) {
            entry.contentWordCount = hooks.count ? hooks.count(rec.content) : entry.contentWordCount;
            delete entry.contentPruned; delete rec.contentPruned;   // the text is here now
        }
    }
    // the displayed summary is derived: the base plus the pinned questions, rebuilt on this device
    if (names.includes('summaryBase') || names.includes('conversation')) {
        const base = (rec && rec.summaryBase !== undefined) ? rec.summaryBase : (rec ? rec.summary : entry.summary) || '';
        const turns = (rec && Array.isArray(rec.conversation)) ? rec.conversation : [];
        const shown = hooks.compose ? hooks.compose(base, turns) : base;
        entry.summary = shown; if (rec) rec.summary = shown;
        if (hooks.count) entry.summaryWordCount = hooks.count(shown);
        if (turns.length) entry.qaCount = turns.length; else delete entry.qaCount;
    }
    if (entry.archived === undefined) entry.archived = false;
    return { entry, rec };
}
