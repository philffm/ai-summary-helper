package eu.byphil.aishcompanion.sync

import org.json.JSONObject
import java.security.SecureRandom
import java.time.Instant

/** A note of this phone or of the browser. Dates are ISO strings, as in the browser. */
data class Note(val id: String, val text: String, val tags: List<String>, val created: String, val url: String = "", val title: String = "", val quote: String = "")

object NoteText {
    private val TAIL = Regex("(?:^|\\s)#([\\p{L}\\p{N}_-]{1,40})\\s*$")
    const val MAX_TEXT = 20_000; const val MAX_TAGS = 12
    /** Hashtags at the end of what was typed become tags: "Ask Anna #todo #inflation" → text + [todo, inflation]. Same rule as the browser's splitTags. */
    fun split(input: String): Pair<String, List<String>> {
        var text = input.trim(); val tags = ArrayList<String>()
        while (true) { val m = TAIL.find(text) ?: break; tags.add(0, m.groupValues[1]); text = text.substring(0, m.range.first).trim() }
        return text to tags
    }
}

/**
 * The phone's notes, kept as sync records ("note:<id>") so a note written offline is simply a record that the next run uploads. Notes of the
 * browser arrive as the same records. The phone writes its own notes only (the engine pushes the "note" type); highlights and comments from
 * the browser are not touched here.
 */
class NotesRepo(private val lib: LibrarySync, private val now: () -> Long = { System.currentTimeMillis() }) {
    private val records get() = lib.records

    private fun newId() = "n_" + java.lang.Long.toString(now(), 36) + ByteArray(4).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }.take(5)

    fun list(): List<Note> = records.keys("note:").mapNotNull { k -> records.get(k)?.let { SyncFields.noteOf(it) } }
        .filter { it.optString("kind", "note") == "note" && it.optString("text").isNotBlank() }
        .map { Note(it.optString("id"), it.optString("text"), (0 until it.getJSONArray("tags").length()).map { i -> it.getJSONArray("tags").getString(i) }.sortedBy { t -> t.lowercase() }, it.optString("created"),   // tags are a set: shown in a steady order
            it.optString("url"), it.optString("title"), it.optString("quote")) }
        .sortedByDescending { it.created }

    /** Adds a note; trailing #tags become tags. Returns it, or null for empty text. */
    fun add(raw: String, url: String = "", title: String = "", quote: String = ""): Note? {
        val (text, tags) = NoteText.split(raw); if (text.isEmpty()) return null
        val note = JSONObject().put("id", newId()).put("kind", "note").put("text", text.take(NoteText.MAX_TEXT)).put("created", Instant.ofEpochMilli(now()).toString())
        if (url.isNotBlank()) note.put("url", url.take(2048)); if (title.isNotBlank()) note.put("title", title.take(300)); if (quote.isNotBlank()) note.put("quote", quote.take(600))
        note.put("tags", org.json.JSONArray(tags.distinctBy { it.lowercase() }.take(NoteText.MAX_TAGS)))
        save(note); return list().firstOrNull { it.id == note.getString("id") }
    }

    /** Changes the text (and tags, from trailing #tags) of a note. An empty text is ignored: delete is a separate action. */
    fun update(id: String, raw: String): Boolean {
        val rec = records.get("note:$id") ?: return false
        val note = SyncFields.noteOf(rec) ?: return false
        val (text, tags) = NoteText.split(raw); if (text.isEmpty()) return false
        note.put("text", text.take(NoteText.MAX_TEXT)).put("tags", org.json.JSONArray(tags.distinctBy { it.lowercase() }.take(NoteText.MAX_TAGS)))
        save(note); return true
    }

    fun delete(id: String): Boolean {
        val rec = records.get("note:$id") ?: return false
        val clock = lib.clock()
        records.put("note:$id", SyncFields.tombstone(rec, clock, now()).record); lib.saveClock(clock); return true
    }

    private fun save(note: JSONObject) {
        val clock = lib.clock(); val key = "note:" + note.getString("id")
        records.put(key, SyncFields.stampRecord(records.get(key), SyncFields.noteFields(note), clock, now()).record); lib.saveClock(clock)
    }
}
