package eu.byphil.aishcompanion

/** A story chosen for a recap or briefing: the newest item of it, and how many different sources told it. */
data class Ranked(val lead: FeedEntryRef, val sources: Int)

/**
 * Which stories matter most. The strongest sign that something is big news is that several independent sources report it, so
 * similar items are grouped first ([FeedStacks], the same grouping as the Feeds list) and a story's score is mostly the number of
 * different feeds that carry it. Newer, and starred, stories get a smaller boost. Then the best are taken one by one, each pick making the
 * next one from the same feed a little less likely, so one busy feed cannot fill the list. No word statistics are used: how long or
 * wordy a headline is says nothing about how important the story is.
 * Pure JVM, so it is unit-tested.
 */
object StoryRank {
    const val COVERAGE_CAP = 5          // more than five sources is not "more important"
    const val RECENCY_WEIGHT = 0.8
    const val FAV_BOOST = 0.4
    const val SAME_FEED_PENALTY = 0.3

    /** [pool] newest first. At most [limit] stories, at most [perFeed] led by the same feed, best first. [maxAgeMs] sets the scale of "newer". */
    fun rank(pool: List<FeedEntryRef>, now: Long, maxAgeMs: Long, limit: Int, perFeed: Int): List<Ranked> {
        if (pool.isEmpty() || limit <= 0) return emptyList()
        class Cand(val lead: FeedEntryRef, val sources: Int, val base: Double)
        val cands = FeedStacks.stack(pool).map { st ->
            val all = listOf(st.lead) + st.others
            val sources = all.map { it.feed.url }.distinct().size
            val age = (now - st.lead.stored.item.published).coerceIn(0L, maxAgeMs).toDouble() / maxAgeMs
            val base = (minOf(sources, COVERAGE_CAP) - 1) + RECENCY_WEIGHT * (1.0 - age) + (if (all.any { it.stored.fav }) FAV_BOOST else 0.0)
            Cand(st.lead, sources, base)
        }.toMutableList()
        val taken = HashMap<String, Int>()
        val out = ArrayList<Ranked>()
        while (out.size < limit) {
            val best = cands.filter { (taken[it.lead.feed.url] ?: 0) < perFeed }
                .maxByOrNull { it.base - SAME_FEED_PENALTY * (taken[it.lead.feed.url] ?: 0) } ?: break   // ties: the first one, i.e. the newer
            cands.remove(best)
            taken[best.lead.feed.url] = (taken[best.lead.feed.url] ?: 0) + 1
            out += Ranked(best.lead, best.sources)
        }
        return out
    }
}
