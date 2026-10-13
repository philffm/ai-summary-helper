package eu.byphil.aishcompanion

import android.content.Context
import org.json.JSONObject
import java.io.File

/** What the list needs, without parsing the whole article. */
data class ArticleMeta(val id: String, val title: String, val site: String, val url: String, val receivedAt: Long, val blocks: Int, val local: Boolean = false)

/**
 * Articles that arrived from the browser, in app-private storage (other apps cannot read it; it is removed when the app is
 * uninstalled). Each article is two small files named after the server's item id: <id>.json (the text) and <id>.meta (list data).
 */
class ArticleStore(context: Context) {
    private val dir = File(context.applicationContext.filesDir, "articles").apply { mkdirs() }
    private val trashDir = File(context.applicationContext.filesDir, "articles-trash").apply { mkdirs() }
    private val prefs = context.applicationContext.getSharedPreferences("aish-read", Context.MODE_PRIVATE)

    companion object {
        /** Item ids come from the server and become file names, so only plain id characters are accepted (no path tricks). */
        val ID = Regex("^[A-Za-z0-9_-]{1,64}$")
    }

    fun has(id: String): Boolean = ID.matches(id) && File(dir, "$id.json").exists()

    fun save(article: Article, json: String, receivedAt: Long) {
        require(ID.matches(article.id)) { "bad id" }
        File(dir, "${article.id}.json").writeText(json)
        File(dir, "${article.id}.meta").writeText(
            JSONObject().put("id", article.id).put("title", article.title.ifBlank { article.url }).put("site", article.site)
                .put("url", article.url).put("receivedAt", receivedAt).put("blocks", article.blocks.size).put("local", article.local).toString(),
        )
    }

    fun list(): List<ArticleMeta> =
        (dir.listFiles { f -> f.extension == "meta" } ?: emptyArray()).mapNotNull { f ->
            runCatching {
                val o = JSONObject(f.readText())
                ArticleMeta(o.getString("id"), o.getString("title"), o.optString("site"), o.getString("url"), o.optLong("receivedAt"), o.optInt("blocks"), o.optBoolean("local", false))
            }.getOrNull()
        }.sortedByDescending { it.receivedAt }

    fun load(id: String): Article? =
        if (!ID.matches(id)) null else runCatching { ArticleCodec.parse(File(dir, "$id.json").readText(), id) }.getOrNull()

    /** Stores a summary made on this phone for an article that already has its text (and the key passages as AI highlights). */
    fun setSummary(id: String, summary: String, passages: List<String> = emptyList()): Boolean {
        if (!ID.matches(id)) return false
        val f = File(dir, "$id.json")
        if (!f.exists()) return false
        return runCatching {
            val o = JSONObject(f.readText())
            o.put("summary", summary)
            if (passages.isNotEmpty()) {
                val hl = o.optJSONArray("hl") ?: org.json.JSONArray()
                val have = (0 until hl.length()).mapNotNull { hl.optJSONArray(it)?.optString(1) }.toSet()
                for (p in passages) if (p !in have) hl.put(org.json.JSONArray().put("g").put(p))
                o.put("hl", hl)
            }
            f.writeText(o.toString())
            true
        }.getOrDefault(false)
    }

    fun delete(id: String) {
        if (!ID.matches(id)) return
        File(dir, "$id.json").delete(); File(dir, "$id.meta").delete()
        prefs.edit().remove(id).remove("arch:$id").apply()
    }

    init { trashDir.listFiles()?.forEach { it.delete() } }   // a new process has no pending undo, so whatever is left in the bin is gone for good

    /** Takes the article out of the list but keeps it in a bin until [purge] or [restore] (for "Undo"). One level: a newer trash replaces nothing, ids are separate files. */
    fun trash(id: String): Boolean {
        if (!ID.matches(id) || !File(dir, "$id.json").exists()) return false
        File(dir, "$id.json").renameTo(File(trashDir, "$id.json")); File(dir, "$id.meta").renameTo(File(trashDir, "$id.meta"))
        return true
    }

    fun restore(id: String): Boolean {
        if (!ID.matches(id) || !File(trashDir, "$id.json").exists()) return false
        File(trashDir, "$id.json").renameTo(File(dir, "$id.json")); File(trashDir, "$id.meta").renameTo(File(dir, "$id.meta"))
        return true
    }

    /** Deletes a trashed article for good (and forgets that it was read). */
    fun purge(id: String) {
        if (!ID.matches(id)) return
        File(trashDir, "$id.json").delete(); File(trashDir, "$id.meta").delete()
        prefs.edit().remove(id).remove("arch:$id").apply()
    }

    /** Archived articles stay on the phone but leave the main list (shown under the Archive filter). Stored apart from the read flag. */
    fun isArchived(id: String): Boolean = prefs.getBoolean("arch:$id", false)
    fun setArchived(id: String, on: Boolean) {
        if (!ID.matches(id)) return
        prefs.edit().apply { if (on) putBoolean("arch:$id", true) else remove("arch:$id") }.apply()
    }

    fun isRead(id: String): Boolean = prefs.getBoolean(id, false)
    fun markRead(id: String) = prefs.edit().putBoolean(id, true).apply()
    fun markUnread(id: String) = prefs.edit().putBoolean(id, false).apply()
}
