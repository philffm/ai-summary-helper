package eu.byphil.aishcompanion.sync

import eu.byphil.aishcompanion.sync.SyncStamps.compareRev
import eu.byphil.aishcompanion.sync.SyncStamps.hashValue
import org.json.JSONArray
import org.json.JSONObject

/**
 * Merge of one record between this device and a remote copy: the Kotlin side of the extension's modules/syncMerge.js (same rules, so
 * every device converges). A record is { rev: { t, d }, f: { field: { t, h } }, values: { field: value }, deleted?: true }.
 */
object SyncMerge {
    class Result(val merged: JSONObject, val changedLocal: Boolean, val changedRemote: Boolean)

    private fun copy(o: JSONObject) = JSONObject(o.toString())
    private fun fieldRev(rec: JSONObject, name: String) = JSONObject().put("t", rec.optJSONObject("f")?.optJSONObject(name)?.optLong("t", 0) ?: 0).put("d", rec.optJSONObject("rev")?.optString("d", "") ?: "")
    private fun same(a: JSONObject, b: JSONObject): Boolean {
        fun key(r: JSONObject) = hashValue(listOf(r.opt("rev") ?: JSONObject.NULL, r.opt("f") ?: SyncStamps.Undefined, r.opt("values") ?: SyncStamps.Undefined, r.optBoolean("deleted", false)))
        return key(a) == key(b)
    }

    /** `local` may be null (not known here), `remote` too. */
    fun mergeRecord(local: JSONObject?, remote: JSONObject?): Result {
        if (local == null && remote == null) throw IllegalArgumentException("nothing to merge")
        if (local == null) return Result(copy(remote!!), changedLocal = true, changedRemote = false)
        if (remote == null) return Result(copy(local), changedLocal = false, changedRemote = true)

        val ld = local.optBoolean("deleted", false); val rd = remote.optBoolean("deleted", false)
        if (ld || rd) {
            val c = compareRev(local.optJSONObject("rev"), remote.optJSONObject("rev"))
            val winner = if (ld && rd) (if (c >= 0) local else remote) else if (c == 0) (if (ld) local else remote) else if (c > 0) local else remote
            val merged = copy(winner)
            fun diff(a: JSONObject, b: JSONObject) = a.optBoolean("deleted", false) != b.optBoolean("deleted", false) || compareRev(a.optJSONObject("rev"), b.optJSONObject("rev")) != 0
            return Result(merged, diff(merged, local), diff(merged, remote))
        }

        val lf = local.optJSONObject("f") ?: JSONObject(); val rf = remote.optJSONObject("f") ?: JSONObject()
        val names = LinkedHashSet<String>().apply { addAll(lf.keys().asSequence()); addAll(rf.keys().asSequence()) }
        val f = JSONObject(); val values = JSONObject()
        for (name in names) {
            val l = lf.optJSONObject(name); val r = rf.optJSONObject(name)
            val pickLocal = when {
                l != null && r == null -> true
                r != null && l == null -> false
                l!!.optString("h") == r!!.optString("h") -> true   // same value: nothing to decide
                else -> compareRev(fieldRev(local, name), fieldRev(remote, name)) >= 0
            }
            val src = if (pickLocal) local else remote
            f.put(name, copy(src.getJSONObject("f").getJSONObject(name)))
            val sv = src.optJSONObject("values")
            if (sv != null && sv.has(name) && sv.opt(name) != null) values.put(name, sv.opt(name))
            if (l != null && r != null && l.optString("h") == r.optString("h") && l.optLong("t") > r.optLong("t")) f.put(name, copy(r))   // converge on the earlier stamp for equal values
        }
        var top = 0L
        for (name in f.keys()) top = maxOf(top, f.getJSONObject(name).optLong("t", 0))
        val dev = (if (compareRev(local.optJSONObject("rev"), remote.optJSONObject("rev")) >= 0) local else remote).optJSONObject("rev")?.optString("d", "") ?: ""
        val merged = JSONObject().put("rev", JSONObject().put("t", top).put("d", dev)).put("f", f).put("values", values)
        return Result(merged, !same(merged, local), !same(merged, remote))
    }

    /** The elements of a set back out of a flat field map: { "tag:ai": "AI" } gives ["AI"]. */
    fun collectSet(values: JSONObject, prefix: String): JSONArray {
        val out = JSONArray()
        for (k in values.keys()) if (k.startsWith(prefix) && !values.isNull(k)) out.put(values.get(k))
        return out
    }
}
