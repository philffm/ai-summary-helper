package eu.byphil.aishcompanion

import eu.byphil.aishcompanion.sync.RecordStore
import eu.byphil.aishcompanion.sync.SyncClock
import eu.byphil.aishcompanion.sync.SyncFields
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.time.Instant

/** What the uploader needs to know about one article on this phone. */
data class PhoneArticle(
    val id: String, val url: String, val title: String, val at: Long, val blocks: List<Pair<String, String>>, val summary: String,
    val userHighlights: List<String>, val local: Boolean, val aid: String,
)

/** The articles of the reading list, without tying the uploader to the Android file store. */
interface PhoneArticles { fun all(): List<PhoneArticle> }

class StorePhoneArticles(private val store: ArticleStore) : PhoneArticles {
    override fun all(): List<PhoneArticle> = store.list().mapNotNull { m ->
        val a = store.load(m.id) ?: return@mapNotNull null
        PhoneArticle(m.id, a.url, a.title, m.receivedAt, a.blocks.map { it.type to it.text }, a.summary, store.userHighlights(m.id), m.local, a.aid)
    }
}

/**
 * Sends what was saved on this phone to the library, so it is in the browser too:
 *  • an article this phone summarized itself (not sent from the browser) becomes an "article:ph_<id>" record, as clean HTML, but ONLY when the library
 *    does not hold that page yet (same page = same address, ignoring tracking parameters, www, # and a trailing slash). A page the browser has keeps
 *    the browser's text; nothing here replaces it.
 *  • the passages marked on this phone become "hl:ph_<hash>" records for their page (new ones are added, one unmarked here gets a deletion marker).
 * Records that came from the browser are never written, and what was made here is remembered (id → key), so nothing is made twice, the reading list
 * does not receive its own articles back, and the same article is never uploaded under two keys.
 */
class PhoneUploader(private val records: RecordStore, private val now: () -> Long, private val stateFile: File) {
    class Result(var articles: Int = 0, var highlights: Int = 0, var removed: Int = 0)

    private fun loadState() = runCatching { JSONObject(stateFile.readText()) }.getOrDefault(JSONObject())
    /** The keys of every record this phone made (the engine may upload them; the reading list must not turn them into articles again). */
    fun ownKeys(): Set<String> {
        val s = loadState(); val out = HashSet<String>()
        s.optJSONObject("articles")?.let { a -> for (k in a.keys()) out.add(a.getString(k)) }
        s.optJSONArray("hl")?.let { h -> for (i in 0 until h.length()) out.add(h.getString(i)) }
        return out
    }

    /** [c] is the clock of the sync run in progress, so every stamp made here is above the ones seen in it and below the ones that follow. */
    fun run(source: PhoneArticles, c: SyncClock): Result {
        val out = Result(); val state = loadState()
        val upArticles = state.optJSONObject("articles") ?: JSONObject()
        val oldHl = HashSet<String>().apply { state.optJSONArray("hl")?.let { h -> for (i in 0 until h.length()) add(h.getString(i)) } }
        val own = ownKeys()
        // the pages the library already holds (records that came from the browser, not the ones made here)
        val library = HashSet<String>()
        for (k in records.keys("article:")) {
            if (k in own) continue
            val rec = records.get(k) ?: continue
            if (rec.optBoolean("deleted", false)) continue
            val key = ArticleIdentity.key(rec.optJSONObject("values")?.optString("url").orEmpty()); if (key.isNotEmpty()) library.add(key)
        }
        val desiredHl = LinkedHashSet<String>()
        fun put(key: String, fields: JSONObject): Boolean {
            val r = SyncFields.stampRecord(records.get(key), fields, c, now()); if (r.changed) records.put(key, r.record); return r.changed
        }
        for (a in source.all()) {
            val pageKey = ArticleIdentity.key(a.url)
            val inLibrary = (a.aid.isNotEmpty() && records.get("article:" + a.aid)?.optBoolean("deleted", false) == false) || (pageKey.isNotEmpty() && pageKey in library)
            val upKey = upArticles.optString(a.id).ifEmpty { null }
            if (!inLibrary && a.local && a.blocks.isNotEmpty() && (a.url.startsWith("https://") || a.url.startsWith("http://"))) {
                val key = upKey ?: "article:ph_${a.id}"
                val f = JSONObject().put("id", "ph_${a.id}").put("url", a.url).put("title", a.title.ifBlank { a.blocks.first().second.take(120) })
                    .put("timestamp", Instant.ofEpochMilli(a.at).toString()).put("content", BlocksHtml.fromBlocks(a.blocks))
                if (a.summary.isNotBlank()) f.put("summaryBase", BlocksHtml.fromSummary(a.summary))
                if (put(key, f)) out.articles++
                upArticles.put(a.id, key)
            }
            // its highlights go up for a page the library has or now has because of this phone
            if (inLibrary || upArticles.has(a.id)) for (text in a.userHighlights) {
                val key = "hl:ph_" + sha(a.url + "\n" + text).take(16); desiredHl.add(key)
                val f = JSONObject().put("id", key.removePrefix("hl:")).put("url", a.url).put("text", text).put("type", "user").put("timestamp", Instant.ofEpochMilli(a.at).toString())
                if (put(key, f)) out.highlights++
            }
        }
        for (key in oldHl) if (key !in desiredHl) {   // unmarked on this phone since: a deletion marker, so it goes from the browser too
            val rec = records.get(key) ?: continue
            val t = SyncFields.tombstone(rec, c, now()); if (t.changed) { records.put(key, t.record); out.removed++ }
        }
        stateFile.parentFile?.mkdirs()
        stateFile.writeText(JSONObject().put("articles", upArticles).put("hl", JSONArray(desiredHl.toList())).toString())
        return out
    }

