package eu.byphil.aishcompanion

import org.json.JSONArray
import org.json.JSONObject

/** What the alarm wakes you with. */
enum class WakeMode { BRIEFING, ARTICLE, REMEMBER;
    companion object { fun of(name: String?): WakeMode = entries.firstOrNull { it.name == name } ?: BRIEFING }
}

/** A highlight with one word left out. */
data class Cloze(val before: String, val answer: String, val after: String)

/** A highlight that can be asked for. */
data class Card(val articleId: String, val title: String, val text: String) { val key: String get() = "$articleId\n$text" }

/** When a highlight is asked again: the day (days since 1970) and how often it was known in a row. */
data class Memo(val due: Long, val step: Int)

/**
 * "Remember?": one of your own highlights with a word missing. No AI: the word is one of the longest in the passage.
 * Known ones come back after 2, 4, 8 … 64 days, the others the next day. Pure, unit-tested; Recall.swift does the same.
 */
object Recall {
    private val WORD = Regex("[\\p{L}\\p{N}][\\p{L}\\p{M}\\p{N}'’-]*")
    private val COMMON = setOf(
        "about", "after", "again", "their", "there", "these", "those", "which", "while", "would", "could", "should", "being", "where", "other", "because", "before", "between",
        "nicht", "einen", "einer", "eines", "einem", "dieser", "diese", "dieses", "werden", "wurde", "haben", "hatte", "können", "könnte", "müssen", "sollte", "zwischen", "während",
    )
    private val WAIT = longArrayOf(2, 4, 8, 16, 32, 64)

    /** Null when the passage is too short to ask about. The same [seed] leaves out the same word. */
    fun cloze(text: String, seed: Int): Cloze? {
        val words = WORD.findAll(text).toList()
        if (words.size < 5) return null
        val longest = words.filter { w -> w.value.length >= 5 && w.value.lowercase() !in COMMON && w.value.any { it.isLetter() } }
            .sortedByDescending { it.value.length }.take(3)
        if (longest.isEmpty()) return null
        val w = longest[Math.floorMod(seed, longest.size)]
        return Cloze(text.substring(0, w.range.first), w.value, text.substring(w.range.last + 1))
    }

    /** A highlight that is due: one never asked comes before one asked earlier. Null when none is due. */
    fun pick(cards: List<Card>, memos: Map<String, Memo>, day: Long, seed: Int): Card? {
        val usable = cards.filter { cloze(it.text, seed) != null && (memos[it.key]?.due ?: 0) <= day }
        val fresh = usable.filter { it.key !in memos }
        val pool = fresh.ifEmpty { usable }
        return if (pool.isEmpty()) null else pool[Math.floorMod(seed, pool.size)]
    }

    fun answer(memo: Memo?, knew: Boolean, day: Long): Memo {
        if (!knew) return Memo(day + 1, 0)
        val step = memo?.step ?: 0
        return Memo(day + WAIT[minOf(step, WAIT.size - 1)], step + 1)
    }
}

/**
 * What this ring shows and says, chosen once when the alarm starts so that the ringing service and the screen agree.
 * For [WakeMode.BRIEFING] the briefing itself holds the content. [lines] are shown, [parts] are spoken.
 */
data class Wake(
    val mode: WakeMode, val builtAt: Long, val articleId: String = "", val title: String = "", val source: String = "",
    val lines: List<String> = emptyList(), val parts: List<String> = emptyList(), val cloze: Cloze? = null, val key: String = "", val lang: String = "",
) {
    fun toJson(): String = JSONObject().put("m", mode.name).put("at", builtAt).put("a", articleId).put("t", title).put("s", source)
        .put("l", JSONArray(lines)).put("p", JSONArray(parts)).put("k", key).put("g", lang)
        .apply { cloze?.let { put("c", JSONArray(listOf(it.before, it.answer, it.after))) } }.toString()

    companion object {
        private const val MAX_PARTS = 200

        fun briefing(now: Long) = Wake(WakeMode.BRIEFING, now)

        fun fromJson(text: String?): Wake? = runCatching {
            val o = JSONObject(text ?: return null)
            fun list(name: String) = o.optJSONArray(name)?.let { a -> (0 until a.length()).map { a.getString(it) } }.orEmpty()
            Wake(WakeMode.of(o.getString("m")), o.getLong("at"), o.optString("a"), o.optString("t"), o.optString("s"), list("l"), list("p"),
                o.optJSONArray("c")?.let { Cloze(it.getString(0), it.getString(1), it.getString(2)) }, o.optString("k"), o.optString("g"))
        }.getOrNull()

        private fun greeting(hour: Int) = when { hour < 5 -> "Hello."; hour < 12 -> "Good morning."; hour < 18 -> "Good afternoon."; else -> "Good evening." }
        private fun sentence(s: String) = s.trim().let { if (it.isEmpty() || it.last() in ".!?…:;") it else "$it." }

        /** One unread article; any article when all are read. Null for an empty library. */
        fun <T> randomArticle(all: List<T>, unread: (T) -> Boolean, seed: Int): T? {
            val pool = all.filter(unread).ifEmpty { all }
            return if (pool.isEmpty()) null else pool[Math.floorMod(seed, pool.size)]
        }

        fun article(article: Article, hour: Int, now: Long): Wake {
            val title = article.title.ifBlank { article.site.ifBlank { article.url } }
            val parts = listOf("${greeting(hour)} From your reading list: ${sentence(title)}") + ReadAloudUnits.article("", article.blocks)
            return Wake(WakeMode.ARTICLE, now, article.id, title, article.site, article.blocks.filter { it.type != "pre" && it.type != "img" }.take(6).map { it.text }, parts.take(MAX_PARTS), lang = article.lang)
        }

        fun remember(card: Card, seed: Int, lang: String, hour: Int, now: Long): Wake? {
            val c = Recall.cloze(card.text, seed) ?: return null
            // the pause where the word is missing; the voice must not say it
            return Wake(WakeMode.REMEMBER, now, card.articleId, card.title, "", listOf(card.text), listOf("${greeting(hour)} Do you remember?", sentence("${c.before}… ${c.after}")), c, card.key, lang)
        }
    }
}
