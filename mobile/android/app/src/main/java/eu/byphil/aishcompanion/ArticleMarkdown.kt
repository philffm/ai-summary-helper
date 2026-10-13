package eu.byphil.aishcompanion

import java.time.Instant
import java.time.ZoneOffset

/** An article as one Markdown note: YAML front matter (like the extension's export), summary, text, highlights. Pure, unit-tested. */
object ArticleMarkdown {
    private fun yaml(v: String) = "\"" + v.replace("\\", "\\\\").replace("\"", "\\\"").replace(Regex("\\s*\\R\\s*"), " ").trim() + "\""

    fun render(a: Article, receivedAt: Long = 0, includeText: Boolean = true): String {
        val millis = if (a.sentAt > 0) a.sentAt else receivedAt
        val date = if (millis > 0) Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate().toString() else ""
        val sb = StringBuilder()
        sb.append("---\n")
        sb.append("title: ").append(yaml(a.title.ifBlank { a.url })).append('\n')
        sb.append("source: ").append(yaml(a.url)).append('\n')
        if (a.byline.isNotBlank()) sb.append("author: ").append(yaml(a.byline)).append('\n')
        if (a.site.isNotBlank()) sb.append("site: ").append(yaml(a.site)).append('\n')
        if (date.isNotEmpty()) sb.append("created: ").append(date).append('\n')
        sb.append("tags: []\n---\n\n")
        sb.append("# ").append(a.title.ifBlank { a.url }.replace('\n', ' ')).append("\n\n")
        if (a.summary.isNotBlank()) sb.append("## Summary\n\n").append(a.summary.trim()).append("\n\n")
        val own = a.highlights.filter { !it.ghost }
        val ai = a.highlights.filter { it.ghost }
        if (own.isNotEmpty()) { sb.append("## Highlights\n\n"); own.forEach { sb.append(quote(it.text)).append("\n\n") } }
        if (ai.isNotEmpty()) { sb.append("## AI highlights\n\n"); ai.forEach { sb.append(quote(it.text)).append("\n\n") } }
        if (includeText) {
            sb.append("## Original text\n\n")
            for (b in a.blocks) {
                when (b.type) {
                    "h1" -> sb.append("# ").append(b.text)
                    "h2" -> sb.append("## ").append(b.text)
                    "h3" -> sb.append("### ").append(b.text)
                    "li" -> sb.append("- ").append(b.text)
                    "q" -> sb.append(quote(b.text))
                    "pre" -> sb.append("```\n").append(b.text.trimEnd()).append("\n```")
                    else -> sb.append(b.text)
                }
                sb.append(if (b.type == "li") "\n" else "\n\n")
            }
            if (a.truncated) sb.append("*This long article was shortened. Read the original for the rest.*\n")
        }
        return sb.toString().trimEnd() + "\n"
    }

    private fun quote(t: String) = t.trim().lines().joinToString("\n") { "> $it" }

    /** A file name for the note: the title without characters that file systems and Obsidian reject. */
    fun fileName(title: String): String {
        val s = title.replace(Regex("[\\\\/:*?\"<>|#^\\[\\]\\u0000-\\u001f]"), " ").replace(Regex("\\s+"), " ").trim().trimStart('.').take(80).trim()
        return (s.ifEmpty { "Untitled" }) + ".md"
    }
}
