package eu.byphil.aishcompanion

import org.junit.Assert.assertEquals
import org.junit.Test

class FeedSearchTest {
    private fun entry(title: String, body: String = "", feed: String = "BBC", tags: List<String> = emptyList()) =
        FeedEntryRef(Feed("https://x.test/f", feed, tags = tags), StoredItem(FeedItem("1", title, "", 0, "", "", body), false))

    @Test fun emptyQueryMatchesAll() { assertEquals(true, FeedSearch.matches(entry("Hello"), "  ")) }
    @Test fun allWordsMustAppearInAnyField() {
        val e = entry("Solar boom", body = "Panels everywhere", tags = listOf("Energy"))
        assertEquals(true, FeedSearch.matches(e, "solar panels"))
        assertEquals(true, FeedSearch.matches(e, "ENERGY bbc"))
        assertEquals(false, FeedSearch.matches(e, "solar wind"))
    }
}
