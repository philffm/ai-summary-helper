package eu.byphil.aishcompanion

import eu.byphil.aishcompanion.sync.RecordStore
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant

/** Where the articles of the reading list go (the real store in the app, a map in tests). */
interface ArticleSink { fun save(article: Article, json: String, receivedAt: Long); fun delete(id: String); fun has(id: String): Boolean }

class ArticleStoreSink(private val store: ArticleStore) : ArticleSink {
    override fun save(article: Article, json: String, receivedAt: Long) = store.save(article, json, receivedAt)
    override fun delete(id: String) = store.delete(id)
    override fun has(id: String) = store.has(id)
}

/**
 * Turns the articles and highlights the browser synced ("article:<id>", "hl:<id>" records) into reading-list articles of this phone. What it made is
 * remembered (id → the record's stamp), so a run only touches what changed, a deletion in the browser removes only what this made, and an article
 * that came another way (sent from the browser, or summarized here) is never overwritten or removed.
 */
class ArticleMaterializer(private val records: RecordStore, private val sink: ArticleSink, private val stateFile: File, private val own: () -> Set<String> = { emptySet() }) {
    class Result(var saved: Int = 0, var removed: Int = 0, var skipped: Int = 0)

    private fun loadState(): JSONObject = runCatching { JSONObject(stateFile.readText()) }.getOrDefault(JSONObject())
    private fun norm(url: String) = url.substringBefore('#').trimEnd('/')

    fun run(): Result {
        val out = Result(); val state = loadState(); val seen = HashSet<String>(); val mine = own()   // records this phone made itself (see PhoneUploader) are never turned back into articles
        // highlights by page, once
        val marks = HashMap<String, ArrayList<JSONArray>>()
        for (k in records.keys("hl:")) {
            if (k in mine) continue
            val v = records.get(k)?.takeIf { !it.optBoolean("deleted", false) }?.optJSONObject("values") ?: continue
            val text = v.optString("text").trim(); val url = v.optString("url")
            if (text.length < 5 || url.isEmpty() || v.optBoolean("dismissed", false)) continue
            marks.getOrPut(norm(url)) { ArrayList() }.add(JSONArray().put(if (v.optString("type") == "ghost") "g" else "u").put(text.take(600)))
        }
        for (k in records.keys("article:")) {
            if (k in mine) continue
            val id = k.removePrefix("article:"); val rec = records.get(k) ?: continue
            if (!ArticleStore.ID.matches(id)) { out.skipped++; continue }
            seen.add(id)
            val stamp = rec.optJSONObject("rev")?.optLong("t")?.toString() ?: "0"
            if (rec.optBoolean("deleted", false)) { if (state.has(id)) { sink.delete(id); state.remove(id); out.removed++ }; continue }
            val v = rec.optJSONObject("values")
            if (v == null) { out.skipped++; continue }
            if (v.optBoolean("feedStub", false) || v.optBoolean("savedOnly", false)) { out.skipped++; continue }
            val url = v.optString("url")
            val signature = "$stamp:" + (marks[norm(url)]?.joinToString("|") { it.toString() }.orEmpty().hashCode())   // the record's stamp and the highlights of its page
            if (state.optString(id) == signature && sink.has(id)) continue
            if (!state.has(id) && sink.has(id)) { out.skipped++; continue }   // it came another way: leave it alone
            val blocks = HtmlBlocks.toBlocks(v.optString("content")).ifEmpty { HtmlBlocks.toBlocks(v.optString("summaryBase")) }
            if (blocks.isEmpty() || !(url.startsWith("https://") || url.startsWith("http://"))) { out.skipped++; continue }
            val title = v.optString("title").ifBlank { blocks.first().second.take(120) }
            val meta = v.optJSONObject("meta")
            val json = JSONObject().put("v", 2).put("url", url).put("title", title).put("site", HtmlBlocks.siteOf(url))
                .put("byline", (v.optString("byline").ifBlank { v.optString("author") }.ifBlank { meta?.optString("author").orEmpty() }).trim())
                .put("lang", v.optString("language").ifBlank { v.optString("lang") }.take(20))
                .put("summary", HtmlBlocks.summaryToText(v.optString("summaryBase")))
                .put("blocks", JSONArray(blocks.map { JSONArray().put(it.first).put(it.second) })).put("aid", id)
                .put("sentAt", sentAt(v)).put("truncated", false)
            marks[norm(url)]?.let { json.put("hl", JSONArray(it.take(200))) }
            runCatching { ArticleCodec.parse(json.toString(), id) }.onSuccess { a -> sink.save(a, json.toString(), sentAt(v)); state.put(id, signature); out.saved++ }.onFailure { out.skipped++ }
        }
        for (id in state.keys().asSequence().toList()) if (id !in seen) { sink.delete(id); state.remove(id); out.removed++ }   // its record is gone from the library
        stateFile.parentFile?.mkdirs(); stateFile.writeText(state.toString())
        return out
    }

    private fun sentAt(v: JSONObject): Long = runCatching { Instant.parse(v.optString("timestamp")).toEpochMilli() }.getOrNull() ?: System.currentTimeMillis()
}
