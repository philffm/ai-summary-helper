package eu.byphil.aishcompanion

import android.content.Context
import org.json.JSONObject
import java.io.File

/** What the list needs, without parsing the whole article. */
data class ArticleMeta(val id: String, val title: String, val site: String, val url: String, val receivedAt: Long, val blocks: Int)

/**
 * Articles that arrived from the browser, in app-private storage (other apps cannot read it; it is removed when the app is
 * uninstalled). Each article is two small files named after the server's item id: <id>.json (the text) and <id>.meta (list data).
 */
class ArticleStore(context: Context) {
    private val dir = File(context.applicationContext.filesDir, "articles").apply { mkdirs() }
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
                .put("url", article.url).put("receivedAt", receivedAt).put("blocks", article.blocks.size).toString(),
        )
    }

    fun list(): List<ArticleMeta> =
        (dir.listFiles { f -> f.extension == "meta" } ?: emptyArray()).mapNotNull { f ->
            runCatching {
                val o = JSONObject(f.readText())
                ArticleMeta(o.getString("id"), o.getString("title"), o.optString("site"), o.getString("url"), o.optLong("receivedAt"), o.optInt("blocks"))
            }.getOrNull()
        }.sortedByDescending { it.receivedAt }

    fun load(id: String): Article? =
        if (!ID.matches(id)) null else runCatching { ArticleCodec.parse(File(dir, "$id.json").readText(), id) }.getOrNull()

    fun delete(id: String) {
        if (!ID.matches(id)) return
        File(dir, "$id.json").delete(); File(dir, "$id.meta").delete()
        prefs.edit().remove(id).apply()
    }

    fun isRead(id: String): Boolean = prefs.getBoolean(id, false)
    fun markRead(id: String) = prefs.edit().putBoolean(id, true).apply()
}
