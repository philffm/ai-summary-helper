package eu.byphil.aishcompanion

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The note's front matter must match the extension's (shared vector plugin/tests/fixtures/article-v1-vector.json, built by test168). */
class ArticleMarkdownTest {
    private val vec = JSONObject(javaClass.getResource("/article-v1-vector.json")!!.readText())
    private val phone = vec.getJSONObject("phone")

    private fun article(aid: Boolean = true): Article {
        val (a, _) = ArticleCodec.decrypt(phone.getString("inboxId"), phone.getString("encKey"), phone.getJSONObject("envelope").getString("data"), "abc123")
        return if (aid) a else a.copy(aid = "")
    }

    private fun frontMatter(md: String) = md.substringBefore("\n---\n\n") + "\n---"

    @Test fun theEnvelopeCarriesTheExtensionArticleId() {
        assertEquals(phone.getJSONObject("message").getString("aid"), article().aid)
    }

    @Test fun frontMatterEqualsTheExtensionsKeysAndValues() {
        val md = ArticleMarkdown.render(article())
        assertEquals(vec.getJSONObject("android").getString("expectedFrontMatter"), frontMatter(md))
    }

    @Test fun withoutAnIdThereIsNoAishIdButTheFormatIsStillMarked() {
        val fm = frontMatter(ArticleMarkdown.render(article(aid = false)))
        assertFalse(fm.contains("aish_id"))
        assertTrue(fm.contains("aish_format: 1"))
        assertTrue(fm.contains("source: ") && fm.contains("created: ") && fm.contains("url: ") && fm.contains("date: "))
    }

    @Test fun titleWithQuotesAndLineBreaksStaysOneYamlLine() {
        val a = article().copy(title = "Size & \"quoted\"\nsecond line")
        val title = frontMatter(ArticleMarkdown.render(a)).lines().first { it.startsWith("title: ") }
        assertEquals("title: \"Size & \\\"quoted\\\" second line\"", title)
    }

    @Test fun fileNameKeepsTheTitleAndTellsUntitledNotesApart() {
        assertEquals("Odd name with chars.md", ArticleMarkdown.fileName("Odd: <name>/with*chars?"))
        assertEquals("Untitled (ab12cd).md", ArticleMarkdown.fileName("   ", "article_1760000000000_ab12cd"))
        assertEquals("Untitled.md", ArticleMarkdown.fileName(""))
    }
}
