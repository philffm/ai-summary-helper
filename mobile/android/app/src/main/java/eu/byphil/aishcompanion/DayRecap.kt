package eu.byphil.aishcompanion

import java.time.Instant
import java.time.ZoneId

/** The day recap at the top of Feeds: which stories go in, what the on-device model is asked, and how its reply is cleaned. Pure, unit-tested. */
object DayRecap {
    const val MAX_ITEMS = 20
    const val PER_FEED = 3
    private const val MIN_TODAY = 3
    private const val DAY_MS = 24L * 60 * 60 * 1000

    /** Today's stories (since local midnight), or the last 24 hours when today has fewer than three, best first: stories several feeds carry, then newer and starred ones, spread over the feeds (see [StoryRank]). At most [PER_FEED] per feed and [MAX_ITEMS] in all. */
    fun pickRanked(entries: List<FeedEntryRef>, now: Long, zone: ZoneId = ZoneId.systemDefault()): List<Ranked> {
        val midnight = Instant.ofEpochMilli(now).atZone(zone).toLocalDate().atStartOfDay(zone).toInstant().toEpochMilli()
        val dated = entries.filter { it.stored.item.published in 1..now }.sortedByDescending { it.stored.item.published }
        var pool = dated.filter { it.stored.item.published >= midnight }
        if (pool.size < MIN_TODAY) pool = dated.filter { it.stored.item.published >= now - DAY_MS }
        return StoryRank.rank(pool, now, DAY_MS, MAX_ITEMS, PER_FEED)
    }

    fun pick(entries: List<FeedEntryRef>, now: Long, zone: ZoneId = ZoneId.systemDefault()): List<FeedEntryRef> = pickRanked(entries, now, zone).map { it.lead }

    fun system(lang: String) = "You write a short recap of today's news from a list of headlines. " + SummaryLangs.rule(lang, "the headlines") + " Reply with plain text only: no title, no markdown, no emojis."

    /** [sources] is, per item, how many different feeds carry that story (1 when unknown). */
    fun user(items: List<FeedEntryRef>, sources: List<Int> = emptyList()): String {
        val list = items.withIndex().joinToString("\n") { (n, e) ->
            val i = e.stored.item
            val c = sources.getOrElse(n) { 1 }
            "- " + i.title.take(160) + " (" + e.feed.name.take(40) + (if (c > 1) ", covered by $c sources" else "") + ")" + (if (i.summary.isNotBlank() && i.summary != i.title) ": " + i.summary.take(140) else "")
        }
        val task = "Write the recap: first 2 or 3 sentences that say what today is about, then up to 5 lines, each starting with \"- \", for the most important stories. Stories covered by several sources are the bigger news: put them first. Use only what the list says."
        return "Today's headlines:\n$list\n\n$task"
    }

    /** The model's reply cleaned for display; null when it is empty or too short to be a recap. */
    fun cleanReply(reply: String?): String? {
        val t = PageSummary.clean(reply ?: return null) ?: return null
        return t.takeIf { it.length >= 40 }
    }
}
