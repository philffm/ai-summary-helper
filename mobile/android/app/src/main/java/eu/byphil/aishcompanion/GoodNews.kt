package eu.byphil.aishcompanion

/**
 * A plain word list (English and German) for "good news only": headlines about war, violence, crime, disasters, accidents and death
 * are left out. It is deliberately crude, a safety net; with the on-device model switched on, the model is also told to leave
 * such stories out and does the real judging. Pure, so it is unit-tested.
 */
object GoodNews {
    private val exact = setOf(
        "war", "wars", "dead", "death", "deaths", "dies", "died", "dying", "shot", "crash", "crashes", "crashed", "fire", "fires", "kills", "toll",
        "krieg", "kriege", "tod", "tot", "tote", "toter", "tode", "brand", "flut", "opfer", "toten",
    )
    private val stems = listOf(
        "kill", "murder", "attack", "shoot", "bomb", "terror", "earthquake", "flood", "wildfire", "disaster", "crisis", "collaps", "scandal",
        "arrest", "abus", "stabb", "hostage", "explo", "victim", "casualt", "invasion", "sanction", "recession", "layoff", "genocide",
        "massacre", "tragedy", "tragic", "fatal", "injur", "crimin", "convict", "lawsuit", "outbreak", "famine", "threat",
        "getötet", "ermordet", "mord", "angriff", "anschlag", "schüsse", "unfall", "erdbeben", "überschwemm", "katastroph", "krise",
        "skandal", "festgenomm", "missbrauch", "vergewalt", "geisel", "explosion", "sanktion", "rezession", "entlassung", "absturz",
        "leiche", "messer", "tödlich", "verletzt", "verurteilt", "klage", "ausbruch", "hungersnot", "bedrohung", "terror",
    )
    private val pattern = Regex("(?<![\\p{L}\\p{N}])(?:(?:" + exact.joinToString("|") + ")(?![\\p{L}\\p{N}])|(?:" + stems.joinToString("|") + "))", RegexOption.IGNORE_CASE)

    fun heavy(text: String): Boolean = pattern.containsMatchIn(text)
}
