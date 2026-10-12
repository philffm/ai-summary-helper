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

    @Test fun localIdIsStablePerLinkAndAcceptedByTheStore() {
        val a = PageSummary.localId("https://example.com/a")
        assertEquals(a, PageSummary.localId(" https://example.com/a "))
        assertTrue(a != PageSummary.localId("https://example.com/b"))
        assertTrue(ArticleStore.ID.matches(a))
    }

    @Test fun summaryBecomesAReadingListArticleMarkedLocal() {
        val page = Page("Why agents need memory", listOf("h1" to "Why agents need memory", "p" to "Body text here."), "en")
        val json = PageSummary.articleJson("https://www.example.com/x", page, "- key point", 123L)
        val a = ArticleCodec.parse(json, PageSummary.localId("https://www.example.com/x"))
        assertTrue(a.local)
        assertEquals("example.com", a.site)
        assertEquals("- key point", a.summary)
        assertEquals("en", a.lang)
        assertEquals(2, a.blocks.size)
    }

    @Test fun shareTextHasTitleSummaryAndLink() {
        assertEquals("T\n\nS\n\nhttps://x.y", PageSummary.shareText(" T ", " S ", "https://x.y"))
        assertEquals("S", PageSummary.shareText("", "S", ""))
    }
}

class PageSummaryExtrasTest {
    private val page = Page("T", listOf("p" to "The city council voted on Tuesday to approve the new budget after a long debate.", "p" to "Opponents said the plan ignores housing costs for families in the north."))

    @org.junit.Test fun passagesMustBeCopiedFromThePage() {
        val reply = "1. \"The city council voted on Tuesday to approve the new budget after a long debate.\"\n- Opponents said the plan   ignores housing costs for families in the north.\n- This sentence was invented by the model entirely."
        val v = PageSummary.validPassages(reply, page)
        org.junit.Assert.assertEquals(2, v.size)
        org.junit.Assert.assertTrue(v[0].startsWith("The city council"))
    }

    @org.junit.Test fun highlightsGoIntoTheArticleAsGhosts() {
        val json = PageSummary.articleJson("https://x.test/a", page, "- point", 1L, listOf("The city council voted on Tuesday to approve the new budget after a long debate."))
        val a = ArticleCodec.parse(json, "local-0123456789abcdef")
        org.junit.Assert.assertEquals(1, a.highlights.size)
        org.junit.Assert.assertTrue(a.highlights[0].ghost)
    }

    @org.junit.Test fun replySplitsAtTheMarker() {
        val (body, copied) = PageSummary.splitReply("About a budget.\n- one\n- two\n\n**KEY SENTENCES:**\nThe city council voted on Tuesday to approve the new budget after a long debate.")
        org.junit.Assert.assertTrue(body.contains("- two") && !body.contains("KEY"))
        org.junit.Assert.assertEquals(1, PageSummary.validPassages(copied, page).size)
        org.junit.Assert.assertNull(PageSummary.splitReply("No marker here").second)
    }

    @org.junit.Test fun languageRule() {
        org.junit.Assert.assertTrue(SummaryLangs.rule("").contains("language of the page"))
        org.junit.Assert.assertTrue(SummaryLangs.rule("de").contains("German"))
    }
}
