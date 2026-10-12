package eu.byphil.aishcompanion

import java.time.Instant
import java.time.ZoneId

/** The day recap at the top of Feeds: which stories go in, what the on-device model is asked, and how its reply is cleaned. Pure, unit-tested. */
object DayRecap {
    const val MAX_ITEMS = 20
    const val PER_FEED = 3
    private const val MIN_TODAY = 3
    private const val DAY_MS = 24L * 60 * 60 * 1000

    /** Today's stories (since local midnight), or the last 24 hours when today has fewer than three; newest first, at most [PER_FEED] per feed and [MAX_ITEMS] in all. */
    fun pick(entries: List<FeedEntryRef>, now: Long, zone: ZoneId = ZoneId.systemDefault()): List<FeedEntryRef> {
        val midnight = Instant.ofEpochMilli(now).atZone(zone).toLocalDate().atStartOfDay(zone).toInstant().toEpochMilli()
        val dated = entries.filter { it.stored.item.published in 1..now }.sortedByDescending { it.stored.item.published }
        var pool = dated.filter { it.stored.item.published >= midnight }
        if (pool.size < MIN_TODAY) pool = dated.filter { it.stored.item.published >= now - DAY_MS }
        val perFeed = HashMap<String, Int>()
        val out = ArrayList<FeedEntryRef>()
        for (e in pool) {
            val n = perFeed.getOrDefault(e.feed.url, 0)
            if (n >= PER_FEED) continue
            perFeed[e.feed.url] = n + 1
            out.add(e)
            if (out.size >= MAX_ITEMS) break
        }
        return out
    }

    fun system(lang: String) = "You write a short recap of today's news from a list of headlines. " + SummaryLangs.rule(lang, "the headlines") + " Reply with plain text only: no title, no markdown, no emojis."

    fun user(items: List<FeedEntryRef>): String {
        val list = items.joinToString("\n") { e ->
            val i = e.stored.item
            "- " + i.title.take(160) + " (" + e.feed.name.take(40) + ")" + (if (i.summary.isNotBlank() && i.summary != i.title) ": " + i.summary.take(140) else "")
        }
        val task = "Write the recap: first 2 or 3 sentences that say what today is about, then up to 5 lines, each starting with \"- \", for the most important stories. Use only what the list says."
        return "Today's headlines:\n$list\n\n$task"
    }

    /** The model's reply cleaned for display; null when it is empty or too short to be a recap. */
    fun cleanReply(reply: String?): String? {
        val t = PageSummary.clean(reply ?: return null) ?: return null
        return t.takeIf { it.length >= 40 }
    }
}
