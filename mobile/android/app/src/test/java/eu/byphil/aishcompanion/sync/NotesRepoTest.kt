package eu.byphil.aishcompanion.sync

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Notes on the phone: offline first, tags like the browser, and a round trip with the browser through an encrypted place. */
class NotesRepoTest {
    private class Mem : KeyValue { val m = HashMap<String, String>(); override fun get(key: String) = m[key]; override fun put(key: String, value: String?) { if (value == null) m.remove(key) else m[key] = value } }
    private var t = 1_700_000_000_000L
    private val server = MemoryStore()
    private val cfg = LibrarySync.Config(kind = "webdav", url = "https://cloud.test/dav/", username = "phil", password = "secret")
    private fun lib(kv: Mem = Mem(), records: RecordStore = MemoryRecordStore()) = LibrarySync(kv, records, storeFactory = { server }, now = { t })

    @Test fun splitsTrailingTagsLikeTheBrowser() {
        assertEquals("Ask Anna" to listOf("todo", "inflation"), NoteText.split("Ask Anna #todo #inflation"))
        assertEquals("a hash in the middle # stays" to emptyList<String>(), NoteText.split("a hash in the middle # stays"))
        assertEquals("" to listOf("a"), NoteText.split("#a"))
        assertEquals("Ünï" to listOf("tág"), NoteText.split("Ünï #tág"))
        assertEquals("C#sharp" to emptyList<String>(), NoteText.split("C#sharp"))
    }

    @Test fun addsEditsAndDeletesOffline() {
        val repo = NotesRepo(lib(), { t++ })
        assertNull("empty text is not a note", repo.add("   #tag"))
        val n = repo.add("Write to Anna #todo #todo #People", url = "https://x.test/a", title = "A page")!!
        assertEquals("Write to Anna", n.text); assertEquals("tags are a set, shown in a steady order", listOf("People", "todo"), n.tags); assertEquals("https://x.test/a", n.url)
        assertTrue(n.created.startsWith("2023-11-14T")); assertEquals(1, repo.list().size)
        assertTrue(repo.update(n.id, "Write to Anna today #done")); assertEquals("Write to Anna today", repo.list().single().text); assertEquals(listOf("done"), repo.list().single().tags)
        assertFalse("an empty edit is refused", repo.update(n.id, "  ")); assertFalse(repo.update("missing", "x"))
        assertTrue(repo.delete(n.id)); assertTrue(repo.list().isEmpty())
    }

    @Test fun anOfflineNoteReachesTheBrowserAndABrowserNoteArrives() {
        val (meta, opened) = SyncCrypto.createMeta("a long passphrase", 1000)
        server.put("meta.json", meta.toString().toByteArray(), "application/json")
        // the browser side, with its own note
        val bRecords = MemoryRecordStore(); val bClock = SyncClock(device = "d_browser")
        val bNote = JSONObject().put("id", "nb1").put("kind", "note").put("text", "From the browser").put("created", "2026-10-29T10:00:00Z")
        bRecords.put("note:nb1", SyncFields.stampRecord(null, SyncFields.noteFields(bNote), bClock, ++t).record)
        fun browserRun() = SyncEngine(server, opened.keys, meta, bRecords, bClock, "p1", now = { t }).run()
        browserRun()
        // the phone writes a note BEFORE it has joined anything, then joins and syncs
        val kv = Mem(); val l = lib(kv); val repo = NotesRepo(l, { t++ })
        val mine = repo.add("Written on the phone #bus")!!
        l.connect(cfg, "a long passphrase"); val s = l.syncNow()
        assertEquals(1, s.pulled); assertEquals(1, s.pushed)
        assertEquals(setOf("From the browser", "Written on the phone"), repo.list().map { it.text }.toSet())
        // the browser receives it, with its tag
        browserRun()
        val got = SyncFields.noteOf(bRecords.get("note:${mine.id}")!!)!!
        assertEquals("Written on the phone", got.getString("text")); assertEquals("bus", got.getJSONArray("tags").getString(0)); assertEquals("note", got.getString("kind"))
        // an edit and a deletion made on the phone travel too
        assertTrue(repo.update(mine.id, "Written on the phone, edited")); assertTrue(repo.delete("nb1".let { mine.id }))
        l.syncNow(); browserRun()
        assertTrue("the deletion arrived as a marker", bRecords.get("note:${mine.id}")!!.optBoolean("deleted", false))
        assertNotNull(bRecords.get("note:nb1"))
    }
}
