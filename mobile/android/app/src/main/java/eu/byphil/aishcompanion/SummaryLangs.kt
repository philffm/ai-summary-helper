package eu.byphil.aishcompanion

/** Languages the on-device model can be asked to write summaries and recaps in. "" means: the language of the page (summaries) or of the headlines (recap). */
object SummaryLangs {
    val ALL: List<Pair<String, String>> = listOf(
        "" to "Same as the page", "en" to "English", "de" to "German", "es" to "Spanish", "fr" to "French", "it" to "Italian",
        "pt" to "Portuguese", "nl" to "Dutch", "pl" to "Polish", "tr" to "Turkish", "ru" to "Russian", "ja" to "Japanese", "zh" to "Chinese",
    )

    fun label(code: String): String = ALL.firstOrNull { it.first == code }?.second ?: ALL[0].second

    /** The sentence added to a prompt. [source] says what "the same" refers to when no language is set. */
    fun rule(code: String, source: String = "the page"): String {
        val name = ALL.firstOrNull { it.first == code && code.isNotEmpty() }?.second
        return if (name == null) "Reply in the language of $source." else "Reply in $name, whatever language $source is in."
    }
}
