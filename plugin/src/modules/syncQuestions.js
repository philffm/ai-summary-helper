// modules/syncQuestions.js
// The questions asked about an article (record field `conversation`) are a list that only grows. The sync merges a record field by
// field, so two devices that each asked something would end up with one side's list. This step, taken after that merge, keeps both:
// every question of either side, and for a question both hold the version of the side that won the field.
//
// Nothing about the files changes. The combined list is stamped like a fresh edit, so devices that know nothing of this step (older
// versions, the phone apps, KOReader) simply take it over. An older version can still drop a question until it is updated; a device
// that holds it brings it back at its next sync. There is no way to delete a single question; one that is added needs a marker here.
import { hashValue } from './syncStamps.js';

const turns = (record) => (record && record.values && Array.isArray(record.values.conversation) ? record.values.conversation : []);
const order = (a, b) => String(a.ts || '').localeCompare(String(b.ts || '')) || String(a.id).localeCompare(String(b.id));

/**
 * `result`: what mergeRecord(local, remote) answered. → the same, or one whose list holds both sides' questions.
 * `device`: this device's id, `now`: the time, for the stamp of a list that is new to both sides.
 */
export function keepAllQuestions(local, remote, result, { device, now }) {
    const merged = result.merged;
    if (!local || !remote || local.deleted || remote.deleted || !merged || merged.deleted || !merged.f.conversation) return result;
    const kept = turns(merged), ids = new Set(kept.map((t) => t && t.id));
    const more = [];
    for (const turn of [...turns(local), ...turns(remote)]) {
        if (turn && turn.id && !ids.has(turn.id)) { ids.add(turn.id); more.push(turn); }
    }
    if (!more.length) return result;
    const conversation = [...kept, ...more].sort(order);
    const t = Math.max(now, (local.rev && local.rev.t) + 1 || 0, (remote.rev && remote.rev.t) + 1 || 0);
    const next = { ...merged, rev: { t, d: device || merged.rev.d }, f: { ...merged.f, conversation: { t, h: hashValue(conversation) } }, values: { ...merged.values, conversation } };
    return { merged: next, changedLocal: true, changedRemote: true };
}
