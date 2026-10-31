// modules/syncMerge.js
// Merge of one record between this device and a remote copy. Pure.
// A record: { rev: { t, d }, f: { field: { t, h } }, values: { field: value }, deleted?: true }
// `f` holds the stamp of every field, `values` the field values (a field with a stamp and no value is a removed element).
//
// Rules (every device applies the same ones, so all converge):
//   • per field the larger stamp wins; equal times break on the device id of the side the record came from;
//   • a tombstone beats an edit with a smaller or equal revision; an edit with a larger revision brings the record back;
//   • `excluded` is not a deletion: it is only a hint for readable places and is ignored here.
import { compareRev } from './syncStamps.js';

const fieldRev = (rec, name) => ({ t: (rec.f && rec.f[name] && rec.f[name].t) || 0, d: (rec.rev && rec.rev.d) || '' });

/** → { merged, changedLocal, changedRemote }. `local` may be null (unknown here). */
export function mergeRecord(local, remote) {
    if (!local) return { merged: clone(remote), changedLocal: true, changedRemote: false };
    if (!remote) return { merged: clone(local), changedLocal: false, changedRemote: true };

    if (local.deleted || remote.deleted) {
        const c = compareRev(local.rev, remote.rev);
        // both deleted: the same winner on every device (the later stamp, ties on the device id), so two devices that deleted the same record agree and stop rewriting each other's marker
        const winner = local.deleted && remote.deleted ? (c >= 0 ? local : remote) : (c === 0 ? (local.deleted ? local : remote) : (c > 0 ? local : remote));
        const merged = clone(winner);
        const diff = (a, b) => !!a.deleted !== !!b.deleted || compareRev(a.rev, b.rev) !== 0;
        return { merged, changedLocal: diff(merged, local), changedRemote: diff(merged, remote) };
    }

    const f = {}, values = {};
    for (const name of new Set([...Object.keys(local.f || {}), ...Object.keys(remote.f || {})])) {
        const l = local.f && local.f[name], r = remote.f && remote.f[name];
        let pick = null;
        if (l && !r) pick = 'local'; else if (r && !l) pick = 'remote';
        else if (l.h === r.h) pick = 'local';   // same value: nothing to decide (keep the older stamp, it was there first)
        else pick = compareRev(fieldRev(local, name), fieldRev(remote, name)) >= 0 ? 'local' : 'remote';
        const src = pick === 'local' ? local : remote;
        f[name] = { ...src.f[name] };
        if (src.values && name in src.values && src.values[name] !== undefined) values[name] = src.values[name];
        if (l && r && l.h === r.h && local.f[name].t > remote.f[name].t) f[name] = { ...remote.f[name] };   // converge on the earlier stamp for equal values
    }
    const top = Math.max(0, ...Object.values(f).map((x) => x.t));
    const dev = (compareRev(local.rev, remote.rev) >= 0 ? local : remote).rev.d;
    const merged = { rev: { t: top, d: dev }, f, values };
    return { merged, changedLocal: !same(merged, local), changedRemote: !same(merged, remote) };
}

const clone = (x) => JSON.parse(JSON.stringify(x));
const same = (a, b) => JSON.stringify([a.rev, a.f, a.values, !!a.deleted]) === JSON.stringify([b.rev, b.f, b.values, !!b.deleted]);
