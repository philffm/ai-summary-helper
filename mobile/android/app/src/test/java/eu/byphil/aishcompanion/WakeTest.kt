package eu.byphil.aishcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WakeTest {
    private val text = "A short review the next morning keeps more than a second reading the same evening."

    @Test fun clozeLeavesOutOneLongWord() {
        val c = Recall.cloze(text, 0)!!
        assertEquals(text, c.before + c.answer + c.after)
        assertTrue(c.answer.length >= 5)
        assertEquals(c, Recall.cloze(text, 0))
        assertNull("too short to ask", Recall.cloze("Sleep helps memory.", 0))
        assertNull("only little words", Recall.cloze("it is on to be or at all of us", 0))
        assertNotNull(Recall.cloze(text, Int.MIN_VALUE))
    }

    @Test fun askedHighlightsComeBackLater() {
        val a = Card("1", "A", text); val b = Card("2", "B", "Notes you can find again are worth more than notes you only wrote.")
        assertEquals(b, Recall.pick(listOf(a, b), mapOf(a.key to Memo(0, 1)), 10, 5))   // never asked first
        assertEquals(a, Recall.pick(listOf(a, b), mapOf(a.key to Memo(10, 1), b.key to Memo(11, 1)), 10, 3))
        assertNull(Recall.pick(listOf(a), mapOf(a.key to Memo(11, 1)), 10, 0))
        assertEquals(Memo(12, 1), Recall.answer(null, true, 10))
        assertEquals(Memo(14, 2), Recall.answer(Memo(10, 1), true, 10))
        assertEquals(Memo(74, 10), Recall.answer(Memo(10, 9), true, 10))
        assertEquals(Memo(11, 0), Recall.answer(Memo(10, 4), false, 10))
    }

    @Test fun contentSurvivesSavingAndNeverSaysTheAnswer() {
        val wake = Wake.remember(Card("1", "A", text), 0, "en", 7, 42)!!
        assertFalse("the question is spoken without the word", wake.parts.last().contains(wake.cloze!!.answer))
        assertEquals(wake, Wake.fromJson(wake.toJson()))
        assertNull(Wake.fromJson("nonsense"))
        assertEquals(2, Wake.randomArticle(listOf(1, 2, 3), { it == 2 }, 7))
        assertEquals(1, Wake.randomArticle(listOf(1, 2, 3), { false }, 0))
        assertNull(Wake.randomArticle(emptyList<Int>(), { true }, 0))
    }
}
