package eu.byphil.aishcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PageSummaryTest {
    private fun raw(json: String) = "\"" + json.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

    @Test fun parsesWhatEvaluateJavascriptReturns() {
        val page = PageExtract.parse(raw("""{"title":"T","blocks":[["h1","Head"],["p","Body text here."]]}"""))
        assertNotNull(page)
        assertEquals("T", page!!.title)
        assertEquals(2, page.blocks.size)
        assertTrue(page.text().contains("Body text here."))
    }

    @Test fun unusableResultsAreNull() {
        assertNull(PageExtract.parse(null))
        assertNull(PageExtract.parse("null"))
        assertNull(PageExtract.parse(raw("""{"title":"T","blocks":[]}""")))
        assertNull(PageExtract.parse("not json"))
    }

    @Test fun shortPagesAreNotEnough() {
        assertFalse(PageSummary.enough(Page("t", listOf("p" to "tiny"))))
        assertTrue(PageSummary.enough(Page("t", listOf("p" to "x".repeat(300)))))
    }

    @Test fun longPagesAreChunkedAndCapped() {
        val sentence = "This is a sentence of moderate length that ends here. "
        val page = Page("t", listOf("p" to sentence.repeat(2000)))
        val parts = PageSummary.parts(page)
        assertEquals(PageSummary.MAX_CHUNKS, parts.size)
        assertTrue(parts.all { it.length <= PageSummary.CHUNK })
    }

    @Test fun shortPageIsOnePart() {
        assertEquals(1, PageSummary.parts(Page("t", listOf("p" to "A short page. ".repeat(20)))).size)
    }

    @Test fun cleanKeepsPointsAndDropsMarkdown() {
        val out = PageSummary.clean("## Summary\n* **First** point here\n• second point here\n- third point")!!
        assertEquals("Summary\n- First point here\n- second point here\n- third point", out)
        assertNull(PageSummary.clean("ok"))
    }
}
