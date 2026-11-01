package eu.byphil.aishcompanion

import eu.byphil.aishcompanion.sync.MemoryRecordStore
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class ArticleMaterializerTest {
    private class Sink : ArticleSink {
        val saved = LinkedHashMap<String, Pair<Article, String>>(); val received = HashMap<String, Long>()
        override fun save(article: Article, json: String, receivedAt: Long) { saved[article.id] = article to json; received[article.id] = receivedAt }
        override fun delete(id: String) { saved.remove(id) }
        override fun has(id: String) = saved.containsKey(id)
    }
    private val records = MemoryRecordStore(); private val sink = Sink()
    private val state = File(Files.createTempDirectory("mat").toFile(), "materialized.json")
    private fun run() = ArticleMaterializer(records, sink, state).run()
    private var t = 1_700_000_000_000L

    private fun article(id: String, values: JSONObject, deleted: Boolean = false) {
        val rec = JSONObject().put("rev", JSONObject().put("t", ++t).put("d", "d_b")).put("f", JSONObject())
        if (deleted) rec.put("deleted", true) else rec.put("values", values)
        records.put("article:$id", rec)
    }
    private fun hl(id: String, url: String, text: String, type: String = "user", extra: JSONObject.() -> Unit = {}) {
        records.put("hl:$id", JSONObject().put("rev", JSONObject().put("t", ++t).put("d", "d_b")).put("f", JSONObject())
            .put("values", JSONObject().put("id", id).put("url", url).put("text", text).put("type", type).apply(extra)))
    }
    private fun values(title: String = "Prices", url: String = "https://econ.example/post", content: String = "<h1>Prices</h1><p>Prices rose faster than wages.</p><p>Second paragraph.</p>") =
        JSONObject().put("id", "x").put("title", title).put("url", url).put("content", content).put("timestamp", "2026-10-31T10:00:00Z")
            .put("summaryBase", "<p>A short summary.</p><ul><li>point</li></ul>").put("language", "en")

    @Test fun makesAReadingListArticleWithSummaryAndHighlights() {
        article("a1", values())
        hl("h1", "https://econ.example/post#section", "Prices rose faster than wages", "user")
        hl("h2", "https://econ.example/post", "AI picked this passage", "ghost")
        hl("h3", "https://other.example/", "A highlight on another page", "user")
        hl("h4", "https://econ.example/post", "dismissed highlight here", "ghost") { put("dismissed", true) }
        val r = run()
        assertEquals(1, r.saved)
        val (a, json) = sink.saved["a1"]!!
        assertEquals("Prices", a.title); assertEquals("econ.example", a.site); assertEquals("en", a.lang)
        assertEquals(listOf("h1" to "Prices", "p" to "Prices rose faster than wages.", "p" to "Second paragraph."), a.blocks.map { it.type to it.text })
        assertEquals("A short summary.\n\n- point", a.summary)
        assertEquals(listOf(false to "Prices rose faster than wages", true to "AI picked this passage"), a.highlights.map { it.ghost to it.text })
        assertEquals("the received time is the article's own date", java.time.Instant.parse("2026-10-31T10:00:00Z").toEpochMilli(), sink.received["a1"])
        assertEquals("a1", JSONObject(json).getString("aid"))
    }

    @Test fun aSecondRunTouchesNothingUntilSomethingChanges() {
        article("a1", values()); assertEquals(1, run().saved)
        assertEquals(0, run().saved)
        hl("h1", "https://econ.example/post", "A new highlight on the page", "user"); assertEquals("a new highlight updates the article", 1, run().saved)
        article("a1", values(title = "Prices, revised")); assertEquals(1, run().saved); assertEquals("Prices, revised", sink.saved["a1"]!!.first.title)
    }

    @Test fun aDeletionInTheBrowserRemovesWhatWasMade_andOnlyThat() {
        article("a1", values()); article("a2", values(url = "https://two.example/")); run()
        article("a1", JSONObject(), deleted = true)
        val r = run(); assertEquals(1, r.removed); assertFalse(sink.has("a1")); assertTrue(sink.has("a2"))
        // an article that came another way (sent from the browser) is never overwritten or removed
        sink.saved["own1"] = ArticleCodec.parse("""{"v":2,"url":"https://own.example/","blocks":[["p","own text here"]]}""", "own1") to "{}"
        article("own1", values(url = "https://own.example/"))
        assertEquals(1, run().skipped); assertEquals("own text here", sink.saved["own1"]!!.first.blocks.single().text)
        article("own1", JSONObject(), deleted = true); run(); assertTrue("not ours, so not deleted", sink.has("own1"))
    }

    @Test fun aRecordThatVanishedIsRemovedToo() {
        article("a1", values()); run(); records.remove("article:a1")
        assertEquals(1, run().removed); assertFalse(sink.has("a1"))
    }

    @Test fun skipsWhatCannotBeRead() {
        article("stub", values().put("feedStub", true))
        article("saved", values().put("savedOnly", true))
        article("empty", values(content = "", url = "https://e.example/").put("summaryBase", ""))
        article("badurl", values(url = "javascript:alert(1)"))
        article("bad/id", values())
        val r = run(); assertEquals(0, r.saved); assertTrue(r.skipped >= 4); assertTrue(sink.saved.isEmpty())
    }

    @Test fun fallsBackToTheSummaryWhenTheFullTextIsNotOnTheSyncedDevice() {
        article("a1", values(content = ""))
        assertEquals(1, run().saved); assertEquals("A short summary.", sink.saved["a1"]!!.first.blocks.first().text)
        assertNotNull(sink.saved["a1"])
    }
}
