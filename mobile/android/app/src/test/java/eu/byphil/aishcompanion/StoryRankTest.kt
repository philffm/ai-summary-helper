package eu.byphil.aishcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class StoryRankTest {
    private val now = 1_800_000_000_000L
    private val h = 3600_000L
    private fun e(feed: Int, id: String, title: String, ageH: Long, fav: Boolean = false) =
        FeedEntryRef(Feed("https://f$feed.test/feed", "Feed $feed"), StoredItem(FeedItem(id, title, "", now - ageH * h, "", "", ""), false, fav = fav))

    private val storm = "Storm hits northern coast with heavy flooding"

    @Test fun aStoryFromSeveralSourcesComesFirst() {
        val pool = listOf(
            e(1, "new", "Local bakery opens second shop downtown", 1),
            e(2, "s1", storm, 5), e(3, "s2", "$storm today", 6), e(4, "s3", "Heavy flooding as storm hits northern coast", 7),
        )
        val r = StoryRank.rank(pool, now, 24 * h, 10, 3)
        assertEquals("s1", r.first().lead.stored.item.id)
        assertEquals(3, r.first().sources)
        assertEquals(2, r.size)   // the three storm items are one story
    }

    @Test fun oneFeedCannotFillTheList() {
        val pool = (1..6).map { e(1, "a$it", "Headline number $it about topic$it", it.toLong()) } + e(2, "b", "Other feed story about something else", 8)
        val ids = StoryRank.rank(pool, now, 24 * h, 4, 3).map { it.lead.stored.item.id }
        assertTrue("b" in ids)
        assertEquals(3, ids.count { it.startsWith("a") })
    }

    @Test fun starredStoriesGetABoost() {
        val pool = listOf(e(1, "plain", "Alpha news about weather patterns", 1), e(2, "fav", "Beta news about harbour traffic", 2, fav = true))
        assertEquals("fav", StoryRank.rank(pool, now, 24 * h, 2, 3).first().lead.stored.item.id)
    }

    @Test fun emptyAndLimit() {
        assertTrue(StoryRank.rank(emptyList(), now, 24 * h, 5, 2).isEmpty())
        assertEquals(1, StoryRank.rank(listOf(e(1, "a", "One two three four", 1), e(2, "b", "Five six seven eight", 2)), now, 24 * h, 1, 2).size)
    }
}