    private fun sha(s: String) = MessageDigest.getInstance("SHA-1").digest(s.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}

/** The same identity of a page as the extension's articleKey (syncIdentity.js): tracking parameters, the fragment, the scheme, www. and a trailing slash do not count. */
object ArticleIdentity {
    private val TRACKING = Regex("^(utm_[a-z0-9_]*|fbclid|gclid|dclid|msclkid|yclid|mc_cid|mc_eid|igshid|ref_src|ref_url|_hsenc|_hsmi|vero_id|oly_enc_id|oly_anon_id)$", RegexOption.IGNORE_CASE)
    fun key(href: String): String {
        val u = runCatching { java.net.URI(href.trim()) }.getOrNull() ?: return ""
        if (u.scheme != "http" && u.scheme != "https") return ""
        val host = (u.host ?: return "").lowercase().removePrefix("www.")
        val path = (u.rawPath ?: "").trimEnd('/')
        val q = (u.rawQuery ?: "").split('&').filter { it.isNotEmpty() }.map { it.substringBefore('=') to it.substringAfter('=', "") }
            .filter { !TRACKING.matches(it.first) }.sortedWith(compareBy({ it.first }, { it.second })).joinToString("&") { it.first + "=" + it.second }
        if (path.isEmpty() && q.isEmpty()) return ""   // a bare site address is not an article
        return host + path + (if (q.isNotEmpty()) "?$q" else "")
    }
}

/** Text blocks back to plain, safe HTML (the browser's own full text is richer; this is for pages only this phone has). */
object BlocksHtml {
    private fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    fun fromBlocks(blocks: List<Pair<String, String>>): String {
        val sb = StringBuilder(); var inList = false
        for ((type, text) in blocks) {
            if (type != "li" && inList) { sb.append("</ul>"); inList = false }
            when (type) {
                "h1", "h2", "h3" -> sb.append("<$type>").append(esc(text)).append("</$type>")
                "li" -> { if (!inList) { sb.append("<ul>"); inList = true }; sb.append("<li>").append(esc(text)).append("</li>") }
                "q" -> sb.append("<blockquote><p>").append(esc(text)).append("</p></blockquote>")
                "pre" -> sb.append("<pre>").append(esc(text)).append("</pre>")
                else -> sb.append("<p>").append(esc(text)).append("</p>")
            }
        }
        if (inList) sb.append("</ul>")
        return sb.toString()
    }
    /** The summary as the reader keeps it ("- " items, paragraphs split at blank lines) back to HTML. */
    fun fromSummary(text: String): String = fromBlocks(text.replace("\r", "").split(Regex("\n{2,}")).flatMap { para ->
        val lines = para.split('\n').map { it.trim() }.filter { it.isNotEmpty() }
        if (lines.isNotEmpty() && lines.all { it.startsWith("- ") }) lines.map { "li" to it.removePrefix("- ").trim() } else listOf("p" to lines.joinToString(" "))
    }.filter { it.second.isNotEmpty() })
}
