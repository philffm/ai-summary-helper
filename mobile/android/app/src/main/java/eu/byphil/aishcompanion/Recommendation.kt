package eu.byphil.aishcompanion

import org.json.JSONArray
import org.json.JSONObject

/**
 * A recommendation as it travels: a small web page anyone can read, which carries the same as data for Kaivo. It holds the article's
 * address and title, what the sender adds, and nothing that identifies them beyond the name they give. The same form as the iPhone app's
 * (mobile/ios/Shared/Recommendation.swift); both read the pages in plugin/tests/fixtures.
 */
data class Recommendation(
    val url: String,
    val title: String,
    val note: String = "",
    /** The name as the sender gives it; nothing checks it. */
    val from: String = "",
    /** Passages the sender marked. */
    val marks: List<String> = emptyList(),
    val summary: List<String> = emptyList(),
    val v: Int = 1,
) {
    /** Within the limits, and about a web page; null otherwise. */
    fun checked(): Recommendation? {
        if (v != 1 || url.length > 2000) return null
        val address = runCatching { java.net.URI(url) }.getOrNull() ?: return null
        val host = address.host
        if (address.scheme?.lowercase() !in listOf("http", "https") || host.isNullOrEmpty()) return null
        fun cut(text: String, most: Int) = take(text.trim(), most)
        fun list(of: List<String>) = of.take(20).map { cut(it, 1000) }.filter { it.isNotEmpty() }
        return copy(
            title = cut(title, 300).ifEmpty { host },
            note = cut(note, 2000),
            from = cut(from, 60).split('\n', '\r', '\u2028', '\u2029').filter { it.isNotEmpty() }.joinToString(" "),
            marks = list(marks), summary = list(summary),
        )
    }

    fun toJson(): JSONObject = JSONObject().put("v", v).put("url", url).put("title", title).put("note", note).put("from", from)
        .put("marks", JSONArray(marks)).put("summary", JSONArray(summary))

    /** The words the page is written in, in the sender's language. */
    data class Words(val recommendedBy: String, val read: String, val hint: String)

    /** The page: readable on its own, without scripts and without anything loaded from elsewhere. */
    fun page(words: Words): String {
        fun safe(text: String) = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;")
        val data = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(toJson().toString().toByteArray(Charsets.UTF_8))
        val body = StringBuilder("<p class=\"by\">${safe(words.recommendedBy)}</p>\n<h1>${safe(title)}</h1>\n")
        if (note.isNotEmpty()) body.append("<p class=\"note\">${safe(note)}</p>\n")
        marks.forEach { body.append("<blockquote>${safe(it)}</blockquote>\n") }
        summary.forEach { body.append("<p>${safe(it)}</p>\n") }
        body.append("<p><a class=\"read\" href=\"${safe(url)}\">${safe(words.read)}</a></p>\n<p class=\"small\">${safe(url)}</p>\n<p class=\"small\">${safe(words.hint)}</p>")
        return listOf(
            "<!doctype html>",
            "<html><head><meta charset=\"utf-8\">",
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
            "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\">",
            "<meta name=\"$META\" content=\"$data\">",
            "<title>${safe(title)}</title>",
            "<style>",
            "body{font:17px/1.55 system-ui,sans-serif;max-width:34em;margin:0 auto;padding:28px 20px;color:#111;background:#fff}",
            "h1{font:700 1.5em/1.25 ui-serif,Georgia,serif}",
            ".by{color:#0f6675;font-weight:600}",
            ".note{background:#f2f2f7;border-radius:14px;padding:12px 16px;white-space:pre-wrap}",
            "blockquote{border-left:3px solid #0f6675;margin:16px 0;padding:2px 0 2px 14px;font-family:ui-serif,Georgia,serif}",
            ".read{display:inline-block;background:#0f6675;color:#fff;border-radius:24px;padding:12px 24px;text-decoration:none;font-weight:600}",
            ".small{color:#666;font-size:.8em;word-break:break-all}",
            "@media (prefers-color-scheme:dark){body{color:#eee;background:#111}.note{background:#222}}",
            "</style></head><body>",
            body.toString(),
            "</body></html>",
            "",
        ).joinToString("\n")
    }

    companion object {
        /** What the page may weigh: it comes from someone else. */
        const val MAX_BYTES = 256_000
        private const val META = "kaivo:recommendation"
        private val FOUND = Regex("<meta name=\"$META\" content=\"([A-Za-z0-9_-]+)\"")

        /** Not cut in the middle of a character that takes two places. */
        private fun take(text: String, most: Int): String =
            if (text.length <= most) text else text.take(if (Character.isHighSurrogate(text[most - 1])) most - 1 else most)

        /** What a page or a stored article carries; null where it is not complete or not within the limits. */
        fun from(json: JSONObject): Recommendation? = runCatching {
            fun words(key: String) = json.get(key) as String
            fun list(key: String) = json.getJSONArray(key).let { a -> (0 until a.length()).map { a.get(it) as String } }
            Recommendation(words("url"), words("title"), words("note"), words("from"), list("marks"), list("summary"), json.getInt("v")).checked()
        }.getOrNull()

        /** The recommendation a page carries; null for any other page, a broken one or one that is too large. */
        fun read(data: ByteArray): Recommendation? {
            if (data.size > MAX_BYTES) return null
            val code = FOUND.find(String(data, Charsets.UTF_8))?.groupValues?.get(1) ?: return null
            return runCatching { from(JSONObject(String(java.util.Base64.getUrlDecoder().decode(code), Charsets.UTF_8))) }.getOrNull()
        }

        /** A file name from words that may hold anything. */
        fun fileName(words: String): String {
            val clean = words.map { if (it in "/\\:*?\"<>|" || it.isISOControl()) ' ' else it }.joinToString("").split(Regex("\\s+")).filter { it.isNotEmpty() }.joinToString(" ")
            return take(clean, 80).trim('.', ' ') + ".html"
        }
    }
}
