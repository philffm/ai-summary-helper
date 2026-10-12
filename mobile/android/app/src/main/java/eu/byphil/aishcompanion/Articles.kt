package eu.byphil.aishcompanion

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPInputStream

/** One text block of an article: type is h1, h2, h3, p, li, q or pre. The extension sends no markup and no images, so nothing here can run or load anything. */
data class Block(val type: String, val text: String)

/** A passage the user (or the AI, `ghost`) highlighted in the extension. Marked in the text where the same words are found. */
data class Highlight(val ghost: Boolean, val text: String)

data class Article(
    val id: String,
    val url: String,
    val title: String,
    val site: String,
    val byline: String,
    val lang: String,
    val summary: String,
    val blocks: List<Block>,
    val sentAt: Long,
    val truncated: Boolean,
    val highlights: List<Highlight> = emptyList(),
    /** Summarized on this phone from a page opened in the app (not sent from the browser). */
    val local: Boolean = false,
)

/**
 * Wire format v2 (extension → phone): AES-256-GCM like v1, but the plaintext is gzip(JSON). The JSON is
 * {v:2, url, sentAt, title, site, byline, lang, summary?, blocks:[[type,text],...], truncated?}.
 * Pure JVM, unit-tested against the article part of the shared vector (src/test/resources/inbox-vector.json).
 */
object ArticleCodec {
    const val MAX_RAW = 4_000_000   // decompressed bytes accepted; guards against a decompression bomb
    private val TYPES = setOf("h1", "h2", "h3", "p", "li", "q", "pre")

    fun gunzip(bytes: ByteArray, limit: Int = MAX_RAW): ByteArray {
        GZIPInputStream(bytes.inputStream()).use { input ->
            val out = ByteArrayOutputStream()
            val buf = ByteArray(8192)
            var total = 0
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                total += n
                require(total <= limit) { "article too large" }
                out.write(buf, 0, n)
            }
            return out.toByteArray()
        }
    }

    /** Decrypts and decompresses one item; returns the article and the plain JSON (kept on the phone as is). Throws on anything wrong. */
    fun decrypt(inboxId: String, encKey: String, data: String, id: String): Pair<Article, String> {
        val json = String(gunzip(InboxCrypto.decryptBytes(inboxId, encKey, data)), Charsets.UTF_8)
        return parse(json, id) to json
    }

    fun parse(json: String, id: String): Article {
        val o = JSONObject(json)
        require(o.optInt("v") == 2) { "unsupported article" }
        val url = o.getString("url")
        require(url.startsWith("https://") || url.startsWith("http://")) { "not a web link" }
        val arr = o.getJSONArray("blocks")
        val blocks = ArrayList<Block>(arr.length())
        for (i in 0 until arr.length()) {
            val b = arr.getJSONArray(i)
            val type = b.getString(0)
            val text = b.getString(1)
            if (type in TYPES && text.isNotBlank()) blocks.add(Block(type, text))
        }
        require(blocks.isNotEmpty()) { "empty article" }
        val marks = ArrayList<Highlight>()
        val hl = o.optJSONArray("hl")
        if (hl != null) for (i in 0 until minOf(hl.length(), 200)) {
            val h = hl.optJSONArray(i) ?: continue
            val text = h.optString(1, "").trim()
            if (text.length >= 5) marks.add(Highlight(h.optString(0, "") == "g", text.take(600)))
        }
        return Article(
            id = id, url = url, title = o.optString("title"), site = o.optString("site"), byline = o.optString("byline"),
            lang = o.optString("lang"), summary = o.optString("summary"), blocks = blocks, sentAt = o.optLong("sentAt"),
            truncated = o.optBoolean("truncated", false), highlights = marks, local = o.optBoolean("local", false),
        )
    }
}
