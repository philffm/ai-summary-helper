package eu.byphil.aishcompanion

import org.json.JSONObject
import java.net.URI
import java.text.SimpleDateFormat
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.TimeZone

/** One entry of a feed as the reader shows it. [body] is plain text with blank lines between paragraphs (what the feed itself carries, often just a teaser). */
data class FeedItem(
    val id: String,
    val title: String,
    val link: String,
    val published: Long,
    val author: String,
    val summary: String,
    val body: String,
    /** A podcast episode's audio file (https only), and its length in seconds (0 = unknown). */
    val audio: String = "",
    val duration: Int = 0,
)

data class ParsedFeed(val title: String, val siteUrl: String, val items: List<FeedItem>)

/**
 * A small, tolerant reader for RSS 2.0, RSS 1.0 (RDF), Atom and JSON Feed. No external library on purpose: the XML reader below
 * never fetches anything (no DTD, no external entities), limits depth and size, and so a hostile feed can only waste a little time.
 * Pure JVM, unit-tested.
 */
object FeedXml {
    const val MAX_ITEMS = 100
    private const val MAX_NODES = 200_000
    private const val MAX_DEPTH = 64
    private const val MAX_BODY = 20_000

    class Node(val name: String, val attrs: Map<String, String>) {
        val children = ArrayList<Node>()
        val text = StringBuilder()
        /** Name without a namespace prefix. */
        val local: String get() = name.substringAfter(':')
        fun child(vararg names: String): Node? { val w = names.map { it.lowercase() }; return children.firstOrNull { it.name in w || it.local in w } }
        fun all(name: String): List<Node> { val w = name.lowercase(); return children.filter { it.name == w || it.local == w } }
        fun textOf(vararg names: String): String = child(*names)?.text?.toString()?.trim() ?: ""
    }

    // ── XML ──

    fun parseXml(src: String): Node? {
        val root = Node("#root", emptyMap())
        val stack = ArrayList<Node>().apply { add(root) }
        var i = 0; var nodes = 0
        val n = src.length
        while (i < n) {
            val lt = src.indexOf('<', i)
            if (lt < 0) { stack.last().text.append(decodeXml(src.substring(i))); break }
            if (lt > i) stack.last().text.append(decodeXml(src.substring(i, lt)))
            i = lt
            when {
                src.startsWith("<!--", i) -> { val e = src.indexOf("-->", i + 4); i = if (e < 0) n else e + 3 }
                src.startsWith("<![CDATA[", i) -> { val e = src.indexOf("]]>", i + 9); val end = if (e < 0) n else e; stack.last().text.append(src, i + 9, end); i = if (e < 0) n else e + 3 }
                src.startsWith("<?", i) -> { val e = src.indexOf("?>", i + 2); i = if (e < 0) n else e + 2 }
                src.startsWith("<!", i) -> { // DOCTYPE and friends: skipped, with an internal subset in [...]
                    var depth = 0; var j = i + 2
                    while (j < n) { val c = src[j]; if (c == '[') depth++ else if (c == ']') depth-- else if (c == '>' && depth <= 0) break; j++ }
                    i = minOf(n, j + 1)
                }
                src.startsWith("</", i) -> {
                    val e = src.indexOf('>', i); val name = src.substring(i + 2, if (e < 0) n else e).trim().lowercase()
                    val at = stack.indexOfLast { it.name == name }
                    if (at > 0) while (stack.size > at) stack.removeAt(stack.size - 1)
                    i = if (e < 0) n else e + 1
                }
                else -> {
                    val r = readTag(src, i)
                    if (r == null) { stack.last().text.append('<'); i += 1 }
                    else {
                        val (tag, next) = r
                        i = next
                        if (++nodes > MAX_NODES) return null
                        val node = Node(tag.first, tag.second)
                        stack.last().children.add(node)
                        if (!tag.third && stack.size < MAX_DEPTH) stack.add(node)
                    }
                }
            }
        }
        return root.children.firstOrNull()
    }

