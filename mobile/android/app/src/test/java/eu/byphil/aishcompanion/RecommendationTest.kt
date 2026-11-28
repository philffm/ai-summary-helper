package eu.byphil.aishcompanion

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A recommendation as a file, the same form on both phones: what one writes the other reads, and a stranger's file is held to limits. */
class RecommendationTest {
    private val words = Recommendation.Words("Recommended by Phil", "Read the article", "Open with Kaivo")

    /** The same words as in the iPhone app's test, whose page is one of the shared fixtures. */
    private fun full() = Recommendation(
        url = "https://example.org/a?x=1&y=2", title = "Why <b> \"quotes\" & </script> matter", note = "Look at the second part.\nIt's good.",
        from = "Phil 🌿", marks = listOf("A sentence that was marked.", "Zweite Stelle: Grüße"), summary = listOf("Short.", "要約"),
    )

    private fun fixture(name: String) = javaClass.classLoader!!.getResourceAsStream(name)!!.readBytes()

    @Test fun whatIsWrittenIsReadBack() {
        val page = full().page(words)
        assertEquals(full(), Recommendation.read(page.toByteArray()))
        assertFalse("no script, and none that words could open", page.lowercase().contains("<script"))
        assertTrue(page.contains("&lt;b&gt; &quot;quotes&quot; &amp; &lt;/script&gt;"))
        assertTrue(page.contains("href=\"https://example.org/a?x=1&amp;y=2\""))
        assertFalse("nothing is loaded from elsewhere", page.contains("src="))
        System.getenv("KAIVO_RECOMMENDATION_OUT")?.let { java.io.File(it).writeText(page) }
    }

    @Test fun thePagesOfBothPhonesAreRead() {
        assertEquals(full(), Recommendation.read(fixture("recommendation-vector.html")))
        assertEquals(full(), Recommendation.read(fixture("recommendation-android-vector.html")))
    }

    @Test fun whatIsNoRecommendationIsNone() {
        val page = full().page(words)
        assertNull(Recommendation.read("<html><body>Hello</body></html>".toByteArray()))
        assertNull(Recommendation.read(page.replace("content=\"ey", "content=\"!!").toByteArray()))
        assertNull("too large", Recommendation.read((page + " ".repeat(Recommendation.MAX_BYTES)).toByteArray()))
        for (url in listOf("javascript:alert(1)", "file:///etc/passwd", "kaivo://today", "https://", "not an address")) {
            val bad = full().copy(url = url)
            assertNull(url, bad.checked())
            assertNull(url, Recommendation.read(bad.page(words).toByteArray()))
        }
        assertNull("a later form is not guessed at", full().copy(v = 2).checked())
        assertNull("every part has to be there", Recommendation.from(full().toJson().apply { remove("marks") }))
        assertNull("words, not numbers", Recommendation.from(full().toJson().put("title", 7)))
        val cut = full().copy(title = "t".repeat(5000), marks = List(90) { "m" }, from = "two\nlines", note = "a" + "🌿".repeat(1500)).checked()!!
        assertEquals(listOf(300, 20), listOf(cut.title.length, cut.marks.size))
        assertEquals("two lines", cut.from)
        assertFalse("no half of a character", Character.isHighSurrogate(cut.note.last()))
    }

    @Test fun aFileNameFromAnyName() {
        assertEquals("Recommendation from Phil.html", Recommendation.fileName("Recommendation from Phil"))
        assertEquals("a b c.html", Recommendation.fileName("../a/b\\c?"))
        assertEquals(85, Recommendation.fileName("x".repeat(500)).length)
    }

    @Test fun whatASenderAddedStaysWithTheArticle() {
        val json = PageSummary.articleJson("https://example.org/a", Page("A", emptyList(), ""), "", 1L, recommendation = full().copy(url = "https://example.org/a"))
        val article = ArticleCodec.parse(json, PageSummary.localId("https://example.org/a"))
        assertEquals("Phil 🌿", article.recommendation?.from)
        assertEquals(full().marks, article.highlights.filter { it.ghost }.map { it.text })
        assertEquals("", article.summary)
        // added once, however often it is added
        val again = JSONObject(json).also { PageSummary.addRecommendation(it, article.recommendation!!) }
        assertEquals(2, again.getJSONArray("hl").length())
    }
}
