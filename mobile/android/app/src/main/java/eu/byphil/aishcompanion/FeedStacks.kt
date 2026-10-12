package eu.byphil.aishcompanion

import java.text.Normalizer

/** A story and the other items about the same story. */
data class Stack(val lead: FeedEntryRef, val others: List<FeedEntryRef>)

/**
 * Groups near-identical feed items (the same story from several sources, or re-posts) into one stack. Same rules as the browser
 * extension (feedStacks.js): titles are compared as word sets, nothing leaves the phone, and the comparison is deliberately
 * conservative, because a missed stack is a small annoyance while a wrongly merged story hides news.
 */
object FeedStacks {
    const val WINDOW_MS = 48L * 3600 * 1000   // the same story appears within about two days
    const val DICE_MIN = 0.6                  // share of title words two titles have in common
    const val SHARED_MIN = 3                  // ... and at least this many words (CJK: bigrams)
    const val SHARED_MIN_CJK = 4

    private val STOP = ("the a an of to in on for and or at by with is are as from over after new says " +
        "der die das und im zu von mit für ein eine nach über neu el la los las de del y en un una por con " +
        "le les un une et du des pour dans il lo gli di da per con o os as um uma do da dos das и в на с по для").split(Regex("\\s+")).toSet()
    private val CJK = Regex("[\\p{IsHan}\\p{IsHiragana}\\p{IsKatakana}\\p{IsHangul}]")
    private val MARKS = Regex("\\p{M}")
    private val NUMBER = Regex("^\\p{N}+$")
    private val SPLIT = Regex("[^\\p{L}\\p{N}]+")

    class Tokens(val words: Set<String>, val nums: Set<String>, val cjk: Boolean)

    /** Lowercase, accents folded, CJK as character pairs, digits kept separately. */
    fun tokens(title: String): Tokens {
        val s = MARKS.replace(Normalizer.normalize(title, Normalizer.Form.NFKD), "").lowercase()
        val words = HashSet<String>(); val nums = HashSet<String>()
        var cjk = false
        for (w in s.split(SPLIT)) {
            if (w.isEmpty()) continue
            if (NUMBER.matches(w)) { nums.add(w); words.add(w); continue }
            if (CJK.containsMatchIn(w)) {
                cjk = true
                if (w.length == 1) words.add(w)
                for (k in 0 until w.length - 1) words.add(w.substring(k, k + 2))
                continue
            }
            if (w.length < 3 || w in STOP) continue
            words.add(w)
        }
        return Tokens(words, nums, cjk)
    }

    /** Do two titles describe the same story? */
    fun similar(a: Tokens, b: Tokens): Boolean {
        if (a.words.isEmpty() || b.words.isEmpty()) return false
        // "Matchday 3" and "Matchday 4": when both titles carry numbers they must carry the same ones.
        if (a.nums.isNotEmpty() && b.nums.isNotEmpty() && a.nums != b.nums) return false
        val shared = a.words.count { it in b.words }
        if (shared < (if (a.cjk || b.cjk) SHARED_MIN_CJK else SHARED_MIN)) return false
        return 2.0 * shared / (a.words.size + b.words.size) >= DICE_MIN
    }

    /**
     * [list] is in display order (newest first). Returns the stacks in that order; each lead is the newest item of its stack.
     * An item is compared with the lead of a stack, so chains of "almost the same" cannot keep growing one.
     */
    fun stack(list: List<FeedEntryRef>, windowMs: Long = WINDOW_MS): List<Stack> {
        val tok = list.map { tokens(it.stored.item.title) }
        val clusters = ArrayList<MutableList<Int>>()
        val clusterOf = IntArray(list.size) { -1 }
        val index = HashMap<String, MutableList<Int>>()
        fun at(i: Int) = list[i].stored.item.published
        for (i in list.indices) {
            var joined = -1
            if (tok[i].words.isNotEmpty()) {
                val hits = HashMap<Int, Int>()
                for (w in tok[i].words) {
                    val posting = index[w] ?: continue
                    // newest first: scan back from the closest in time and stop once an entry is outside the window
                    for (q in posting.indices.reversed()) {
                        val j = posting[q]
                        if (at(j) - at(i) > windowMs) break
                        hits[j] = (hits[j] ?: 0) + 1
                    }
                }
                val tried = HashSet<Int>()
                for (j in hits.entries.sortedByDescending { it.value }.map { it.key }) {
                    val c = clusterOf[j]
                    if (c < 0 || !tried.add(c)) continue
                    val lead = clusters[c][0]
                    if (Math.abs(at(lead) - at(i)) > windowMs) continue
                    if (similar(tok[i], tok[lead])) { joined = c; break }
                }
            }
            if (joined < 0) { clusters.add(mutableListOf(i)); joined = clusters.size - 1 } else clusters[joined].add(i)
            clusterOf[i] = joined
            for (w in tok[i].words) index.getOrPut(w) { ArrayList() }.add(i)
        }
        return clusters.map { idx -> Stack(list[idx[0]], idx.drop(1).map { list[it] }) }
    }
}