    private fun readTag(s: String, start: Int): Pair<Triple<String, Map<String, String>, Boolean>, Int>? {
        var i = start + 1
        val n = s.length
        val ns = i
        while (i < n && !s[i].isWhitespace() && s[i] != '>' && s[i] != '/') i++
        if (i == ns) return null
        val name = s.substring(ns, i).lowercase()
        val attrs = LinkedHashMap<String, String>()
        var selfClosing = false
        while (i < n) {
            while (i < n && s[i].isWhitespace()) i++
            if (i >= n) break
            if (s[i] == '>') { i++; return Triple(name, attrs, selfClosing) to i }
            if (s[i] == '/') { selfClosing = true; i++; continue }
            val ks = i
            while (i < n && !s[i].isWhitespace() && s[i] != '=' && s[i] != '>' && s[i] != '/') i++
            val key = s.substring(ks, i).lowercase()
            while (i < n && s[i].isWhitespace()) i++
            var value = ""
            if (i < n && s[i] == '=') {
                i++
                while (i < n && s[i].isWhitespace()) i++
                if (i < n && (s[i] == '"' || s[i] == '\'')) {
                    val q = s[i]; val e = s.indexOf(q, i + 1)
                    value = decodeXml(s.substring(i + 1, if (e < 0) n else e)); i = if (e < 0) n else e + 1
                } else { val vs = i; while (i < n && !s[i].isWhitespace() && s[i] != '>') i++; value = decodeXml(s.substring(vs, i)) }
            }
            if (key.isNotEmpty()) attrs[key] = value
        }
        return Triple(name, attrs, selfClosing) to n
    }

    private val XML_ENT = Regex("&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);")
    fun decodeXml(s: String): String = if ('&' !in s) s else XML_ENT.replace(s) { m ->
        val g = m.groupValues[1]
        when {
            g == "amp" -> "&"
            g == "lt" -> "<"
            g == "gt" -> ">"
            g == "quot" -> "\""
            g == "apos" -> "'"
            g.startsWith("#x") -> codePoint(g.substring(2).toInt(16), m.value)
            else -> codePoint(g.substring(1).toInt(), m.value)
        }
    }
    private fun codePoint(cp: Int, orig: String): String = if (cp in 1..0x10FFFF && cp !in 0xD800..0xDFFF) String(Character.toChars(cp)) else orig

    // ── HTML to text ──

    private val NAMED = mapOf(
        "nbsp" to " ", "amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'", "mdash" to "—", "ndash" to "–", "hellip" to "…",
        "lsquo" to "‘", "rsquo" to "’", "ldquo" to "“", "rdquo" to "”", "laquo" to "«", "raquo" to "»", "copy" to "©", "reg" to "®", "euro" to "€",
        "auml" to "ä", "ouml" to "ö", "uuml" to "ü", "Auml" to "Ä", "Ouml" to "Ö", "Uuml" to "Ü", "szlig" to "ß", "eacute" to "é", "egrave" to "è",
        "bull" to "•", "middot" to "·", "trade" to "™", "times" to "×", "deg" to "°",
    )
    private val HTML_ENT = Regex("&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z]{2,8});")
    private fun decodeHtml(s: String): String = if ('&' !in s) s else HTML_ENT.replace(s) { m ->
        val g = m.groupValues[1]
        when {
            g.startsWith("#x") -> codePoint(g.substring(2).toInt(16), m.value)
            g.startsWith("#") -> codePoint(g.substring(1).toInt(), m.value)
            else -> NAMED[g] ?: m.value
        }
    }
    private val DROP = Regex("(?is)<(script|style|noscript|svg|iframe|head)\\b.*?</\\1\\s*>")
    private val BREAKS = Regex("(?i)<\\s*(/?\\s*(p|div|h[1-6]|ul|ol|blockquote|pre|table|tr|section|article|figure|figcaption))\\b[^>]*>")
    private val LI = Regex("(?i)<\\s*li\\b[^>]*>")
    private val BR = Regex("(?i)<\\s*br\\s*/?>")
    private val TAG = Regex("<[^>]*>")
    private val SPACE_RUN = Regex("[ \\t\\u00A0\\u200B]+")

    /** Feed text is often escaped HTML: drops scripts and tags, keeps paragraph breaks and list bullets, decodes entities. Blank line between paragraphs. */
    fun htmlToText(html: String): String {
        if (html.isEmpty()) return ""
        var t = html
        if ('<' in t) {
            t = DROP.replace(t, " ")
            t = BR.replace(t, "\n")
            t = LI.replace(t, "\n\u0001")
            t = BREAKS.replace(t, "\n\n")
            t = TAG.replace(t, "")
        }
        t = decodeHtml(t).replace("\u0001", "• ").replace("\r", "")
        t = t.lines().joinToString("\n") { SPACE_RUN.replace(it, " ").trim() }
        return t.replace(Regex("\n{3,}"), "\n\n").trim()
    }

    // ── feeds ──

    fun parse(text: String, baseUrl: String = ""): ParsedFeed? {
        val t = text.trimStart('\uFEFF', ' ', '\n', '\r', '\t')
        if (t.startsWith("{")) return parseJsonFeed(t)
        val root = parseXml(t) ?: return null
        return when (root.local) {
            "rss" -> root.child("channel")?.let { channel(it, channel = it, itemsFrom = it, base = baseUrl, atom = false) }
            "rdf" -> root.child("channel")?.let { channel(it, channel = it, itemsFrom = root, base = baseUrl, atom = false) }
            "feed" -> channel(root, channel = root, itemsFrom = root, base = baseUrl, atom = true)
            else -> null
        }
    }

