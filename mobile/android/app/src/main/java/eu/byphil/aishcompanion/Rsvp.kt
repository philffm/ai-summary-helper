package eu.byphil.aishcompanion

/**
 * Speed reading (RSVP): one word at a time, the sentence it belongs to shown above it. Pure, unit-tested.
 * Same rules as the extension (plugin/src/modules/rsvp.js), so both read alike: 300 WPM default (150–600), longer pauses
 * after punctuation, long words and headings, the first words a little slower, the eye anchored a third into the word.
 */
object Rsvp {
    const val MIN_WPM = 150
    const val MAX_WPM = 600          // above ~400 WPM comprehension drops (Di Nocera et al. 2018)
    const val DEFAULT_WPM = 300
    const val STEP_WPM = 25
    private const val RAMP_WORDS = 10 // the first words come at 70 % speed while the eye settles in

    data class Word(val w: String, val s: Int)
    data class Sentence(val text: String, val p: Int, val first: Int, val last: Int, val heading: Boolean)
    data class Built(val words: List<Word>, val sentences: List<Sentence>, val paragraphs: List<List<Int>>)

    private val SENTENCE_END = Regex("(?<=[.!?…])\\s+(?=[\\p{Lu}\\p{N}\"„“‚(\\[])")
    private val HEADING = Regex("h[1-6]")

    fun clampWpm(wpm: Int): Int = wpm.coerceIn(MIN_WPM, MAX_WPM)

    /** Blocks (headings and paragraphs, no code) → words, sentences and paragraphs in reading order. */
    fun build(blocks: List<Block>): Built {
        val words = mutableListOf<Word>(); val sentences = mutableListOf<Sentence>(); val paragraphs = mutableListOf<List<Int>>()
        for (b in blocks) {
            if (b.type == "pre") continue
            val text = b.text.replace(Regex("\\s+"), " ").trim()
            if (text.isEmpty()) continue
            val heading = HEADING.matches(b.type)
            val parts = if (heading) listOf(text) else text.split(SENTENCE_END)
            val p = paragraphs.size; val inPara = mutableListOf<Int>()
            for (part in parts) {
                val ws = part.split(' ').filter { it.isNotEmpty() }
                if (ws.isEmpty()) continue
                val s = sentences.size
                sentences += Sentence(part, p, words.size, words.size + ws.size - 1, heading)
                ws.forEach { words += Word(it, s) }
                inPara += s
            }
            if (inPara.isNotEmpty()) paragraphs += inPara
        }
        return Built(words, sentences, paragraphs)
    }

    /** The words of an article in reading order: headings and paragraphs, no code blocks. */
    fun words(blocks: List<Block>): List<String> = build(blocks).words.map { it.w }

    /** How long a word stays on screen: base pace, longer after punctuation, for long words and at the end of a heading. */
    fun delayMs(word: String, wpm: Int, index: Int = RAMP_WORDS, heading: Boolean = false): Long {
        var base = 60_000.0 / clampWpm(wpm)
        if (index < RAMP_WORDS) base /= 0.7
        val stripped = word.trimEnd('"', '”', '\'', ')', '’', ']')
        val factor = when {
            heading -> 2.5
            stripped.endsWith(".") || stripped.endsWith("!") || stripped.endsWith("?") || stripped.endsWith("…") -> 2.0
            stripped.endsWith(",") || stripped.endsWith(";") || stripped.endsWith(":") || stripped.endsWith("—") || stripped.endsWith("–") -> 1.5
            word.length > 12 -> 1.5
            word.length > 8 -> 1.2
            else -> 1.0
        }
        return Math.round(base * factor).coerceAtLeast(30)
    }

    /** Index of the letter to anchor on ("optimal recognition point"): about a third into the word, skipping leading punctuation. */
    fun pivot(word: String): Int {
        val lead = word.indexOfFirst { it.isLetterOrDigit() }.let { if (it < 0) 0 else it }
        val letters = word.drop(lead).takeWhile { it.isLetterOrDigit() || it == '\'' || it == '’' || it == '-' }.length
        val p = when { letters <= 1 -> 0; letters <= 5 -> 1; letters <= 9 -> 2; letters <= 13 -> 3; else -> 4 }
        return lead + p.coerceAtMost((word.length - lead - 1).coerceAtLeast(0))
    }

    /** Seconds left from word [at] to the end at this pace (the base pace plus the punctuation pauses). */
    fun secondsLeft(b: Built, at: Int, wpm: Int): Int {
        var ms = 0L
        for (i in at.coerceAtLeast(0) until b.words.size) ms += delayMs(b.words[i].w, wpm, i, b.sentences.getOrNull(b.words[i].s)?.heading == true)
        return Math.round(ms / 1000.0).toInt()
    }

    /** First word of the sentence that holds word [at], moved by [delta] sentences; going back from the middle of a sentence first goes to its start. */
    fun sentenceStart(b: Built, at: Int, delta: Int): Int {
        if (b.words.isEmpty()) return 0
        val cur = b.words[at.coerceIn(0, b.words.size - 1)].s
        var target = (cur + delta).coerceIn(0, b.words.last().s)
        if (delta < 0) {
            val startOfCur = b.words.indexOfFirst { it.s == cur }
            if (at > startOfCur + 1) target = cur
        }
        val i = b.words.indexOfFirst { it.s >= target }
        return if (i < 0) b.words.size - 1 else i
    }

    /** Minutes left at this pace, for the progress line. */
    fun minutesLeft(wordsLeft: Int, wpm: Int): Int = ((wordsLeft + wpm - 1) / wpm.coerceAtLeast(1))
}
