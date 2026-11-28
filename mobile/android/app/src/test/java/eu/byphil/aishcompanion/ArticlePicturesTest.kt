package eu.byphil.aishcompanion

import eu.byphil.aishcompanion.sync.MemoryRecordStore
import eu.byphil.aishcompanion.sync.SyncClock
import eu.byphil.aishcompanion.sync.SyncFields
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** Pictures saved inside an article's text: kept as files, shown in their place, and nothing else taken for one. */
class ArticlePicturesTest {
    @get:Rule val folder = TemporaryFolder()

    private val png = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 13, 10, 26, 10, 1, 2, 3, 4)
    private fun data(bytes: ByteArray, kind: String = "png") = "data:image/$kind;base64," + java.util.Base64.getEncoder().encodeToString(bytes)

    @Test fun picturesStandWhereTheyWereInTheText() {
        val pictures = ArticlePictures()
        val html = "<p>Before.</p><figure><picture><source srcset=\"x\"><img data-src=\"no\" alt=\"A &amp; B\" src=\"${data(png)}\"></picture></figure><ul><li>One <img src='${data(png)}'> two</li></ul><p>After.</p>"
        val blocks = HtmlBlocks.toBlocks(html, pictures)
        assertEquals(listOf("p" to "Before.", "img:0" to "A & B", "li" to "One", "img:1" to "", "li" to "two", "p" to "After."), blocks)
        assertArrayEquals(png, pictures.found["0"])
        assertEquals("without a place to keep them there are none", listOf("p", "li", "p"), HtmlBlocks.toBlocks(html).map { it.first })
    }

    @Test fun onlyRealPicturesFromTheTextItself() {
        val pictures = ArticlePictures()
        assertNull("never loaded from an address", pictures.take("https://example.org/a.png"))
        assertNull("no drawing that can carry script", pictures.take("data:image/svg+xml;base64,PHN2Zz4="))
        assertNull("not what it says it is", pictures.take(data("<html>".toByteArray())))
        assertNull(pictures.take("data:image/png;base64,%%%"))
        assertNull("too large", pictures.take(data(png + ByteArray(ArticlePictures.MAX_BYTES))))
        repeat(ArticlePictures.MOST) { pictures.take(data(png)) }
        assertNull("not without end", pictures.take(data(png)))
        assertEquals(ArticlePictures.MOST, pictures.found.size)
    }

    @Test fun theLibrarysArticlesBringTheirPictures() {
        val records = MemoryRecordStore(); val clock = SyncClock(device = "d")
        val values = JSONObject().put("url", "https://example.org/a").put("title", "A").put("content", "<img src=\"${data(png)}\" alt=\"Cat\"><p>A paragraph of text.</p>")
        records.put("article:a1", SyncFields.stampRecord(null, values, clock, 1_700_000_000_000L).record)
        val saved = HashMap<String, Article>(); val kept = HashMap<String, Map<String, ByteArray>>()
        val sink = object : ArticleSink {
            override fun save(article: Article, json: String, receivedAt: Long) { saved[article.id] = article }
            override fun delete(id: String) { saved.remove(id) }
            override fun has(id: String) = id in saved
            override fun pictures(id: String, pictures: Map<String, ByteArray>) { kept[id] = HashMap(pictures) }
        }
        val state = folder.newFile("state.json")
        // as an app before pictures left it: made, from the same record
        state.writeText(JSONObject().put("a1", "1700000000000:0").toString())
        saved["a1"] = Article("a1", "https://example.org/a", "A", "example.org", "", "", "", listOf(Block("p", "A paragraph of text.")), 0, false)
        assertEquals(1, ArticleMaterializer(records, sink, state).run().saved)
        assertEquals(listOf(Block("img", "Cat", "0"), Block("p", "A paragraph of text.")), saved["a1"]!!.blocks)
        assertArrayEquals(png, kept["a1"]!!["0"])
        assertEquals("once", 0, ArticleMaterializer(records, sink, state).run().saved)
    }

    @Test fun aMarkStaysWithItsParagraphWhenPicturesComeIn() {
        val before = listOf(Block("p", "Sleep helps."), Block("p", "Other words."), Block("p", "Sleep helps."))
        val after = listOf(Block("img", "Sleep helps.", "0")) + before.take(2) + Block("img", "", "1") + before[2]
        val mark = listOf(Highlight(false, "Sleep helps."))
        // marked in the third paragraph, before there were pictures
        val anchor = mapOf("Sleep helps." to (Highlighter.anchorOf(before, 2) to 0))
        assertEquals(setOf(2), Highlighter.place(before, mark, anchor).keys)
        assertEquals("not the first place with the same words, and never a picture", setOf(4), Highlighter.place(after, mark, anchor).keys)
        assertEquals(2, Highlighter.anchorOf(after, 4))
    }
}
