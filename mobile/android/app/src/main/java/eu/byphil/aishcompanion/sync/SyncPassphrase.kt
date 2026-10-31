package eu.byphil.aishcompanion.sync

/** The one spelling every device derives a place's key from: the Kotlin side of canonicalPassphrase in the extension's syncPassphrase.js. */
object SyncPassphrase {
    private val SET = SyncWordlist.WORDS.toHashSet()
    private val SEPARATORS = Regex("[\\s\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF,;-]+")

    /**
     * A phrase made only of list words (four or more, separated by spaces, dashes or commas, any capitalisation) becomes lower-case words with single
     * spaces, so "Orbit-Lemon  TUNNEL …" opens what "orbit lemon tunnel …" created. Anything else is used exactly as typed.
     */
    fun canonical(input: String): String {
        val parts = input.trim().lowercase().split(SEPARATORS).filter { it.isNotEmpty() }
        return if (parts.size >= 4 && parts.all { it in SET }) parts.joinToString(" ") else input
    }
}