    private fun channel(head: Node, channel: Node, itemsFrom: Node, base: String, atom: Boolean): ParsedFeed {
        val title = htmlToText(channel.textOf("title"))
        val site = if (atom) atomLink(channel, "alternate", base) else resolve(base, channel.textOf("link"))
        val nodes = if (atom) itemsFrom.all("entry") else itemsFrom.all("item")
        val items = nodes.take(MAX_ITEMS).mapNotNull { if (atom) atomItem(it, base) else rssItem(it, base) }
        return ParsedFeed(title, site, items)
    }

    private fun atomLink(n: Node, rel: String, base: String): String {
        val links = n.all("link")
        val pick = links.firstOrNull { (it.attrs["rel"] ?: "alternate") == rel && it.attrs["href"] != null }
            ?: if (rel == "alternate") links.firstOrNull { it.attrs["href"] != null && it.attrs["rel"] == null } else null
        return resolve(base, pick?.attrs?.get("href") ?: "")
    }

    private fun rssItem(n: Node, base: String): FeedItem? {
        val title = htmlToText(n.textOf("title"))
        var link = resolve(base, n.textOf("link"))
        if (link.isEmpty()) link = n.all("link").firstNotNullOfOrNull { it.attrs["href"] }?.let { resolve(base, it) } ?: ""
        val guid = n.textOf("guid", "identifier")
        if (link.isEmpty() && guid.startsWith("http")) link = resolve(base, guid)
        val full = n.textOf("encoded").ifEmpty { n.textOf("content") }
        val desc = n.textOf("description", "summary")
        val audio = n.all("enclosure").firstNotNullOfOrNull { e -> e.attrs["url"]?.let { u -> resolve(base, u).takeIf { r -> audioLike(r, e.attrs["type"] ?: "") } } } ?: ""
        return build(guid, title, link, n.textOf("pubDate", "date", "published", "updated"), n.textOf("creator", "author").ifEmpty { n.child("author")?.textOf("name") ?: "" }, desc, full, audio, parseDuration(n.textOf("duration")))
    }

    private fun atomItem(n: Node, base: String): FeedItem? {
        val full = n.child("content")?.let { c -> if (c.attrs["type"] == "xhtml") c.children.joinToString("") { it.text } else c.text.toString() } ?: ""
        return build(
            n.textOf("id"), htmlToText(n.textOf("title")), atomLink(n, "alternate", base),
            n.textOf("published").ifEmpty { n.textOf("updated") }, n.child("author")?.textOf("name") ?: "", n.textOf("summary"), full.trim(),
            n.all("link").firstNotNullOfOrNull { l -> if (l.attrs["rel"] == "enclosure") l.attrs["href"]?.let { h -> resolve(base, h).takeIf { r -> audioLike(r, l.attrs["type"] ?: "") } } else null } ?: "",
        )
    }

    private fun build(guid: String, title: String, link: String, date: String, author: String, descHtml: String, fullHtml: String, audio: String = "", duration: Int = 0): FeedItem? {
        val bodyHtml = fullHtml.ifBlank { descHtml }
        val body = htmlToText(bodyHtml).take(MAX_BODY)
        val summary = htmlToText(descHtml.ifBlank { fullHtml }).replace(Regex("\\s+"), " ").take(400)
        val safeLink = if (link.startsWith("https://") || link.startsWith("http://")) link else ""
        val shownTitle = title.ifEmpty { summary.take(80) }
        if (shownTitle.isEmpty() && safeLink.isEmpty()) return null
        val id = guid.ifEmpty { safeLink.ifEmpty { shownTitle + date } }.take(300)
        return FeedItem(id, shownTitle, safeLink, parseDate(date), htmlToText(author).take(120), summary, body, audio, duration.coerceIn(0, 86_400))
    }

    private fun parseJsonFeed(t: String): ParsedFeed? = try {
        val o = JSONObject(t)
        val arr = o.getJSONArray("items")
        val items = ArrayList<FeedItem>()
        for (i in 0 until minOf(arr.length(), MAX_ITEMS)) {
            val it = arr.getJSONObject(i)
            val author = it.optJSONArray("authors")?.optJSONObject(0)?.optString("name", "") ?: ""
            val attachments = it.optJSONArray("attachments")
            var audioUrl = ""
            var audioDuration = 0
            if (attachments != null) {
                for (k in 0 until attachments.length()) {
                    val att = attachments.optJSONObject(k) ?: continue
                    val url = att.optString("url", "")
                    val mime = att.optString("mime_type", "")
                    if (audioLike(url, mime)) {
                        audioUrl = url
                        audioDuration = att.optInt("duration_in_seconds", 0)
                        break
                    }
                }
            }
            val summaryHtml = it.optString("summary", "").ifEmpty { it.optString("content_text", "") }
            val contentHtml = it.optString("content_html", "").ifEmpty { it.optString("content_text", "") }
            val item = build(
                guid = it.optString("id", ""),
                title = htmlToText(it.optString("title", "")),
                link = it.optString("url", ""),
                date = it.optString("date_published", ""),
                author = author,
                descHtml = summaryHtml,
                fullHtml = contentHtml,
                audio = audioUrl,
                duration = audioDuration
            )
            if (item != null) items.add(item)
        }
        ParsedFeed(htmlToText(o.optString("title", "")), o.optString("home_page_url", ""), items)
    } catch (_: Exception) { null }

