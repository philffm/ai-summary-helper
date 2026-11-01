package eu.byphil.aishcompanion

/**
 * An article's HTML as the compact text blocks the reader shows: h1/h2/h3, p, li, q, pre. No images, links or markup survive, so there is nothing to
 * render unsafely. The Kotlin side of articleBlocks.js in the extension (same block types and limits); it reads HTML itself because the app has no
 * HTML library, and is tolerant: unclosed tags, stray text and odd nesting never throw.
 */
object HtmlBlocks {
    const val MAX_BLOCKS = 6000
    const val MAX_BLOCK_TEXT = 20_000
    private val SKIP = setOf("script", "style", "noscript", "template", "iframe", "svg", "canvas", "form", "button", "select", "input", "textarea",
        "nav", "aside", "footer", "img", "picture", "video", "audio", "object", "embed", "head", "dialog")
    private val VOID = setOf("img", "input", "br", "hr", "meta", "link", "source", "track", "area", "base", "col", "embed", "wbr", "param")
    private val HEADING = mapOf("h1" to "h1", "h2" to "h2", "h3" to "h3", "h4" to "h3", "h5" to "h3", "h6" to "h3")
    private val BLOCKISH = setOf("p", "div", "section", "article", "main", "ul", "ol", "table", "tbody", "thead", "tfoot", "tr", "figure", "figcaption",
        "dl", "dt", "dd", "details", "summary", "header", "address", "hr", "body", "html")
    private val NAMED = mapOf("amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'", "nbsp" to " ", "mdash" to "—", "ndash" to "–", "hellip" to "…",
        "rsquo" to "’", "lsquo" to "‘", "rdquo" to "”", "ldquo" to "“", "laquo" to "«", "raquo" to "»", "copy" to "©", "euro" to "€", "auml" to "ä", "ouml" to "ö",
        "uuml" to "ü", "Auml" to "Ä", "Ouml" to "Ö", "Uuml" to "Ü", "szlig" to "ß", "eacute" to "é", "egrave" to "è", "agrave" to "à", "ccedil" to "ç", "bull" to "•", "middot" to "·", "times" to "×")

    private fun squash(s: String) = s.replace(Regex("\\s+"), " ").trim()

    fun decode(s: String): String {
        if (!s.contains('&')) return s
        return Regex("&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]{1,8});").replace(s) { m ->
            val e = m.groupValues[1]
            when {
                e.startsWith("#x") || e.startsWith("#X") -> e.substring(2).toIntOrNull(16)?.let { cp(it) } ?: m.value
                e.startsWith("#") -> e.substring(1).toIntOrNull()?.let { cp(it) } ?: m.value
                else -> NAMED[e] ?: m.value
            }
        }
    }
    private fun cp(n: Int): String = if (n in 1..0x10FFFF && n !in 0xD800..0xDFFF) String(Character.toChars(n)) else ""

