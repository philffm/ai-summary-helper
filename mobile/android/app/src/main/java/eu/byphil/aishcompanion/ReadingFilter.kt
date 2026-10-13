package eu.byphil.aishcompanion

import java.text.Normalizer

/** Which part of the reading list is shown. */
enum class ReadingView { UNREAD, ALL, ARCHIVED }

/** Search and filter of the reading list. Pure, unit-tested; the article text is only fetched for entries the title/site/link did not already match. */
object ReadingFilter {
    private val MARKS = Regex("\\p{Mn}+")

    /** Lower case, accents removed: "Über" matches "uber". */
    fun fold(s: String): String = Normalizer.normalize(s, Normalizer.Form.NFD).replace(MARKS, "").lowercase()

    fun apply(
        list: List<ArticleMeta>, query: String, view: ReadingView,
        isRead: (String) -> Boolean, isArchived: (String) -> Boolean, textOf: (String) -> String,
    ): List<ArticleMeta> {
        val words = fold(query).split(Regex("\\s+")).filter { it.isNotEmpty() }
        return list.filter { a ->
            val archived = isArchived(a.id)
            val inView = when (view) {
                ReadingView.ARCHIVED -> archived
                ReadingView.UNREAD -> !archived && !isRead(a.id)
                ReadingView.ALL -> !archived
            }
            inView && matches(a, words, textOf)
        }
    }

    private fun matches(a: ArticleMeta, words: List<String>, textOf: (String) -> String): Boolean {
        if (words.isEmpty()) return true
        val head = fold(a.title + " " + a.site + " " + a.url)
        if (words.all { it in head }) return true
        val full = head + " " + fold(textOf(a.id))
        return words.all { it in full }
    }
}
