package eu.byphil.aishcompanion

import eu.byphil.aishcompanion.sync.KeyValue
import eu.byphil.aishcompanion.sync.LibrarySync
import eu.byphil.aishcompanion.sync.MemoryRecordStore
import eu.byphil.aishcompanion.sync.MemoryStore
import eu.byphil.aishcompanion.sync.SyncCrypto
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.util.Base64

/** The library's feed list: read as the extension writes it, and joined with the feeds of the phone. */
class FeedListTest {
    @get:Rule val folder = TemporaryFolder()

    private val library = LibrarySync(object : KeyValue { override fun get(key: String): String? = null; override fun put(key: String, value: String?) {} }, MemoryRecordStore())

    @Test fun theDocumentTheExtensionWritesIsRead() {
        val vector = JSONObject(javaClass.classLoader!!.getResourceAsStream("feed-list-vector.json")!!.readBytes().toString(Charsets.UTF_8))
        val keys = SyncCrypto.openMeta(vector.getJSONObject("meta"), vector.getString("passphrase")).keys
        val store = MemoryStore()
        assertNull("a library without one", library.feedList(store, keys))
        store.put("feeds.bin", Base64.getDecoder().decode(vector.getString("file")))
        val entries = library.feedList(store, keys)!!.associateBy { it.url }
        assertEquals(setOf("https://policy.example/feed", "https://energy.example/feed", "https://gone.example/feed"), entries.keys)
        assertEquals(listOf("Politics", "Grüße"), entries["https://policy.example/feed"]!!.tags)
        assertEquals(true, entries["https://gone.example/feed"]!!.removed)
        store.put("feeds.bin", SyncCrypto.encrypt(keys, "{\"aish\":\"feeds/2\",\"entries\":[]}"))
        assertNull("a newer kind is not guessed at", library.feedList(store, keys))
    }

    @Test fun theListJoinsTheFeedsOfThePhone() {
        val feeds = FeedStore(folder.newFolder("feeds"))
        feeds.add("https://mine.example/feed", "Mine", emptyList(), 1)
        fun live(url: String, at: Long, title: String = "T", tags: List<String> = emptyList()) = FeedEntry(url, title, tags, at)
        fun gone(url: String, at: Long) = FeedEntry(url, "", emptyList(), at, true)
        val a = "https://a.example/feed"
        fun urls() = feeds.feeds().map { it.url }.toSet()
        var now = 1_000L
        fun take(vararg list: FeedEntry) = feeds.takeLibrary("p1", list.toList(), ++now)
        take(live(a, 100, tags = listOf("News")))
        assertEquals(setOf("https://mine.example/feed", a), urls())
        assertEquals(listOf("News"), feeds.feeds().first { it.url == a }.tags)
        // removed on the phone: it stays away, until it is added again in the browser later
        feeds.remove(a)
        take(live(a, 100)); take(live(a, 100))
        assertEquals(setOf("https://mine.example/feed"), urls())
        take(live(a, 5_000))
        assertEquals(setOf("https://mine.example/feed", a), urls())
        // removed in the browser
        take(gone(a, 9_000))
        assertEquals(setOf("https://mine.example/feed"), urls())
        // many at once are held back; a list that vanished here comes back
        val many = (0 until 30).map { "https://m$it.example/feed" }
        take(*many.map { live(it, 10_000) }.toTypedArray())
        take(*many.map { gone(it, 20_000) }.toTypedArray())
        take(*many.map { gone(it, 20_000) }.toTypedArray())
        assertEquals(31, urls().size)
        feeds.saveFeeds(emptyList())
        take(*many.map { live(it, 10_000) }.toTypedArray())
        assertEquals(30, urls().size)
    }
}
