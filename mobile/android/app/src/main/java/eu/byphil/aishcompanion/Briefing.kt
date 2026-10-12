package eu.byphil.aishcompanion

import org.json.JSONArray
import org.json.JSONObject

/** One story in the morning briefing. [snippet] is the first sentence of the feed's own summary (may be empty). */
data class BriefingItem(val source: String, val title: String, val snippet: String, val link: String)

/**
 * The morning briefing: the freshest unread stories from the feeds, plus how many articles wait in the reading list.
 * No AI is involved; it is built from what the feeds say about themselves, so it works offline and can never fail at alarm time.
 * Pure JVM (no Android classes besides org.json), so it is unit-tested.
 */
data class Briefing(val items: List<BriefingItem>, val readingUnread: Int, val builtAt: Long) {

    /** Lines for the screen. */
    fun lines(): List<String> = items.map { "${it.source}: ${it.title}" }

    /** What the voice says, one part per sentence group, so reading can be stopped between parts. [hour] is the local hour (0–23). */
    fun spokenParts(hour: Int): List<String> {
        val greeting = when { hour < 5 -> "Hello."; hour < 12 -> "Good morning."; hour < 18 -> "Good afternoon."; else -> "Good evening." }
        val parts = ArrayList<String>()
        parts += if (items.isEmpty()) "$greeting Nothing new in your feeds." else "$greeting " + (if (items.size == 1) "One new story from your feeds." else "${items.size} new stories from your feeds.")
        items.forEachIndexed { i, it ->
            val head = "${i + 1}. ${it.source}: ${endSentence(it.title)}"
            parts += if (it.snippet.isBlank()) head else "$head ${endSentence(it.snippet)}"
        }
        if (readingUnread > 0) parts += "You also have $readingUnread unread " + (if (readingUnread == 1) "article" else "articles") + " in your reading list."
        return parts
    }

    fun toJson(): String = JSONObject()
        .put("builtAt", builtAt).put("readingUnread", readingUnread)
        .put("items", JSONArray(items.map { JSONObject().put("s", it.source).put("t", it.title).put("n", it.snippet).put("l", it.link) }))
        .toString()

    companion object {
        fun fromJson(text: String?): Briefing? = runCatching {
            val o = JSONObject(text ?: return null)
            val a = o.getJSONArray("items")
            Briefing(
                (0 until a.length()).map { a.getJSONObject(it) }.map { BriefingItem(it.optString("s"), it.optString("t"), it.optString("n"), it.optString("l")) },
                o.optInt("readingUnread"), o.optLong("builtAt"),
            )
        }.getOrNull()

        private fun endSentence(s: String): String {
            val t = s.trim()
            return if (t.isEmpty() || t.last() in ".!?…:;") t else "$t."
        }
    }
}

object BriefingBuilder {
    const val MAX_ITEMS = 7
    const val PER_FEED = 2
    const val FRESH_MS = 36L * 3600_000
    const val FALLBACK_MS = 7L * 24 * 3600_000
    const val SNIPPET_MAX = 160

    /**
     * Unread stories, newest first, at most [perFeed] per feed and [limit] in all. Takes stories from the last 36 hours;
     * if there are none, from the last 7 days, so a quiet weekend still gives something. Stories without a date are skipped.
     */
    fun pick(entries: List<FeedEntryRef>, now: Long, limit: Int = MAX_ITEMS, perFeed: Int = PER_FEED): List<BriefingItem> {
        val unread = entries.filter { !it.stored.read && it.stored.item.title.isNotBlank() && it.stored.item.published > 0 }
            .sortedByDescending { it.stored.item.published }
        fun take(maxAge: Long): List<BriefingItem> {
            val perCount = HashMap<String, Int>()
            val out = ArrayList<BriefingItem>()
            for (e in unread) {
                if (out.size >= limit) break
                if (now - e.stored.item.published > maxAge) continue
                val n = perCount[e.feed.url] ?: 0
                if (n >= perFeed) continue
                perCount[e.feed.url] = n + 1
                val item = e.stored.item
                out += BriefingItem(e.feed.name, oneLine(item.title), snippet(item), item.link)
            }
            return out
        }
        return take(FRESH_MS).ifEmpty { take(FALLBACK_MS) }
    }

    fun build(entries: List<FeedEntryRef>, readingUnread: Int, now: Long): Briefing = Briefing(pick(entries, now), readingUnread, now)

    private fun oneLine(s: String): String = s.replace(Regex("\\s+"), " ").trim()

    /** The first sentence of the summary (or body), cut at a word boundary; empty when it only repeats the title. */
    fun snippet(item: FeedItem): String {
        val text = oneLine(item.summary.ifBlank { item.body })
        if (text.isEmpty()) return ""
        val end = Regex("[.!?](\\s|$)").find(text)?.let { it.range.first + 1 } ?: text.length
        var s = text.substring(0, end)
        if (s.length > SNIPPET_MAX) {
            val cut = s.lastIndexOf(' ', SNIPPET_MAX)
            s = s.substring(0, if (cut > 40) cut else SNIPPET_MAX).trimEnd(',', ';', ':', ' ') + "…"
        }
        val title = oneLine(item.title).lowercase()
        if (s.length < 20 || s.lowercase().startsWith(title.take(40)) || title.startsWith(s.lowercase().trimEnd('…', '.').take(40))) return ""
        return s
    }
}
