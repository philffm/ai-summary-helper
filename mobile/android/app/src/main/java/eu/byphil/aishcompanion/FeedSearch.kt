package eu.byphil.aishcompanion

/** Search over the stored feed items: every word of the query has to appear somewhere in title, teaser, text, feed name, author or tags (case-insensitive). */
object FeedSearch {
    fun words(query: String): List<String> = query.lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }

    fun matches(e: FeedEntryRef, query: String): Boolean {
        val w = words(query)
        if (w.isEmpty()) return true
        val item = e.stored.item
        val hay = (listOf(item.title, item.summary, item.body, item.author, e.feed.name) + e.feed.tags).joinToString("\n").lowercase()
        return w.all { it in hay }
    }
}
