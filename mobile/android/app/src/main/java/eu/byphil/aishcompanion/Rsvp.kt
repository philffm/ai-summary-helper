package eu.byphil.aishcompanion

/** Speed reading (RSVP): one word at a time at a steady pace. Pure, unit-tested. */
object Rsvp {
    const val MIN_WPM = 150
    const val MAX_WPM = 900

    /** The words of an article in reading order: headings and paragraphs, no code blocks. */
    fun words(blocks: List<Block>): List<String> =
        blocks.filter { it.type != "pre" }.flatMap { it.text.trim().split(Regex("\\s+")) }.filter { it.isNotEmpty() }

    /** How long a word stays on screen: base pace, longer after punctuation and for long words. */
    fun delayMs(word: String, wpm: Int): Long {
        val base = 60_000.0 / wpm.coerceIn(MIN_WPM, MAX_WPM)
        val stripped = word.trimEnd('"', '”', '\'', ')', '’')
        val factor = when {
            stripped.endsWith(".") || stripped.endsWith("!") || stripped.endsWith("?") || stripped.endsWith("…") -> 2.0
            stripped.endsWith(",") || stripped.endsWith(";") || stripped.endsWith(":") || stripped.endsWith("—") || stripped.endsWith("–") -> 1.5
            word.length > 12 -> 1.5
            word.length > 8 -> 1.2
            else -> 1.0
        }
        return (base * factor).toLong().coerceAtLeast(30)
    }

    /** Index of the letter to anchor on ("optimal recognition point"): about a third into the word, skipping leading punctuation. */
    fun pivot(word: String): Int {
        val lead = word.indexOfFirst { it.isLetterOrDigit() }.let { if (it < 0) 0 else it }
        val letters = word.drop(lead).takeWhile { it.isLetterOrDigit() || it == '\'' || it == '’' || it == '-' }.length
        val p = when { letters <= 1 -> 0; letters <= 5 -> 1; letters <= 9 -> 2; letters <= 13 -> 3; else -> 4 }
        return lead + p.coerceAtMost((word.length - lead - 1).coerceAtLeast(0))
    }

    /** Minutes left at this pace, for the progress line. */
    fun minutesLeft(wordsLeft: Int, wpm: Int): Int = ((wordsLeft + wpm - 1) / wpm.coerceAtLeast(1))
}
