package eu.byphil.aishcompanion.sync

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** A store in memory with the conditions of a real one; `puts` counts uploads, `beforePut` lets a test change the server under the engine's feet. */
class MemoryStore : SyncStore {
    val files = LinkedHashMap<String, Pair<ByteArray, String>>(); var puts = 0; private var n = 0; var beforePut: ((String) -> Unit)? = null
    override fun ping() = true
    override fun put(path: String, body: ByteArray, contentType: String, ifMatch: String?, ifNoneMatch: String?): String {
        beforePut?.let { beforePut = null; it(path) }
        val cur = files[path]
        if (ifNoneMatch == "*" && cur != null) throw StoreError(412, "exists")
        if (ifMatch != null && (cur == null || cur.second != ifMatch)) throw StoreError(412, "changed")
        val etag = "e${++n}"; files[path] = body to etag; puts++; return etag
    }
    override fun get(path: String) = files[path]?.let { Fetched(it.first, it.second) }
    override fun remove(path: String) = files.remove(path) != null
    override fun list(prefix: String) = files.filter { it.key.substringBeforeLast('/', "") == prefix.trimEnd('/') }.map { StoredFile(it.key, it.value.second, it.value.first.size.toLong()) }
}

class SyncEngineTest {
    private val server = MemoryStore()
    private val opened = SyncCrypto.createMeta("pw pw pw pw", 1000)
    private val meta = opened.first; private val keys = opened.second.keys
    private var clockNow = 1_700_000_000_000L

    /** One phone: its own records and clock. */
    inner class Phone(val label: String) {
        val records = MemoryRecordStore(); val clock = SyncClock(device = "d_$label")
        fun engine(store: SyncStore = server) = SyncEngine(store, keys, meta, records, clock, "p1", now = { clockNow })
        fun sync(store: SyncStore = server, confirm: Boolean = false) = engine(store).run(confirmDeletes = confirm)
        fun addNote(id: String, text: String, tags: List<String> = emptyList()): String {
            val note = JSONObject().put("id", id).put("kind", "note").put("text", text).put("created", clockNow).put("tags", org.json.JSONArray(tags))
            records.put("note:$id", SyncFields.stampRecord(null, SyncFields.noteFields(note), clock, ++clockNow).record); return "note:$id"
        }
        fun editNote(id: String, text: String) {
            val rec = records.get("note:$id")!!; val note = SyncFields.noteOf(rec)!!.put("text", text)
            records.put("note:$id", SyncFields.stampRecord(rec, SyncFields.noteFields(note), clock, ++clockNow).record)
        }
        fun deleteNote(id: String) { records.put("note:$id", SyncFields.tombstone(records.get("note:$id"), clock, ++clockNow).record) }
        fun text(id: String) = records.get("note:$id")?.let { SyncFields.noteOf(it) }?.optString("text")
        fun tags(id: String) = records.get("note:$id")?.let { SyncFields.noteOf(it) }?.optJSONArray("tags")?.let { a -> (0 until a.length()).map { a.getString(it) }.sorted() }
    }

    /** A record from the browser, as the extension writes it (the test plays the extension). */
    private fun browserWrites(key: String, values: JSONObject, t: Long = 1_699_000_000_000L): String {
        val f = JSONObject(); for (k in values.keys()) f.put(k, JSONObject().put("t", t).put("h", SyncStamps.hashValue(values.get(k))))
        val file = JSONObject().put("aish", "rec/1").put("key", key).put("rev", JSONObject().put("t", t).put("d", "d_browser")).put("f", f).put("values", values)
        val name = SyncCrypto.nameOf(keys, key.substringBefore(':'), key.substringAfter(':'))
        server.put("r/$name", SyncCrypto.encrypt(keys, file.toString())); return name
    }

    @Test fun notesTravelBothWaysAndASecondRoundDoesNothing() {
        val a = Phone("A"); val b = Phone("B")
        a.addNote("n1", "Ask Anna", listOf("todo")); val r1 = a.sync(); assertEquals(1, r1.pushed); assertTrue(r1.errors.isEmpty())
        val r2 = b.sync(); assertEquals(1, r2.pulled); assertEquals("Ask Anna", b.text("n1")); assertEquals(listOf("todo"), b.tags("n1")); assertEquals(0, r2.pushed)
        val puts = server.puts; a.sync(); b.sync(); a.sync(); assertEquals("nothing is rewritten after convergence", puts, server.puts)
        assertTrue(server.files.keys.none { it.contains("Ask") } && server.files.values.none { String(it.first, Charsets.ISO_8859_1).contains("Anna") })
    }

    @Test fun editsMergeAndTheLaterOneWins() {
        val a = Phone("A"); val b = Phone("B")
        a.addNote("n1", "first"); a.sync(); b.sync()
        a.editNote("n1", "from A"); b.editNote("n1", "from B")   // B is later
        a.sync(); b.sync(); a.sync(); b.sync()
        assertEquals("from B", a.text("n1")); assertEquals("from B", b.text("n1"))
        assertEquals(a.records.get("note:n1")!!.toString().length, b.records.get("note:n1")!!.toString().length)
    }

