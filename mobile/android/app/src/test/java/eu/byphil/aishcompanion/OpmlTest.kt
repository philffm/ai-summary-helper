package eu.byphil.aishcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class OpmlTest {
    private val sample = """<?xml version="1.0"?>
        <opml version="2.0"><head><title>x</title></head><body>
          <outline text="News">
            <outline type="rss" text="Alpha" xmlUrl="https://alpha.example/feed"/>
            <outline type="rss" title="Beta" xmlUrl="https://beta.example/rss"/>
          </outline>
          <outline type="rss" text="Gamma &amp; Co" xmlUrl="https://gamma.example/atom"/>
          <outline type="rss" text="Alpha again" xmlUrl="https://alpha.example/feed"/>
          <outline text="Not a feed" xmlUrl="ftp://nope.example/x"/>
        </body></opml>"""

    @Test fun foldersBecomeTagsAndDuplicatesMerge() {
        val got = Opml.parse(sample)
        assertEquals(listOf("https://alpha.example/feed", "https://beta.example/rss", "https://gamma.example/atom"), got.map { it.url })
        assertEquals(listOf("News"), got[0].tags)
        assertEquals("Gamma & Co", got[2].title)
        assertTrue(got[2].tags.isEmpty())
    }

    @Test fun exportAndImportRoundTrip() {
        val feeds = listOf(Feed("https://a.example/f", "A <1>", "", listOf("News", "Tech"), 1), Feed("https://b.example/f", "B", "", emptyList(), 1))
        val back = Opml.parse(Opml.export(feeds))
        assertEquals(setOf("https://a.example/f", "https://b.example/f"), back.map { it.url }.toSet())
        assertEquals(setOf("News", "Tech"), back.first { it.url == "https://a.example/f" }.tags.toSet())
        assertEquals("A <1>", back.first { it.url == "https://a.example/f" }.title)
    }

    @Test fun notOpmlAndEntityTricksGiveNothing() {
        assertTrue(Opml.parse("hello").isEmpty())
        assertTrue(Opml.parse("<!DOCTYPE x [<!ENTITY a \"b\">]><opml><body/></opml>").isEmpty())
        assertTrue(Opml.parse("<opml><head/></opml>").isEmpty())
    }
}

class FeedPruneTest {
    private val now = 1_800_000_000_000L
    private val day = 24 * 3600_000L
    private fun item(id: String, at: Long) = FeedItem(id, "T $id", "https://s.example/$id", at, "", "", "")

    @Test fun oldItemsGoButFavouritesStay() {
        val st = FeedStore(File(System.getProperty("java.io.tmpdir"), "feedstore-prune-" + System.nanoTime()))
        val f = st.add("https://s.example/feed", "S", emptyList(), 1)!!
        st.saveItems(f.url, listOf(item("new", now - day), item("old", now - 10 * day), item("oldfav", now - 12 * day)), now)
        st.setFavorite(f.url, "oldfav", true)
        assertEquals(1, st.pruneOlderThan(7, now))
        assertEquals(setOf("new", "oldfav"), st.items(f.url).map { it.item.id }.toSet())
    }
}
