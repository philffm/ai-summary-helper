package eu.byphil.aishcompanion

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/** The shortcuts the system shows name actions the app answers to. */
class ShortcutsTest {
    @Test fun everyShortcutHasAnActionTheAppKnows() {
        val xml = File("src/main/res/xml/shortcuts.xml").readText()
        assertEquals(Shortcuts.ALL, Regex("android:action=\"([^\"]+)\"").findAll(xml).map { it.groupValues[1] }.toList())
    }
}
