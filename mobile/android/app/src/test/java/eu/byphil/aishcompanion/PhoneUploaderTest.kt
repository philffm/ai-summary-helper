package eu.byphil.aishcompanion

import eu.byphil.aishcompanion.sync.KeyValue
import eu.byphil.aishcompanion.sync.LibrarySync
import eu.byphil.aishcompanion.sync.MemoryRecordStore
import eu.byphil.aishcompanion.sync.MemoryStore
import eu.byphil.aishcompanion.sync.SyncClock
import eu.byphil.aishcompanion.sync.SyncCrypto
import eu.byphil.aishcompanion.sync.SyncEngine
import eu.byphil.aishcompanion.sync.SyncFields
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class PhoneUploaderTest {
    private var t = 1_700_000_000_000L
    private val records = MemoryRecordStore()
    private val state = File(Files.createTempDirectory("up").toFile(), "uploaded.json")
    private val clock = SyncClock(device = "d_phone")
    private fun uploader() = PhoneUploader(records, { ++t }, state)
    private var list = emptyList<PhoneArticle>()
    private val source = object : PhoneArticles { override fun all() = list }
    private fun run() = uploader().run(source, clock)
    private fun art(id: String, url: String, local: Boolean = true, aid: String = "", hl: List<String> = emptyList(), blocks: List<Pair<String, String>> = listOf("h1" to "Title", "p" to "Body <b>& more</b>.", "li" to "one", "li" to "two", "q" to "Quote")) =
        PhoneArticle(id, url, "Title $id", 1_700_000_000_000L, blocks, "Intro.\n\n- point a\n- point b\n\nEnd.", hl, local, aid)
    private fun libraryArticle(id: String, url: String, deleted: Boolean = false) {
        val rec = JSONObject().put("rev", JSONObject().put("t", ++t).put("d", "d_browser")).put("f", JSONObject())
        records.put("article:$id", if (deleted) rec.put("deleted", true) else rec.put("values", JSONObject().put("url", url).put("content", "<p>browser text</p>")))
    }

    @Test fun aPageOnlyThePhoneHasGoesUpAsCleanHtml() {
        list = listOf(art("a1", "https://phone.example/post"))
        assertEquals(1, run().articles)
        val v = records.get("article:ph_a1")!!.getJSONObject("values")
        assertEquals("ph_a1", v.getString("id")); assertEquals("https://phone.example/post", v.getString("url")); assertEquals("Title a1", v.getString("title"))
        assertEquals("2023-11-14T22:13:20Z", v.getString("timestamp"))
        assertEquals("<h1>Title</h1><p>Body &lt;b&gt;&amp; more&lt;/b&gt;.</p><ul><li>one</li><li>two</li></ul><blockquote><p>Quote</p></blockquote>", v.getString("content"))
        assertEquals("<p>Intro.</p><ul><li>point a</li><li>point b</li></ul><p>End.</p>", v.getString("summaryBase"))
        assertEquals(setOf("article:ph_a1"), uploader().ownKeys())
        assertEquals("nothing changes the second time", 0, run().articles)
    }

    @Test fun aPageTheLibraryAlreadyHasIsNeverUploaded_inAnySpelling() {
        libraryArticle("b1", "https://www.econ.example/post/")
        for ((i, url) in listOf("https://econ.example/post", "http://econ.example/post?utm_source=x&fbclid=1", "https://econ.example/post#section").withIndex()) list = list + art("p$i", url)
        assertEquals(0, run().articles); assertNull(records.get("article:ph_p0")); assertEquals(emptySet<String>(), uploader().ownKeys())
        // a different query parameter is a different page
        list = listOf(art("q1", "https://econ.example/post?id=2")); assertEquals(1, run().articles)
    }

    @Test fun aPageTheBrowserDeletedCountsAsNotThere() {
        libraryArticle("b1", "https://gone.example/post", deleted = true)
        list = listOf(art("a1", "https://gone.example/post")); assertEquals(1, run().articles)
    }

    @Test fun onlyPagesSummarizedOnThePhoneGoUp() {
        list = listOf(art("sent", "https://sent.example/x", local = false), art("withAid", "https://aid.example/x", local = false, aid = "b9"), art("empty", "https://e.example/x", blocks = emptyList()), art("badurl", "javascript:alert(1)"))
        assertEquals(0, run().articles); assertTrue(records.keys("article:").isEmpty())
    }

    @Test fun phoneHighlightsGoUpForLibraryPagesAndForUploadedOnes_andComeBackOffWhenUnmarked() {
        libraryArticle("b1", "https://econ.example/post")
        list = listOf(art("viaAid", "https://econ.example/post", local = false, aid = "b1", hl = listOf("Prices rose faster than wages", "Wages lag")), art("own", "https://phone.example/a", hl = listOf("A passage of mine")))
        val r = run(); assertEquals(1, r.articles); assertEquals(3, r.highlights)
        val keys = records.keys("hl:"); assertEquals(3, keys.size)
        val v = records.get(keys.first { records.get(it)!!.getJSONObject("values").getString("text").startsWith("Prices") })!!.getJSONObject("values")
        assertEquals("user", v.getString("type")); assertEquals("https://econ.example/post", v.getString("url")); assertTrue(v.getString("id").startsWith("ph_"))
        assertEquals("a second run changes nothing", 0, run().highlights)
        // one passage unmarked on the phone: a deletion marker, the others stay
        list = listOf(art("viaAid", "https://econ.example/post", local = false, aid = "b1", hl = listOf("Prices rose faster than wages")), art("own", "https://phone.example/a", hl = listOf("A passage of mine")))
        assertEquals(1, run().removed)
        assertEquals(1, keys.count { records.get(it)!!.optBoolean("deleted", false) }); assertEquals(2, keys.count { !records.get(it)!!.optBoolean("deleted", false) })
    }

    @Test fun aHighlightOnAPageTheLibraryLacksIsNotUploaded() {
        list = listOf(art("sent", "https://sent.example/x", local = false, hl = listOf("A passage with nowhere to go")))
        assertEquals(0, run().highlights); assertTrue(records.keys("hl:").isEmpty())
    }

    @Test fun theReadingListDoesNotTurnItsOwnUploadsBackIntoArticles() {
        list = listOf(art("a1", "https://phone.example/post", hl = listOf("A passage of mine")))
        run()
        val sink = object : ArticleSink { val saved = HashMap<String, Article>(); override fun save(article: Article, json: String, receivedAt: Long) { saved[article.id] = article }; override fun delete(id: String) { saved.remove(id) }; override fun has(id: String) = saved.containsKey(id) }
        val r = ArticleMaterializer(records, sink, File(Files.createTempDirectory("m").toFile(), "m.json"), own = { uploader().ownKeys() }).run()
        assertEquals(0, r.saved); assertTrue(sink.saved.isEmpty())
        assertEquals("without the guard it would", 1, ArticleMaterializer(records, sink, File(Files.createTempDirectory("m").toFile(), "m.json")).run().saved)
    }

    @Test fun aWholeRoundTripThroughAnEncryptedPlace() {
        // the browser: a library with one article of its own
        val server = MemoryStore(); val (meta, opened) = SyncCrypto.createMeta("a long passphrase", 1000)
        server.put("meta.json", meta.toString().toByteArray(), "application/json")
        val bRecords = MemoryRecordStore(); val bClock = SyncClock(device = "d_browser")
        bRecords.put("article:b1", SyncFields.stampRecord(null, JSONObject().put("id", "b1").put("url", "https://econ.example/post").put("title", "Browser article").put("content", "<p>browser text</p>"), bClock, ++t).record)
        fun browser() = SyncEngine(server, opened.keys, meta, bRecords, bClock, "p1", now = { t }, owned = setOf("note", "article", "hl")).run()   // the test stands in for the browser, which owns everything
        browser()
        // the phone: joins, has one page of its own and one marked passage on the browser's page
        val kv = object : KeyValue { val m = HashMap<String, String>(); override fun get(key: String) = m[key]; override fun put(key: String, value: String?) { if (value == null) m.remove(key) else m[key] = value } }
        val pRecords = MemoryRecordStore()
        val upFile = File(Files.createTempDirectory("rt").toFile(), "u.json")
        val phone = LibrarySync(kv, pRecords, storeFactory = { server }, now = { t }, afterPull = { c ->
            val u = PhoneUploader(pRecords, { ++t }, upFile)
            u.run(object : PhoneArticles { override fun all() = listOf(art("a1", "https://phone.example/post"), art("viaB", "https://econ.example/post", local = false, aid = "b1", hl = listOf("Prices rose faster than wages"))) }, c)
            u.ownKeys()
        })
        phone.connect(LibrarySync.Config(kind = "webdav", url = "https://cloud.test/dav/", username = "phil", password = "secret"), "a long passphrase")
        val s = phone.syncNow(); assertTrue(s.errors.toString(), s.errors.isEmpty()); assertEquals("the page and the passage went up", 2, s.pushed)
        browser()
        assertNotNull(bRecords.get("article:ph_a1")); assertEquals("<p>browser text</p>", bRecords.get("article:b1")!!.getJSONObject("values").getString("content"))
        assertEquals("the browser's own article is untouched", "Browser article", bRecords.get("article:b1")!!.getJSONObject("values").getString("title"))
        val hl = bRecords.keys("hl:").map { bRecords.get(it)!!.getJSONObject("values") }.single(); assertEquals("Prices rose faster than wages", hl.getString("text")); assertEquals("https://econ.example/post", hl.getString("url"))
        // a second sync does not send anything again
        assertEquals(0, phone.syncNow().pushed)
        assertFalse(bRecords.keys("note:").isNotEmpty())
    }
}
