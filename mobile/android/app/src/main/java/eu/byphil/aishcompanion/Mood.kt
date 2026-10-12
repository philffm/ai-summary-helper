package eu.byphil.aishcompanion

import android.content.Context

/** Mood of a feed item, as in the browser extension's Feeds view: from the item's sentiment (-1 very heavy … 1 very good). */
object Mood {
    const val THRESHOLD = 0.15

    /** "pos", "neu" or "neg"; null when the item has not been rated. */
    fun of(sent: Double?): String? = when {
        sent == null -> null
        sent >= THRESHOLD -> "pos"
        sent <= -THRESHOLD -> "neg"
        else -> "neu"
    }

    /** The rating if there is one; otherwise the word list's guess ("neg" for heavy headlines, null = unknown). */
    fun effective(e: FeedEntryRef): String? =
        of(e.stored.sent) ?: if (GoodNews.heavy(e.stored.item.title + " " + BriefingBuilder.snippet(e.stored.item))) "neg" else null

    /** Hue for the row tint: green for good news through red for heavy news (same scale as the extension). */
    fun hue(sent: Double): Float = if (sent >= 0) (95 + sent * 45).toFloat() else (5 + (1 + sent) * 30).toFloat()
}

/** What the on-device model is asked to rate, and how its answer is read. Same prompt as the extension's cheapest mode. Pure, so it is unit-tested. */
object MoodPrompt {
    const val BATCH = 15
    const val SYSTEM = "You rate the sentiment of news headlines. For each numbered item return a whole number from -5 (very negative news) " +
        "through 0 (neutral) to 5 (very positive news), judged on the news content, not tone of voice. " +
        "Reply with ONLY the item number and its score, one pair per item, nothing else, like: 1:3 | 2:-2 | 3:0"

    fun user(items: List<FeedItem>): String = "Items:\n" + items.mapIndexed { i, it ->
        val snip = BriefingBuilder.snippet(it).take(120)
        "${i + 1}. ${it.title.replace(Regex("\\s+"), " ").trim()}" + if (snip.isNotBlank()) " - $snip" else ""
    }.joinToString("\n")

    /** "1:3 | 2:-2" → scores aligned to the [n] items, -1..1 (whole numbers are on the -5..5 scale, decimals are taken as -1..1); null where missing. */
    fun parse(text: String, n: Int): List<Double?> {
        val out = arrayOfNulls<Double>(n)
        val pair = Regex("(\\d+)\\s*[:=]\\s*([+-]?\\d*\\.?\\d+)")
        for (part in text.split(Regex("[|;\\n]"))) {
            val m = pair.find(part) ?: continue
            val k = m.groupValues[1].toIntOrNull()?.minus(1) ?: continue
            val raw = m.groupValues[2]
            val v = raw.toDoubleOrNull()?.let { if (raw.contains('.')) it else it / 5.0 } ?: continue
            if (k in 0 until n) out[k] = v.coerceIn(-1.0, 1.0)
        }
        return out.toList()
    }
}

object MoodRater {
    const val MAX_PER_RUN = 60
    const val MAX_AGE_MS = 7L * 24 * 3600_000

    /** Unrated items worth rating: recent (or undated), newest first (the list is already sorted that way), at most [MAX_PER_RUN]. */
    fun candidates(entries: List<FeedEntryRef>, now: Long): List<FeedEntryRef> =
        entries.filter { it.stored.sent == null && it.stored.item.title.isNotBlank() && (it.stored.item.published <= 0 || now - it.stored.item.published <= MAX_AGE_MS) }
            .take(MAX_PER_RUN)

    /** Rates unrated items with the on-device model and stores the ratings. Returns how many were rated. Blocking: call off the main thread. */
    fun rate(context: Context, store: FeedStore, entries: List<FeedEntryRef>, now: Long = System.currentTimeMillis()): Int {
        val todo = candidates(entries, now)
        if (todo.isEmpty() || !LocalLlm.installed(context)) return 0
        var rated = 0
        LocalLlm.session(context) { ask ->
            for (batch in todo.chunked(MoodPrompt.BATCH)) {
                val reply = ask(MoodPrompt.SYSTEM, MoodPrompt.user(batch.map { it.stored.item })) ?: break
                val scores = MoodPrompt.parse(reply, batch.size)
                val byFeed = HashMap<String, HashMap<String, Double>>()
                batch.forEachIndexed { i, e -> scores[i]?.let { byFeed.getOrPut(e.feed.url) { HashMap() }[e.stored.item.id] = it } }
                for ((url, ratings) in byFeed) { store.setRatings(url, ratings); rated += ratings.size }
            }
        }
        return rated
    }
}