    @Test fun aDeleteReachesTheOtherPhoneAndANewerEditBringsTheNoteBack() {
        val a = Phone("A"); val b = Phone("B")
        a.addNote("n1", "x"); a.sync(); b.sync()
        a.deleteNote("n1"); a.sync(); b.sync(); assertNull(b.text("n1")); assertTrue(b.records.get("note:n1")!!.optBoolean("deleted"))
        val c = Phone("C"); c.sync(); assertNull(c.text("n1"))
    }

    @Test fun whatTheBrowserSendsIsReceivedAndNeverSentBack() {
        val a = Phone("A")
        browserWrites("article:a1", JSONObject().put("title", "Hello").put("url", "https://x.test/1").put("tag:ai", "AI"))
        browserWrites("hl:h1", JSONObject().put("url", "https://x.test/1").put("text", "quoted"))
        val puts = server.puts; val r = a.sync()
        assertEquals(2, r.pulled); assertEquals(setOf("article:a1", "hl:h1"), r.changed); assertEquals(0, r.pushed); assertEquals(puts, server.puts)
        assertEquals("Hello", a.records.get("article:a1")!!.getJSONObject("values").getString("title"))
        a.sync(); assertEquals(puts, server.puts)
    }

    @Test fun aDamagedFileIsReportedAndLeftAlone() {
        val a = Phone("A"); val b = Phone("B")
        a.addNote("n1", "x"); a.sync()
        val name = server.files.keys.first { it.startsWith("r/") }; val etag = server.files[name]!!.second
        server.files[name] = ByteArray(40) { 7 } to "bad1"
        val r = b.sync(); assertTrue(r.errors.isNotEmpty()); assertNull(b.text("n1"))
        a.editNote("n1", "changed"); val r2 = a.sync(); assertTrue("A does not push over a file it cannot read", r2.errors.isNotEmpty()); assertEquals("bad1", server.files[name]!!.second)
        assertNotNull(etag)
    }

    @Test fun aFileThatIsNotWhatItsNameSaysIsRejected() {
        val a = Phone("A")
        val good = browserWrites("article:real", JSONObject().put("title", "Real"))
        val forged = server.files["r/$good"]!!
        server.files["r/" + SyncCrypto.nameOf(keys, "article", "other")] = forged   // a valid file copied under another record's name
        val r = a.sync(); assertEquals(1, r.errors.size); assertNull(a.records.get("article:other")); assertNotNull(a.records.get("article:real"))
    }

    @Test fun aConflictOnUploadIsMergedAndRetried() {
        val a = Phone("A"); val b = Phone("B")
        a.addNote("n1", "one"); a.sync(); b.sync()
        a.editNote("n1", "A edit")
        server.beforePut = { b.editNote("n1", "B edit"); b.sync() }   // B gets there first, between A's listing and A's upload
        val r = a.sync(); assertTrue(r.errors.joinToString(), r.errors.isEmpty())
        b.sync(); assertEquals(a.text("n1"), b.text("n1")); assertEquals("B edit", a.text("n1"))
    }

    @Test fun aFloodOfDeletionsWaitsForAYes() {
        val a = Phone("A"); val b = Phone("B")
        for (i in 0 until 24) a.addNote("n$i", "t$i")
        a.sync(); b.sync(); assertEquals(24, b.records.keys("note:").size)
        for (i in 0 until 18) a.deleteNote("n$i"); a.sync()
        val r = b.sync(); assertEquals(8, r.needsConfirm); assertEquals(14, (0 until 24).count { b.text("n$it") != null })
        assertEquals(8, b.sync().needsConfirm); assertEquals(14, (0 until 24).count { b.text("n$it") != null })
        val ok = b.sync(confirm = true); assertEquals(0, ok.needsConfirm); assertEquals(6, (0 until 24).count { b.text("n$it") != null })
    }

    @Test fun aPlaceThatWasSetUpAgainStops() {
        val a = Phone("A"); a.addNote("n1", "x"); a.sync()
        val other = SyncCrypto.createMeta("another passphrase", 1000)
        val e = assertThrows(StoreError::class.java) { SyncEngine(server, other.second.keys, other.first, a.records, a.clock, "p1", now = { clockNow }).run() }
        assertTrue(e.message!!.contains("set up again"))
    }

    @Test fun aLongAbsenceSendsOnlyWhatChangedSince() {
        val a = Phone("A"); a.addNote("old", "from before"); a.sync()
        val b = Phone("B"); b.addNote("stale", "old on B"); b.sync(); b.records.saveLedger("p1", b.records.ledger("p1").put("lastSync", clockNow - 120L * 24 * 3600 * 1000))
        server.files.remove("r/" + SyncCrypto.nameOf(keys, "note", "stale"))
        val r = b.sync(); assertTrue(r.stale); assertEquals("its old note was not pushed back", 0, r.pushed); assertNotNull(b.text("stale"))
        b.editNote("stale", "edited since"); assertEquals(1, b.sync().pushed)
        assertFalse(b.sync().stale)
    }
}
