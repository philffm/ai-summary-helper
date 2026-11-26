package eu.byphil.aishcompanion

/** A highlight along an article: its block, and from where to where it lies (0 = top, 1 = end). */
data class Spot(val block: Int, val from: Float, val to: Float, val ghost: Boolean)

/** A block on screen: how much of it lies above the screen's top edge, and above its bottom edge (both 0 to 1). */
data class Shown(val block: Int, val above: Float, val upTo: Float)

/** Where things lie along an article. Length is counted in characters. Pure, unit-tested (as DepthTrack.swift on iOS). */
object DepthTrack {
    private fun weight(b: Block) = maxOf(1, b.text.length)

    private fun starts(blocks: List<Block>): Pair<IntArray, Float> {
        val out = IntArray(blocks.size); var at = 0
        blocks.forEachIndexed { i, b -> out[i] = at; at += weight(b) }
        return out to maxOf(1, at).toFloat()
    }

    fun spots(blocks: List<Block>, marks: Map<Int, List<Mark>>): List<Spot> {
        val (start, total) = starts(blocks)
        return marks.entries.filter { it.key in blocks.indices }.sortedBy { it.key }.flatMap { (i, list) ->
            list.map { Spot(i, (start[i] + it.start) / total, minOf(1f, (start[i] + it.end) / total), it.ghost) }
        }
    }

    /** The part of the article on screen as (from, to), or null when no block is shown. */
    fun window(blocks: List<Block>, shown: List<Shown>): Pair<Float, Float>? {
        val on = shown.filter { it.block in blocks.indices }.sortedBy { it.block }
        if (on.isEmpty()) return null
        val (start, total) = starts(blocks)
        val first = on.first(); val last = on.last()
        val from = (start[first.block] + weight(blocks[first.block]) * first.above) / total
        val to = (start[last.block] + weight(blocks[last.block]) * last.upTo) / total
        return minOf(from, to) to minOf(1f, maxOf(from, to))
    }

    /** The block that lies at a fraction of the article, or null for an empty one. */
    fun blockAt(blocks: List<Block>, fraction: Float): Int? {
        if (blocks.isEmpty()) return null
        val (start, total) = starts(blocks)
        val at = fraction.coerceIn(0f, 1f) * total
        return start.indexOfLast { it <= at }.coerceAtLeast(0)
    }

    /** The highlight a finger at [fraction] means: the nearest one within [reach], else none. */
    fun near(spots: List<Spot>, fraction: Float, reach: Float): Spot? =
        spots.map { it to maxOf(it.from - fraction, fraction - it.to, 0f) }.minByOrNull { it.second }?.takeIf { it.second <= reach }?.first
}
