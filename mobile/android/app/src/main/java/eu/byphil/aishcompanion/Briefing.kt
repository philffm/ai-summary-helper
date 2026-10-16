package eu.byphil.aishcompanion

import org.json.JSONArray
import org.json.JSONObject

/** One story in the morning briefing. [snippet] is the first sentence of the feed's own summary (may be empty). */
data class BriefingItem(val source: String, val title: String, val snippet: String, val link: String, val sources: Int = 1)

/**
 * The morning briefing: the freshest unread stories from the feeds, plus how many articles wait in the reading list.
 * No AI is involved; it is built from what the feeds say about themselves, so it works offline and can never fail at alarm time.
 * Pure JVM (no Android classes besides org.json), so it is unit-tested.
 */
/** Which stories the briefing may contain. */
enum class NewsMode {
    ALL, NO_BAD, GOOD;
    companion object { fun of(name: String?): NewsMode = entries.firstOrNull { it.name == name } ?: ALL }
}

data class Briefing(val items: List<BriefingItem>, val readingUnread: Int, val builtAt: Long, val narration: String = "", val extra: String = "", val mode: NewsMode = NewsMode.ALL, val older: Boolean = false, val note: String = "") {

    /** Lines for the screen. */
    fun lines(): List<String> = items.map { "${it.source}: ${it.title}" }

    /** What the voice says, one part per sentence group, so reading can be stopped between parts. [hour] is the local hour (0–23). */
    fun spokenParts(hour: Int): List<String> {
        if (narration.isNotBlank()) return BriefingPrompt.chunks(narration) + BriefingPrompt.chunks(extra)
        val greeting = when { hour < 5 -> "Hello."; hour < 12 -> "Good morning."; hour < 18 -> "Good afternoon."; else -> "Good evening." }
        val parts = ArrayList<String>()
        val tail = BriefingPrompt.chunks(extra)
        parts += if (items.isEmpty()) "$greeting " + (when (mode) { NewsMode.GOOD -> "No good news in your feeds this morning."; NewsMode.NO_BAD -> "Nothing new without bad news in your feeds this morning."; NewsMode.ALL -> "Nothing new in your feeds." }) else if (older) "$greeting No new good news this morning, so here " + (if (items.size == 1) "is the latest good story." else "are the latest ${items.size} good stories.")
            else "$greeting " + (if (items.size == 1) "One new story from your feeds." else "${items.size} new stories from your feeds.")
        items.forEachIndexed { i, it ->
            val head = "${i + 1}. ${it.source}: ${endSentence(it.title)}"
            parts += if (it.snippet.isBlank()) head else "$head ${endSentence(it.snippet)}"
        }
        if (readingUnread > 0) parts += "You also have $readingUnread unread " + (if (readingUnread == 1) "article" else "articles") + " in your reading list."
        if (items.isEmpty() && note.isNotBlank()) parts += note
        parts += tail
        return parts
    }

    fun toJson(): String = JSONObject()
        .put("builtAt", builtAt).put("readingUnread", readingUnread).put("r", narration).put("x", extra).put("g", mode.name).put("o", older).put("d", note)
        .put("items", JSONArray(items.map { JSONObject().put("s", it.source).put("t", it.title).put("n", it.snippet).put("l", it.link).put("c", it.sources) }))
        .toString()

