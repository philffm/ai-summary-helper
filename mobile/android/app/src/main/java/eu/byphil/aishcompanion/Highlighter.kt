package eu.byphil.aishcompanion

/** A marked range inside one block's text. */
data class Mark(val start: Int, val end: Int, val ghost: Boolean)

/**
 * Finds the highlighted passages in an article's blocks. A passage is marked once, in the first block that contains the same
 * words (whitespace may differ); passages that span two blocks stay out of the text and appear only in the Highlights list.
 */
object Highlighter {
    private val SPACES = Regex("\\s+")

    fun place(blocks: List<Block>, highlights: List<Highlight>): Map<Int, List<Mark>> {
        val out = HashMap<Int, MutableList<Mark>>()
        for (h in highlights) {
            val words = h.text.trim().split(SPACES).filter { it.isNotEmpty() }
            if (words.isEmpty()) continue
            val re = Regex(words.joinToString("\\s+") { Regex.escape(it) })
            for ((i, b) in blocks.withIndex()) {
                if (b.type == "pre") continue
                val m = re.find(b.text) ?: continue
                val list = out.getOrPut(i) { ArrayList() }
                val start = m.range.first; val end = m.range.last + 1
                if (list.none { start < it.end && end > it.start }) list.add(Mark(start, end, h.ghost))
                break
            }
        }
        return out.mapValues { (_, v) -> v.sortedBy { it.start } }
    }
}