    /** True for an https audio file: an audio/ mime type, or a known audio file extension. Plain http is left out (Android blocks it). */
    fun audioLike(url: String, type: String): Boolean =
        url.startsWith("https://") && (type.trim().lowercase().startsWith("audio/") || Regex("\\.(mp3|m4a|aac|ogg|oga|opus|wav)(\\?.*)?$", RegexOption.IGNORE_CASE).containsMatchIn(url))

    /** "1:02:03", "35:10" or "2123" (seconds) → seconds; 0 when unknown. */
    fun parseDuration(raw: String): Int {
        val p = raw.trim().split(':')
        return try {
            when (p.size) {
                1 -> if (p[0].isEmpty()) 0 else p[0].toDouble().toInt()
                2 -> p[0].toInt() * 60 + p[1].toDouble().toInt()
                3 -> p[0].toInt() * 3600 + p[1].toInt() * 60 + p[2].toDouble().toInt()
                else -> 0
            }
        } catch (_: Exception) { 0 }
    }

    // ── dates and links ──

    private val RFC_PATTERNS = listOf("EEE, dd MMM yyyy HH:mm:ss zzz", "EEE, dd MMM yyyy HH:mm:ss Z", "EEE, dd MMM yyyy HH:mm zzz", "EEE, dd MMM yyyy HH:mm Z", "dd MMM yyyy HH:mm:ss Z", "dd MMM yyyy HH:mm:ss zzz", "EEE, d MMM yyyy HH:mm:ss Z", "EEE, d MMM yyyy HH:mm:ss zzz")

    /** Epoch millis, or 0 when the text is not a date this reader knows. */
    fun parseDate(raw: String): Long {
        val s = raw.trim()
        if (s.isEmpty()) return 0
        try { return OffsetDateTime.parse(s, DateTimeFormatter.ISO_OFFSET_DATE_TIME).toInstant().toEpochMilli() } catch (_: Exception) { /* next format */ }
        try { return java.time.LocalDateTime.parse(s, DateTimeFormatter.ISO_LOCAL_DATE_TIME).toInstant(java.time.ZoneOffset.UTC).toEpochMilli() } catch (_: Exception) { /* next format */ }
        try { return java.time.LocalDate.parse(s, DateTimeFormatter.ISO_LOCAL_DATE).atStartOfDay().toInstant(java.time.ZoneOffset.UTC).toEpochMilli() } catch (_: Exception) { /* next format */ }
        for (p in RFC_PATTERNS) {
            try {
                val f = SimpleDateFormat(p, Locale.US); f.timeZone = TimeZone.getTimeZone("UTC"); f.isLenient = true
                return f.parse(s)?.time ?: continue
            } catch (_: Exception) { /* next pattern */ }
        }
        return 0
    }

    fun resolve(base: String, ref: String): String {
        val r = ref.trim()
        if (r.isEmpty()) return ""
        return try {
            val u = if (base.isNotEmpty()) URI(base).resolve(r) else URI(r)
            if (u.scheme == "https" || u.scheme == "http") u.toString() else ""
        } catch (_: Exception) { "" }
    }

    /** A web page that points to its feeds: <link rel="alternate" type="application/rss+xml|atom+xml|feed+json" href=...>. Best first. */
    fun discover(html: String, base: String): List<String> {
        val out = ArrayList<String>()
        for (m in Regex("(?is)<link\\b[^>]*>").findAll(html)) {
            val tag = m.value
            fun attr(name: String) = Regex("""(?is)\b""" + name + """\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))""").find(tag)?.let { it.groupValues[2].ifEmpty { it.groupValues[3].ifEmpty { it.groupValues[4] } } } ?: ""
            val rel = attr("rel").lowercase(); val type = attr("type").lowercase()
            if ("alternate" in rel && (type.contains("rss") || type.contains("atom") || type.contains("feed+json") || type == "application/json")) {
                val u = resolve(base, decodeXml(attr("href")))
                if (u.isNotEmpty() && u !in out) out.add(u)
            }
        }
        return out
    }
}