    companion object {
        fun fromJson(text: String?): Briefing? = runCatching {
            val o = JSONObject(text ?: return null)
            val a = o.getJSONArray("items")
            Briefing(
                (0 until a.length()).map { a.getJSONObject(it) }.map { BriefingItem(it.optString("s"), it.optString("t"), it.optString("n"), it.optString("l"), it.optInt("c", 1)) },
                o.optInt("readingUnread"), o.optLong("builtAt"), o.optString("r"), o.optString("x"), when (val g = o.opt("g")) { true -> NewsMode.GOOD; is String -> NewsMode.of(g); else -> NewsMode.ALL }, o.optBoolean("o", false), o.optString("d"),
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
    const val OLDEST_MS = 365L * 24 * 3600_000
    const val SNIPPET_MAX = 160

    /**
     * Unread stories, the biggest first (carried by most feeds, then newer and starred ones; see [StoryRank]), at most [perFeed] per feed and [limit] in all. Takes stories from the last 36 hours;
     * if there are none, from the last 7 days, so a quiet weekend still gives something. Stories without a date are skipped.
     */
    fun pick(entries: List<FeedEntryRef>, now: Long, limit: Int = MAX_ITEMS, perFeed: Int = PER_FEED, mode: NewsMode = NewsMode.ALL): List<BriefingItem> =
        pickWithAge(entries, now, limit, perFeed, mode).first

    /**
     * Like [pick], and true when the stories are older than usual: "good news only" with nothing positive in the last week shows the latest
     * positive stories there are (read or not, however old) instead of nothing.
     */
    fun pickWithAge(entries: List<FeedEntryRef>, now: Long, limit: Int = MAX_ITEMS, perFeed: Int = PER_FEED, mode: NewsMode = NewsMode.ALL): Pair<List<BriefingItem>, Boolean> {
        val dated = entries.filter { it.stored.item.title.isNotBlank() && it.stored.item.published > 0 }.sortedByDescending { it.stored.item.published }
        fun items(pool: List<FeedEntryRef>, maxAge: Long): List<BriefingItem> =
            StoryRank.rank(pool.filter { now - it.stored.item.published <= maxAge }, now, maxAge, limit, perFeed).map { r ->
                val item = r.lead.stored.item
                BriefingItem(r.lead.feed.name, oneLine(item.title), snippet(item), item.link, r.sources)
            }
        fun fresh(pool: List<FeedEntryRef>): List<BriefingItem> = items(pool, FRESH_MS).ifEmpty { items(pool, FALLBACK_MS) }
        val unread = dated.filter { !it.stored.read }
        // "Heavy" is the model's rating, else the word list. No bad news: those are left out. Good only: just stories rated positive;
        // when there are none at all, the best that is left (nothing heavy), so the briefing is never empty for lack of ratings.
        return when (mode) {
            NewsMode.ALL -> fresh(unread) to false
            NewsMode.NO_BAD -> fresh(unread.filter { Mood.effective(it) != "neg" }) to false
            NewsMode.GOOD -> {
                val positive = dated.filter { Mood.effective(it) == "pos" }
                val recent = fresh(positive.filter { !it.stored.read })
                if (recent.isNotEmpty()) recent to false
                else {
                    val latest = items(positive, OLDEST_MS)   // the latest good news there was, even from weeks ago and already read
                    if (latest.isNotEmpty()) latest to true else fresh(unread.filter { Mood.effective(it) != "neg" }) to false
                }
            }
        }
    }

    fun build(entries: List<FeedEntryRef>, readingUnread: Int, now: Long, mode: NewsMode = NewsMode.ALL, feeds: List<Feed> = emptyList()): Briefing {
        val (items, older) = pickWithAge(entries, now, mode = mode)
        return Briefing(items, readingUnread, now, mode = mode, older = older, note = if (items.isEmpty()) diagnose(feeds, entries, now) else "")
    }

    /** Why a briefing can be empty, in one or two plain sentences: stale feeds (the phone may be limiting this app in the background), failing feeds, or everything already read. */
    fun diagnose(feeds: List<Feed>, entries: List<FeedEntryRef>, now: Long): String {
        if (feeds.isEmpty()) return "No feeds yet."
        fun ago(ms: Long): String { val h = ms.coerceAtLeast(0) / 3600_000; return if (h < 1) "less than an hour ago" else if (h < 48) "$h hours ago" else "${h / 24} days ago" }
        val fetched = feeds.maxOf { it.lastFetched }
        val failed = feeds.count { it.error.isNotEmpty() }
        val unread = entries.count { !it.stored.read && it.stored.item.published > 0 && now - it.stored.item.published <= FALLBACK_MS }
        val sb = StringBuilder()
        if (fetched <= 0) sb.append("Your feeds have not been refreshed yet.")
        else {
            sb.append("Feeds last refreshed ${ago(now - fetched)}")
            if (failed > 0) sb.append(", $failed of ${feeds.size} could not be reached")
            sb.append(".")
        }
        val newest = entries.maxOfOrNull { it.stored.item.published } ?: 0L
        if (newest > 0) sb.append(" Newest story ${ago(now - newest)}; $unread unread from the last 7 days.")
        if (fetched <= 0 || now - fetched > 12 * 3600_000L) sb.append(" The phone may be limiting this app in the background: set its battery use to Unrestricted.")
        return sb.toString()
    }

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

/** What the on-device model is asked, and how its answer is cleaned up before it is spoken. Pure, so it is unit-tested. */
object BriefingPrompt {
    fun system(lang: String, device: String = java.util.Locale.getDefault().language) = "You write a short spoken news briefing for one listener, to be read aloud by a voice. " +
        "Use plain sentences only: no lists, no markdown, no emojis, no headings, no stage directions. " +
        "Cover each story in one or two sentences and join related stories naturally; stories marked as covered by several sources are the bigger news, so mention them first. " +
        "Use only the facts you are given; never add details, numbers or names that are not in the stories. " +
        "Keep it under 170 words. " + SummaryLangs.feedRule(lang, device)
    const val MAX_SNIPPET = 300
    const val MIN_REPLY = 40
    const val MAX_REPLY = 1800

    fun user(items: List<BriefingItem>, readingUnread: Int, hour: Int, mode: NewsMode = NewsMode.ALL): String {
        val time = when { hour < 12 -> "morning"; hour < 18 -> "afternoon"; else -> "evening" }
        val sb = StringBuilder("Time of day: $time. Begin with a short greeting that fits it.\nStories:\n")
        items.forEachIndexed { i, it ->
            sb.append(i + 1).append(". [").append(it.source).append(if (it.sources > 1) ", covered by ${it.sources} sources" else "").append("] ").append(it.title)
            if (it.snippet.isNotBlank()) sb.append(" - ").append(it.snippet.take(MAX_SNIPPET))
            sb.append('\n')
        }
        if (mode == NewsMode.NO_BAD) sb.append("Leave out anything about war, violence, crime, disasters, accidents, illness or death, even if it is listed; keep the other stories.\n")
        if (mode == NewsMode.GOOD) sb.append("Good news only: mention only positive, constructive or simply interesting stories. Leave out anything about war, violence, crime, disasters, accidents, illness or death, even if it is listed.\n")
        if (readingUnread > 0) sb.append("End by saying that $readingUnread unread ").append(if (readingUnread == 1) "article is" else "articles are").append(" waiting in the reading list.\n")
        return sb.toString()
    }

    /** Removes markdown the voice would read out, collapses spaces, and rejects replies that are empty, tiny or runaway long (null). */
    fun cleanReply(reply: String): String? {
        val t = reply.replace(Regex("(?m)^[ \\t]*(#{1,6}|[-*•]|\\d+[.)])\\s+"), "")
            .replace(Regex("[*_`#>]+"), "")
            .replace(Regex("[ \\t]+"), " ")
            .replace(Regex("\\n{3,}"), "\n\n")
            .trim()
        return if (t.length in MIN_REPLY..MAX_REPLY) t else null
    }

    /** Pieces of at most ~400 characters at sentence ends, so reading can be stopped between them. */
    fun chunks(text: String, max: Int = 400): List<String> {
        val out = ArrayList<String>()
        var cur = StringBuilder()
        for (sentence in text.split(Regex("(?<=[.!?])\\s+|\\n+")).map { it.trim() }.filter { it.isNotEmpty() }) {
            if (cur.isNotEmpty() && cur.length + sentence.length + 1 > max) { out += cur.toString(); cur = StringBuilder() }
            if (cur.isNotEmpty()) cur.append(' ')
            cur.append(sentence)
        }
        if (cur.isNotEmpty()) out += cur.toString()
        return out
    }
}
