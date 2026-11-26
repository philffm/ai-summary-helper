package eu.byphil.aishcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DepthTrackTest {
    private val blocks = listOf(Block("p", "a".repeat(500)), Block("p", "b".repeat(500)))
    private val marks = mapOf(1 to listOf(Mark(250, 300, false), Mark(400, 500, true)), 9 to listOf(Mark(0, 1, false)))

    @Test fun spotsLieWhereTheWordsAre() {
        val spots = DepthTrack.spots(blocks, marks)
        assertEquals(listOf(false, true), spots.map { it.ghost })
        assertEquals(0.75f, spots[0].from, 0.001f)
        assertEquals(0.80f, spots[0].to, 0.001f)
        assertEquals(1f, spots[1].to, 0.001f)
    }

    @Test fun windowAndSeeking() {
        val window = DepthTrack.window(blocks, listOf(Shown(0, 0.5f, 1f), Shown(1, 0f, 0.5f)))!!
        assertEquals(0.25f, window.first, 0.001f)
        assertEquals(0.75f, window.second, 0.001f)
        assertNull(DepthTrack.window(blocks, emptyList()))
        assertEquals(0, DepthTrack.blockAt(blocks, 0f))
        assertEquals(1, DepthTrack.blockAt(blocks, 2f))
        assertNull(DepthTrack.blockAt(emptyList(), 0.5f))
        val spots = DepthTrack.spots(blocks, marks)
        assertEquals(spots[0], DepthTrack.near(spots, 0.74f, 0.02f))
        assertNull(DepthTrack.near(spots, 0.2f, 0.02f))
    }
}
