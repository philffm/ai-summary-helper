package eu.byphil.aishcompanion

import org.junit.Assert.assertEquals
import org.junit.Test

class SpeechChunkerTest {
    @Test fun emitsOnlyFinishedSentences() {
        val (a, i) = SpeechChunker.next("The page is about a budget. It was voted on Tue", 0, false)
        assertEquals(listOf("The page is about a budget."), a)
        val (b, j) = SpeechChunker.next("The page is about a budget. It was voted on Tuesday. Next", i, false)
        assertEquals(listOf("It was voted on Tuesday."), b)
        val (c, _) = SpeechChunker.next("The page is about a budget. It was voted on Tuesday. Next point", j, true)
        assertEquals(listOf("Next point"), c)
    }

    @Test fun bulletLinesAreSpokenWithoutTheDash() {
        val (a, _) = SpeechChunker.next("About X\n- first point\n- second point", 0, true)
        assertEquals(listOf("About X", "first point", "second point"), a)
    }

    @Test fun halfMarkerIsNotVisible() {
        assertEquals("Intro.\n", PageSummary.visible("Intro.\nKEY SEN"))
        assertEquals("Intro.\n- point\n", PageSummary.visible("Intro.\n- point\nKEY SENTENCES:\nCopied sentence."))
    }
}
