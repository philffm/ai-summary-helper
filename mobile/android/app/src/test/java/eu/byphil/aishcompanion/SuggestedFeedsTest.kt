package eu.byphil.aishcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File

class SuggestedFeedsTest {
    @Test fun parsesValidEntriesAndDropsBadOnes() {
        val list = SuggestedFeeds.parse("""{"version":1,"feeds":[
            {"name":"BBC","url":"https://feeds.bbci.co.uk/news/rss.xml","tags":["News"," "],"note":"World","icon":"🌍"},
            {"name":"Plain http","url":"http://example.com/feed"},
            {"name":"","url":"https://example.com/x"},
            {"name":"Again","url":"https://feeds.bbci.co.uk/news/rss.xml"},
            {"name":"No icon","url":"https://example.org/rss"}]}""")!!
        assertEquals(listOf("BBC", "No icon"), list.map { it.name })
        assertEquals(listOf("News"), list[0].tags)
        assertEquals("📰", list[1].icon)
    }

    @Test fun unusableTextIsNull() {
        assertNull(SuggestedFeeds.parse(null)); assertNull(SuggestedFeeds.parse("nope")); assertNull(SuggestedFeeds.parse("""{"feeds":[]}"""))
    }

    @Test fun theFileInTheRepoParses() {
        val f = generateSequence(File("").absoluteFile) { it.parentFile }.map { File(it, "shared/suggested-feeds.json") }.first { it.exists() }
        assertEquals(7, SuggestedFeeds.parse(f.readText())!!.size)
    }
}
