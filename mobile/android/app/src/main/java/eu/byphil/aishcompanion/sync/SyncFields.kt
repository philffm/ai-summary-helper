package eu.byphil.aishcompanion.sync

import eu.byphil.aishcompanion.sync.SyncStamps.hashValue
import org.json.JSONObject

/** Local edits as stamped records: the Kotlin side of stampRecord / tombstone in the extension's modules/syncStamps.js. */
object SyncFields {
    const val TAG = "tag:"
    /** Fields of a note that are not synced as they are: `updated` is derived, tags are stamped one by one (tag:<name>). */
    private val NOTE_DENY = setOf("updated", "tags")

    /** The syncable fields of a note as { field: value } (tags become tag:<lower case name> elements, the first spelling wins). */
    fun noteFields(note: JSONObject): JSONObject {
        val out = JSONObject()
        for (k in note.keys()) if (k !in NOTE_DENY && !note.isNull(k)) out.put(k, note.get(k))
        val tags = note.optJSONArray("tags")
        if (tags != null) for (i in 0 until tags.length()) {
            val name = tags.optString(i).trim()
            if (name.isNotEmpty() && !out.has(TAG + name.lowercase())) out.put(TAG + name.lowercase(), name)
        }
        return out
    }

    /** A note back out of a record's values (what the screens show). */
    fun noteOf(rec: JSONObject): JSONObject? {
        if (rec.optBoolean("deleted", false)) return null
        val v = rec.optJSONObject("values") ?: return null
        val out = JSONObject(); val tags = org.json.JSONArray()
        for (k in v.keys()) if (k.startsWith(TAG)) tags.put(v.get(k)) else out.put(k, v.get(k))
        out.put("tags", tags)
        return out
    }

    class Stamped(val record: JSONObject, val changed: Boolean)

    /**
     * Stamp the fields of one record. Only a field whose hash changed gets a new stamp, so doing it twice changes nothing. A record with a
     * deletion marker stays dead unless `resurrect` is true (a real new edit, never a restore).
     */
    fun stampRecord(prev: JSONObject?, fields: JSONObject, clock: SyncClock, now: Long, resurrect: Boolean = false): Stamped {
        if (prev != null && prev.optBoolean("deleted", false) && !resurrect) return Stamped(prev, false)
        val f = if (prev != null && !prev.optBoolean("deleted", false)) JSONObject(prev.optJSONObject("f")?.toString() ?: "{}") else JSONObject()
        var changed = prev != null && prev.optBoolean("deleted", false)
        var t = 0L
        val names = LinkedHashSet<String>().apply { addAll(f.keys().asSequence()); addAll(fields.keys().asSequence()) }
        for (name in names) {
            val present = fields.has(name)
            val h = hashValue(if (present) fields.get(name) else SyncStamps.Undefined)
            val cur = f.optJSONObject(name)
            if (cur != null && cur.optString("h") == h) continue
            if (cur == null && !present) continue
            if (t == 0L) t = clock.tick(now)
            f.put(name, JSONObject().put("t", t).put("h", h)); changed = true
        }
        if (!changed) return Stamped(prev!!, false)
        var top = 0L; for (n in f.keys()) top = maxOf(top, f.getJSONObject(n).optLong("t"))
        return Stamped(JSONObject().put("rev", JSONObject().put("t", top).put("d", clock.device)).put("f", f).put("values", JSONObject(fields.toString())), true)
    }

    /** The explicit deletion marker: only the delete paths make one. */
    fun tombstone(prev: JSONObject?, clock: SyncClock, now: Long): Stamped {
        if (prev != null && prev.optBoolean("deleted", false)) return Stamped(prev, false)
        return Stamped(JSONObject().put("rev", JSONObject().put("t", clock.tick(now)).put("d", clock.device)).put("f", JSONObject()).put("deleted", true), true)
    }
}
