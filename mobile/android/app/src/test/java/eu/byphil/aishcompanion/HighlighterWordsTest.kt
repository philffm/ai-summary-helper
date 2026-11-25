package eu.byphil.aishcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HighlighterWordsTest {
    private val text = "Sleep moves what you read, today. Über Nacht."
    private fun words(from: String): String? {
        val at = text.indexOf(from)
        return Highlighter.wholeWords(text, at, at + from.length)?.let { text.substring(it) }
    }

    @Test fun selectionBecomesWholeWords() {
        assertEquals("moves what", words("ves wh"))
        assertEquals("today", words(", tod"))
        assertEquals("Über", words("Üb"))
        assertNull(words(". "))
    }

    @Test fun aRepeatedWordStaysWhereItWasMarked() {
        val blocks = listOf(Block("p", "the cat and the dog"), Block("p", "the end"))
        val marks = Highlighter.place(blocks, listOf(Highlight(false, "the")), mapOf("the" to (0 to 12)))
        assertEquals(listOf(Mark(12, 15, false)), marks[0])
        assertNull(marks[1])
        // without a position, or when it no longer fits, the first place wins
        assertEquals(listOf(Mark(0, 3, false)), Highlighter.place(blocks, listOf(Highlight(false, "the")))[0])
        assertEquals(listOf(Mark(0, 3, false)), Highlighter.place(blocks, listOf(Highlight(false, "the")), mapOf("the" to (5 to 99)))[0])
    }
}
