package eu.byphil.aishcompanion

/** Cuts a growing text into sentences to read aloud while the model is still writing. Pure, unit-tested. */
object SpeechChunker {
    private val BOUNDARY = Regex("(?<=[.!?…])[\"”')]*\\s+|\\n+")
    private val BULLET = Regex("^[\\s\\-*•]+")

    /** The finished sentences in [text] after position [from], and the position to continue from. With [last] the unfinished tail counts as a sentence too. */
    fun next(text: String, from: Int, last: Boolean): Pair<List<String>, Int> {
        var start = from.coerceIn(0, text.length)
        val out = ArrayList<String>()
        while (true) {
            val m = BOUNDARY.find(text, start) ?: break
            val s = text.substring(start, m.range.first).replace(BULLET, "").trim()
            if (s.isNotEmpty()) out.add(s)
            start = m.range.last + 1
        }
        if (last) {
            val s = text.substring(start).replace(BULLET, "").trim()
            if (s.isNotEmpty()) out.add(s)
            start = text.length
        }
        return out to start
    }
}
