package eu.byphil.aishcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class FeedXmlTest {
    private val rss = """<?xml version="1.0"?>
<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>Example &amp; Co</title><link>https://example.com/</link>
<item><title><![CDATA[Hello <b>World</b> &xxe;]]></title><link>/posts/1?a=1&amp;b=2</link><guid>g-1</guid>
<pubDate>Tue, 03 Jun 2025 11:05:30 GMT</pubDate><dc:creator>Jörg</dc:creator>
<description>&lt;p&gt;Teaser with &amp;amp; &amp;ouml;&lt;/p&gt;</description>
<content:encoded><![CDATA[<p>First &mdash; nice.</p><script>alert(1)</script><ul><li>One</li><li>Two</li></ul><p>Last&nbsp;one</p>]]></content:encoded></item>
<item><title>No link</title><link>javascript:alert(1)</link></item></channel></rss>"""

    @Test fun readsRssWithoutFetchingEntities() {
        val f = FeedXml.parse(rss, "https://example.com/feed")!!
        assertEquals("Example & Co", f.title)
        val a = f.items[0]
        assertEquals("https://example.com/posts/1?a=1&b=2", a.link)
        assertEquals("g-1", a.id); assertEquals("Jörg", a.author)
        assertEquals(1748948730000L, a.published)
        assertEquals("First — nice.\n\n• One\n• Two\n\nLast one", a.body)
        assertFalse(a.body.contains("alert")); assertFalse(a.title.contains("root:"))
        assertEquals("", f.items[1].link)   // javascript: links never become links
    }

    @Test fun readsAtomAndJsonFeed() {
        val atom = """<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><link href="https://a.example/"/><entry><title>T</title><id>1</id><link rel="alternate" href="/e/1"/><updated>2025-06-03T10:00:00+02:00</updated><author><name>Ann</name></author><content type="html">&lt;p&gt;Body&lt;/p&gt;</content></entry></feed>"""
        val a = FeedXml.parse(atom, "https://a.example/feed")!!
        assertEquals("https://a.example/e/1", a.items[0].link); assertEquals("Ann", a.items[0].author); assertEquals("Body", a.items[0].body)
        val j = FeedXml.parse("""{"title":"J","home_page_url":"https://j.example/","items":[{"id":"1","url":"https://j.example/1","title":"One","content_html":"<p>Hi</p>","date_published":"2025-06-03T10:00:00Z"}]}""")!!
        assertEquals("Hi", j.items[0].body)
        assertNull(FeedXml.parse("<html><body>no</body></html>")); assertNull(FeedXml.parse("garbage"))
    }

    @Test fun hostileNestingIsHarmless() {
        val deep = "<rss><channel>" + "<a>".repeat(5000) + "x" + "</a>".repeat(5000) + "<item><title>ok</title></item></channel></rss>"
        assertNotNull(FeedXml.parse(deep))
    }

    @Test fun findsFeedsInAPage() {
        val html = """<head><link rel="alternate" type="application/rss+xml" href="/feed.xml"><link rel="stylesheet" href="a.css"><link href='https://x.example/atom' type='application/atom+xml' rel='alternate'></head>"""
        assertEquals(listOf("https://site.example/feed.xml", "https://x.example/atom"), FeedXml.discover(html, "https://site.example/blog/"))
    }

    @Test fun storeAndFetcher() {
        val dir = File(System.getProperty("java.io.tmpdir"), "feedstore-test-" + System.nanoTime())
        val store = FeedStore(dir)
        fun page(t: String, u: String) = Net.Page(200, t, u)
        val feed = """<rss><channel><title>T</title><item><title>A</title><guid>a</guid><link>https://s.example/a</link><pubDate>Tue, 03 Jun 2025 11:05:30 GMT</pubDate></item></channel></rss>"""
        val found = FeedFetcher.lookup("s.example/feed.xml") { page(feed, it) } as FeedLookup.Found
        val f = store.add(found.url, found.feed.title, listOf("News", "news"), 1)!!
        assertEquals(listOf("News"), f.tags)
        assertNull(store.add(found.url, "dup", emptyList(), 2))
        assertEquals(1, FeedFetcher.refresh(store, f, 3) { page(feed, it) })
        store.markRead(f.url, "a")
        assertEquals(0, FeedFetcher.refresh(store, store.feeds()[0], 4) { page(feed, it) })
        assertTrue(store.items(f.url)[0].read)
        assertEquals(FeedLookup.Failed("invalid"), FeedFetcher.lookup("javascript:alert(1)") { error("never") })
    }

    @Test fun highlightsAreMarkedInTheText() {
        val blocks = listOf(Block("h2", "Title"), Block("p", "Hello   big\nworld here"))
        val m = Highlighter.place(blocks, listOf(Highlight(true, "big world")))
        assertEquals(1, m[1]!!.size); assertTrue(m[1]!![0].ghost)
        assertEquals("big\nworld", blocks[1].text.substring(m[1]!![0].start, m[1]!![0].end).let { it })
    }
}
