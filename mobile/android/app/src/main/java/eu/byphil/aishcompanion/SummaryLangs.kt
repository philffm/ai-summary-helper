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

    /**
     * The one language for a recap or briefing, which mixes headlines from several feeds: the language chosen in Settings, or, when that is
     * "Same as the page" (which means nothing for a mix), the phone's language, or English when that is not on the list.
     */
    private fun feedEntry(code: String, device: String) =
        ALL.firstOrNull { it.first == code && code.isNotEmpty() } ?: ALL.firstOrNull { it.first == device && device.isNotEmpty() } ?: ALL.first { it.first == "en" }

    fun feedLanguage(code: String, device: String = java.util.Locale.getDefault().language): String = feedEntry(code, device).second

    /** The voice for reading such a text aloud: the same language the text was written in. */
    fun feedLocale(code: String, device: String = java.util.Locale.getDefault().language): java.util.Locale = java.util.Locale.forLanguageTag(feedEntry(code, device).first)

    /** The prompt sentence for such a mix: one language, and headlines in other languages are translated, not copied. */
    fun feedRule(code: String, device: String = java.util.Locale.getDefault().language): String {
        val name = feedLanguage(code, device)
        return "Write everything in $name. Headlines in other languages must be translated into $name; never copy a headline in another language."
    }
}
