package eu.byphil.aishcompanion

import org.junit.Assert.assertEquals
import org.junit.Test

class PodcastTimeTest {
    @Test fun format() { assertEquals("1:23", PodcastTime.format(83_000)); assertEquals("1:02:03", PodcastTime.format(3_723_000)); assertEquals("0:00", PodcastTime.format(-5)) }
    @Test fun resume() {
        assertEquals(0, PodcastTime.resumeAt(0, 600_000)); assertEquals(120_000, PodcastTime.resumeAt(120_000, 600_000)); assertEquals(0, PodcastTime.resumeAt(595_000, 600_000))
    }
    @Test fun sleepLeftRoundsUp() {
        assertEquals("15 min", PodcastTime.sleepLeft(15 * 60_000L)); assertEquals("15 min", PodcastTime.sleepLeft(14 * 60_000L + 1))
        assertEquals("under 1 min", PodcastTime.sleepLeft(30_000)); assertEquals("now", PodcastTime.sleepLeft(0))
    }
    @Test fun speedCycles() { assertEquals(1.25f, PodcastTime.nextSpeed(1f)); assertEquals(1f, PodcastTime.nextSpeed(0.8f)) }
}
