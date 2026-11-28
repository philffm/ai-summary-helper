package eu.byphil.aishcompanion

/** A marked range inside one block's text. */
data class Mark(val start: Int, val end: Int, val ghost: Boolean)

/**
 * Finds the highlighted passages in an article's blocks. A passage is marked once, in the first block that contains the same
 * words (whitespace may differ); passages that span two blocks stay out of the text and appear only in the Highlights list.
 */
object Highlighter {
    private val SPACES = Regex("\\s+")

    /** The whole words a selection touches, without the space and punctuation around them; null when it holds no word. */
    fun wholeWords(text: String, start: Int, end: Int): IntRange? {
        val words = java.text.BreakIterator.getWordInstance().apply { setText(text) }
        var first = -1; var last = -1
        var from = words.first(); var to = words.next()
        while (to != java.text.BreakIterator.DONE) {
            if (from < end && to > start && (from until to).any { Character.isLetterOrDigit(text.codePointAt(it)) }) {
                if (first < 0) first = from
                last = to
            }
            from = to; to = words.next()
        }
        return if (first < 0) null else first until last
    }

    /** The number an anchor gives block [index]: pictures are not counted, so that anchors hold when an article gains them. */
    fun anchorOf(blocks: List<Block>, index: Int): Int = blocks.take(index).count { it.type != "img" }

    /** [anchors] say where the reader marked the words on this phone (text block as [anchorOf] counts, to start), so a repeated word stays where it was marked. */
    fun place(blocks: List<Block>, highlights: List<Highlight>, anchors: Map<String, Pair<Int, Int>> = emptyMap()): Map<Int, List<Mark>> {
        val out = HashMap<Int, MutableList<Mark>>()
        val text = blocks.indices.filter { blocks[it].type != "img" }
        for (h in highlights) {
            val words = h.text.trim().split(SPACES).filter { it.isNotEmpty() }
            if (words.isEmpty()) continue
            val re = Regex(words.joinToString("\\s+") { Regex.escape(it) })
            val anchor = anchors[h.text]
            if (anchor != null) {
                val (i, at) = anchor
                val j = text.getOrNull(i) ?: -1
                val m = blocks.getOrNull(j)?.takeIf { it.type != "pre" && at in 0..it.text.length }?.let { re.matchAt(it.text, at) }
                if (m != null) {
                    val list = out.getOrPut(j) { ArrayList() }
                    if (list.none { m.range.first < it.end && m.range.last + 1 > it.start }) list.add(Mark(m.range.first, m.range.last + 1, h.ghost))
                    continue
                }
            }
            for ((i, b) in blocks.withIndex()) {
                if (b.type == "pre" || b.type == "img") continue
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
