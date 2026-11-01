package eu.byphil.aishcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HtmlBlocksTest {
    private fun blocks(html: String) = HtmlBlocks.toBlocks(html)

    @Test fun headingsParagraphsListsQuotesAndCode() {
        val b = blocks("<h1>Title</h1><p>First <b>bold</b> and <a href='https://x.test/?a=1'>a link</a>.</p><h4>Sub</h4><ul><li>one</li><li>two <em>x</em></li></ul>" +
            "<blockquote>A quote</blockquote><pre>line 1\n  line 2\n</pre><p>Last</p>")
        assertEquals(listOf("h1" to "Title", "p" to "First bold and a link.", "h3" to "Sub", "li" to "one", "li" to "two x", "q" to "A quote", "pre" to "line 1\n  line 2", "p" to "Last"), b)
    }

    @Test fun dropsScriptsStylesNavigationFormsAndImages() {
        val b = blocks("<nav><a>Home</a></nav><script>var x = '<p>no</p>';</script><style>p{color:red}</style><p>Kept</p><form><p>in a form</p></form><img src=x><footer><p>footer</p></footer><aside>side<aside>nested</aside>more</aside><p>Also kept</p>")
        assertEquals(listOf("p" to "Kept", "p" to "Also kept"), b)
    }

    @Test fun decodesEntitiesAndSquashesWhitespace() {
        assertEquals(listOf("p" to "Tom & Jerry’s “café” — ä €"), blocks("<p>Tom &amp;  Jerry&rsquo;s \n &ldquo;caf&eacute;&rdquo; &mdash; &#228; &#x20AC;</p>"))
        assertEquals(listOf("p" to "a < b > c"), blocks("<p>a &lt; b &gt; c</p>"))
    }

    @Test fun lineBreaksAreSpacesAndTextOutsideTagsCounts() {
        assertEquals(listOf("p" to "one two", "p" to "loose text"), blocks("<p>one<br>two</p>loose text"))
    }

    @Test fun toleratesBrokenMarkup() {
        assertEquals(listOf("p" to "unclosed"), blocks("<p>unclosed"))
        assertEquals(listOf("p" to "a"), blocks("<div><p>a</div></p>"))
        assertTrue(blocks("<p>half <a href=\"x").isNotEmpty())
        assertEquals(emptyList<Pair<String, String>>(), blocks("<script>never closed"))
        assertEquals(emptyList<Pair<String, String>>(), blocks(""))
        assertEquals(listOf("p" to "a"), blocks("<!-- note --><!DOCTYPE html><p>a</p>"))
    }

    @Test fun plainTextBecomesParagraphs() {
        assertEquals(listOf("p" to "First para", "p" to "Second para"), blocks("First\npara\n\nSecond para"))
    }

    @Test fun summariesBecomeReadableText() {
        assertEquals("Intro line.\n\n- one\n- two\n\nEnd.", HtmlBlocks.summaryToText("<p>Intro line.</p><ul><li>one</li><li>two</li></ul><p>End.</p>"))
        assertEquals("already plain", HtmlBlocks.summaryToText("already plain")); assertEquals("", HtmlBlocks.summaryToText("  "))
    }

    @Test fun siteWithoutWww() { assertEquals("example.com", HtmlBlocks.siteOf("https://www.example.com/a?b")); assertEquals("", HtmlBlocks.siteOf("not a url")) }
}
