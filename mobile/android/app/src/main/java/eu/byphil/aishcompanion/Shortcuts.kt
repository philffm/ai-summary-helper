package eu.byphil.aishcompanion

/** The actions of the app's shortcuts (res/xml/shortcuts.xml): a long press on the icon, or an assistant. */
object Shortcuts {
    const val CONTINUE_READING = "eu.byphil.aishcompanion.action.CONTINUE_READING"
    const val BRIEFING = "eu.byphil.aishcompanion.action.BRIEFING"
    const val CONTINUE_EPISODE = "eu.byphil.aishcompanion.action.CONTINUE_EPISODE"
    val ALL = listOf(CONTINUE_READING, BRIEFING, CONTINUE_EPISODE)
}
