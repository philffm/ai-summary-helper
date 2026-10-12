package eu.byphil.aishcompanion

import org.junit.Assert.assertEquals
import org.junit.Test

class FeedStacksTest {
    private val hour = 3600_000L
    private fun e(id: String, title: String, ageH: Long, feed: String = "f$id") =
        FeedEntryRef(Feed("https://$feed.test/rss", feed), StoredItem(FeedItem(id, title, "", 1_000 * hour - ageH * hour, "", "", ""), false))

    @Test fun sameStoryFromTwoSourcesStacks() {
        val s = FeedStacks.stack(listOf(
            e("1", "Government announces new climate law after long debate", 1),
            e("2", "Climate law announced by government after long debate", 3),
            e("3", "Local team wins championship final", 4)))
        assertEquals(2, s.size)
        assertEquals("1", s[0].lead.stored.item.id); assertEquals(listOf("2"), s[0].others.map { it.stored.item.id })
    }

    @Test fun differentNumbersDoNotStack() {
        val s = FeedStacks.stack(listOf(e("1", "Champions League matchday 3 results and tables", 1), e("2", "Champions League matchday 4 results and tables", 2)))
        assertEquals(2, s.size)
    }

    @Test fun outsideTheWindowDoesNotStack() {
        val s = FeedStacks.stack(listOf(e("1", "Government announces new climate law after long debate", 1), e("2", "Government announces new climate law after long debate", 80)))
        assertEquals(2, s.size)
    }

    @Test fun shortUnrelatedTitlesStayApart() {
        assertEquals(2, FeedStacks.stack(listOf(e("1", "Weather today", 1), e("2", "Weather tomorrow", 2))).size)
    }
}
