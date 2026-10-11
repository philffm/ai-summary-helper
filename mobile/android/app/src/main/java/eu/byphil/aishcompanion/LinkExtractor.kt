package eu.byphil.aishcompanion

import java.net.URI

/** The share sheet hands over free text ("Great read: https://… "). Only the first http(s) link is sent. */
object LinkExtractor {
    const val MAX_LENGTH = 2048
    private val URL = Regex("https?://[^\\s<>\"']+", RegexOption.IGNORE_CASE)

    fun firstLink(text: String?): String? {
        if (text.isNullOrBlank()) return null
        val raw = URL.find(text)?.value?.trimEnd('.', ',', ';', ':', '!', '?', ')', ']') ?: return null
        if (raw.length > MAX_LENGTH) return null
        return try {
            val u = URI(raw)
            if ((u.scheme == "http" || u.scheme == "https") && !u.host.isNullOrEmpty()) raw else null
        } catch (_: Exception) { null }
    }
}
