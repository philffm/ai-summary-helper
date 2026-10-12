package eu.byphil.aishcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class FeedStoreExtrasTest {
    private fun store() = FeedStore(File(System.getProperty("java.io.tmpdir"), "feedstore-extras-" + System.nanoTime()))
    private fun item(id: String, audio: String = "") = FeedItem(id, "Title $id", "https://s.example/$id", 1000, "", "sum", "body", audio, 0)

    @Test fun podcastEnclosuresAndDurations() {
        val xml = """<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Pod</title>
            <item><title>Ep 1</title><guid>e1</guid><enclosure url="https://cdn.example/e1.mp3" type="audio/mpeg" length="1"/><itunes:duration>1:02:03</itunes:duration></item>
            <item><title>Ep 2</title><guid>e2</guid><enclosure url="http://cdn.example/e2.mp3" type="audio/mpeg"/></item>
            <item><title>Img</title><guid>e3</guid><enclosure url="https://cdn.example/p.jpg" type="image/jpeg"/></item></channel></rss>"""
        val items = FeedXml.parse(xml, "https://pod.example/feed")!!.items
        assertEquals("https://cdn.example/e1.mp3", items[0].audio); assertEquals(3723, items[0].duration)
        assertEquals("", items[1].audio)   // plain http is not played
        assertEquals("", items[2].audio)
        assertEquals(2123, FeedXml.parseDuration("2123")); assertEquals(2110, FeedXml.parseDuration("35:10")); assertEquals(0, FeedXml.parseDuration("soon"))
    }

    @Test fun favouritesSurviveRefreshesAndDroppingOutOfTheFeed() {
        val st = store()
        val f = st.add("https://s.example/feed", "S", emptyList(), 1)!!
        st.saveItems(f.url, listOf(item("a", "https://cdn.example/a.mp3"), item("b")))
        st.setFavorite(f.url, "a", true)
        st.saveItems(f.url, listOf(item("b"), item("c")))   // "a" fell out of the feed
        val ids = st.items(f.url).map { it.item.id }
        assertTrue("a" in ids)
        assertTrue(st.items(f.url).first { it.item.id == "a" }.fav)
        assertEquals("https://cdn.example/a.mp3", st.items(f.url).first { it.item.id == "a" }.item.audio)
        assertFalse(st.items(f.url).first { it.item.id == "b" }.fav)
        st.setFavorite(f.url, "a", false)
        st.saveItems(f.url, listOf(item("b"), item("c")))
        assertFalse("a" in st.items(f.url).map { it.item.id })
    }

    @Test fun unchangedFeedAnswers304AndKeepsItsItems() {
        val st = store()
        val feed = """<rss><channel><title>T</title><item><title>A</title><guid>a</guid></item></channel></rss>"""
        val f = st.add("https://s.example/feed", "T", emptyList(), 1)!!
        assertEquals(1, FeedFetcher.refresh(st, f, 2) { Net.Page(200, feed, it, etag = "\"v1\"", modified = "Tue, 03 Jun 2025 11:05:30 GMT") })
        val saved = st.feeds()[0]
        assertEquals("\"v1\"", saved.etag)
        assertEquals(0, FeedFetcher.refresh(st, saved, 3) { Net.Page(304, "", it, notModified = true) })
        assertEquals(1, st.items(f.url).size)
        assertEquals(3L, st.feeds()[0].lastFetched)
        assertEquals("\"v1\"", st.feeds()[0].etag)
    }
}