    /** The blocks of an HTML (or plain text) string, in reading order. */
    fun toBlocks(html: String): List<Pair<String, String>> {
        if (!Regex("<[a-zA-Z/!]").containsMatchIn(html)) return textToBlocks(html)
        val blocks = ArrayList<Pair<String, String>>()
        val buf = StringBuilder(); var kind = "p"
        val kindStack = ArrayList<String>()
        fun flush() { val t = squash(buf.toString()); buf.setLength(0); if (t.isNotEmpty() && blocks.size < MAX_BLOCKS) blocks.add(kind to t.take(MAX_BLOCK_TEXT)) }
        var i = 0; val n = html.length
        var skipTag = ""; var skipDepth = 0
        var heading: String? = null; val headBuf = StringBuilder()
        var inPre = false; val preBuf = StringBuilder()
        while (i < n && blocks.size < MAX_BLOCKS) {
            val c = html[i]
            if (c != '<') {
                val j = html.indexOf('<', i).let { if (it < 0) n else it }
                if (skipDepth == 0) { val text = decode(html.substring(i, j)); when { inPre -> preBuf.append(text); heading != null -> headBuf.append(text); else -> buf.append(text) } }
                i = j; continue
            }
            if (html.startsWith("<!--", i)) { val e = html.indexOf("-->", i + 4); i = if (e < 0) n else e + 3; continue }
            val end = html.indexOf('>', i + 1)
            if (end < 0) { if (skipDepth == 0) buf.append(decode(html.substring(i))); break }
            val raw = html.substring(i + 1, end); i = end + 1
            if (raw.startsWith("!") || raw.startsWith("?")) continue
            val closing = raw.startsWith("/")
            val name = Regex("^/?\\s*([A-Za-z][A-Za-z0-9-]*)").find(raw)?.groupValues?.get(1)?.lowercase() ?: continue
            val selfClosed = raw.endsWith("/") || name in VOID
            if (skipDepth > 0) {
                if (name == skipTag) { if (closing) skipDepth-- else if (!selfClosed) skipDepth++ }
                continue
            }
            if (!closing && name in SKIP) {
                if (!selfClosed) { skipTag = name; skipDepth = 1; if (name == "script" || name == "style") { val e = Regex("</$name\\s*>", RegexOption.IGNORE_CASE).find(html, i); i = e?.range?.last?.plus(1) ?: n; skipDepth = 0 } }
                continue
            }
            if (inPre) { if (closing && name == "pre") { inPre = false; val t = preBuf.toString().replace("\r", "").trimEnd().take(MAX_BLOCK_TEXT); preBuf.setLength(0); if (t.isNotBlank()) blocks.add("pre" to t) }; continue }
            if (heading != null) { if (closing && HEADING.containsKey(name)) { val t = squash(headBuf.toString()); headBuf.setLength(0); if (t.isNotEmpty()) blocks.add(heading!! to t.take(500)); heading = null }; continue }
            if (!closing && HEADING.containsKey(name)) { flush(); heading = HEADING[name]; headBuf.setLength(0); continue }
            if (!closing && name == "pre") { flush(); inPre = true; preBuf.setLength(0); continue }
            if (name == "br") { buf.append(' '); continue }
            if (name == "li" || name == "blockquote") {
                flush()
                if (!closing) { kindStack.add(kind); kind = if (name == "li") "li" else "q" }
                else if (kindStack.isNotEmpty()) kind = kindStack.removeAt(kindStack.size - 1)
                continue
            }
            if (name in BLOCKISH) { flush(); continue }
            // inline element (a, span, b, i, em, strong, code, sup …): only its text matters
        }
        if (heading != null) { val t = squash(headBuf.toString()); if (t.isNotEmpty()) blocks.add(heading!! to t.take(500)) }
        flush()
        return blocks
    }

    /** Plain text becomes paragraphs split at blank lines. */
    fun textToBlocks(text: String): List<Pair<String, String>> =
        text.replace("\r", "").split(Regex("\n{2,}")).map { squash(decode(it)) }.filter { it.isNotEmpty() }.take(MAX_BLOCKS).map { "p" to it.take(MAX_BLOCK_TEXT) }

    /** The AI summary is stored as HTML; the reader shows plain text: list items start with "- ", other blocks are paragraphs. */
    fun summaryToText(summary: String): String {
        val s = summary.trim(); if (s.isEmpty()) return ""
        if (!Regex("<[a-zA-Z]").containsMatchIn(s)) return s
        val lines = ArrayList<String>()
        toBlocks(s).forEachIndexed { i, (type, text) ->
            if (type == "li") lines.add("- $text")
            else { if (i > 0 && lines.isNotEmpty() && lines.last() != "") lines.add(""); lines.add(text); lines.add("") }
        }
        return lines.joinToString("\n").replace(Regex("\n{3,}"), "\n\n").trim()
    }

    fun siteOf(url: String): String = runCatching { java.net.URI(url).host.orEmpty().removePrefix("www.") }.getOrDefault("")
}
