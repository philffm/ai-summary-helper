package eu.byphil.aishcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId

class DayRecapTest {
    private val zone = ZoneId.of("UTC")
    private val now = 1_700_000_000_000L + 12 * 3600_000   // some time of day
    private fun e(feed: String, id: String, at: Long) =
        FeedEntryRef(Feed("https://$feed.test/f", feed), StoredItem(FeedItem(id, "T$id", "", at, "", "", ""), false))

    @Test fun onlyTodayWhenEnough() {
        val midnight = now - now % 86_400_000L
        val list = listOf(e("a", "1", now - 1000), e("a", "2", now - 2000), e("b", "3", now - 3000), e("b", "old", midnight - 3600_000))
        assertEquals(setOf("1", "2", "3"), DayRecap.pick(list, now, zone).map { it.stored.item.id }.toSet())
    }

    @Test fun fallsBackToLast24h() {
        val list = listOf(e("a", "1", now - 1000), e("a", "2", now - 20 * 3600_000L), e("a", "3", now - 50 * 3600_000L))
        assertEquals(setOf("1", "2"), DayRecap.pick(list, now, zone).map { it.stored.item.id }.toSet())
    }

    @Test fun limitsPerFeed() {
        val list = (1..6).map { e("a", "$it", now - it * 1000L) } + e("b", "x", now - 9000)
        val ids = DayRecap.pick(list, now, zone).map { it.stored.item.id }
        assertEquals(setOf("1", "2", "3", "x"), ids.toSet())
    }

    @Test fun promptRepeatsTheTaskAfterTheList() {
        val p = DayRecap.user(listOf(e("a", "1", now)))
        assertTrue(p.indexOf("- T1") < p.indexOf("Write the recap"))
    }

    @Test fun shortRepliesAreRejected() { assertNull(DayRecap.cleanReply("ok")); assertNull(DayRecap.cleanReply(null)) }
}
