package eu.byphil.aishcompanion.sync

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** Joining the browser's library from the phone: what is kept, what is not, and one real round trip. */
class LibrarySyncTest {
    private class Mem : KeyValue { val m = HashMap<String, String>(); override fun get(key: String) = m[key]; override fun put(key: String, value: String?) { if (value == null) m.remove(key) else m[key] = value } }
    private val server = MemoryStore()
    private val cfg = LibrarySync.Config(kind = "webdav", url = "https://cloud.test/dav/", username = "phil", password = "secret")
    private var clockNow = 1_700_000_000_000L

    /** The browser's side: an encrypted library with this passphrase, one note in it. */
    private fun browser(passphrase: String): Pair<SyncCrypto.Keys, JSONObject> {
        val (meta, opened) = SyncCrypto.createMeta(SyncPassphrase.canonical(passphrase), 1000)
        server.put("meta.json", meta.toString().toByteArray(), "application/json")
        val records = MemoryRecordStore(); val clock = SyncClock(device = "d_browser")
        val note = JSONObject().put("id", "n1").put("kind", "note").put("text", "From the browser").put("created", clockNow)
        records.put("note:n1", SyncFields.stampRecord(null, SyncFields.noteFields(note), clock, ++clockNow).record)
        SyncEngine(server, opened.keys, meta, records, clock, "p1", now = { clockNow }).run()
        return opened.keys to meta
    }
    private fun phone(kv: Mem = Mem(), records: RecordStore = MemoryRecordStore()) = LibrarySync(kv, records, storeFactory = { server }, now = { clockNow })

    @Test fun refusesAFolderWithNoLibrary() {
        val p = phone()
        val e = assertThrows(IllegalStateException::class.java) { p.connect(cfg, "anything at all here") }
        assertTrue(e.message!!.contains("Set up sync in the browser first"))
        assertFalse(p.isConnected())
    }

    @Test fun aWrongPassphraseSavesNothing() {
        browser("a long passphrase")
        val kv = Mem(); val p = phone(kv)
        assertThrows(SyncCrypto.WrongKey::class.java) { p.connect(cfg, "not the passphrase") }
        assertFalse(p.isConnected()); assertTrue("nothing was stored", kv.m.isEmpty())
    }

    @Test fun joinsWithSuggestedWordsInAnySpellingAndKeepsThemToShowAgain() {
        val words = SyncWordlist.WORDS.take(6).joinToString(" ")
        browser(words)
        val p = phone()
        p.connect(cfg, words.uppercase().replace(" ", "-  "))
        assertTrue(p.isConnected()); assertEquals("the canonical spelling", words, p.passphrase()); assertEquals("host only, never the login", "cloud.test", p.config()!!.label())
    }

    @Test fun anOwnPassphraseIsNeverKept() {
        browser("a long passphrase")
        val kv = Mem(); val p = phone(kv)
        p.connect(cfg, "a long passphrase")
        assertTrue(p.isConnected()); assertNull(p.passphrase())
        assertFalse("the passphrase is nowhere in storage", kv.m.values.any { it.contains("a long passphrase") })
    }

    @Test fun syncsTheBrowsersRecordsAndRemembersTheClock() {
        browser("a long passphrase")
        val kv = Mem(); val records = MemoryRecordStore(); val p = phone(kv, records)
        p.connect(cfg, "a long passphrase")
        val s = p.syncNow()
        assertEquals(1, s.pulled); assertTrue(s.errors.isEmpty())
        assertEquals("From the browser", SyncFields.noteOf(records.get("note:n1")!!)!!.getString("text"))
        assertTrue(p.lastSyncAt() > 0); assertNull(p.lastError()); assertNotNull(kv.get("clock")); assertNotNull(kv.get("device"))
        // a second run changes nothing and keeps the same device id
        val device = kv.get("device"); assertEquals(0, p.syncNow().pulled); assertEquals(device, kv.get("device"))
    }

    @Test fun anErrorIsKeptForTheScreen() {
        browser("a long passphrase")
        val kv = Mem(); val p = phone(kv); p.connect(cfg, "a long passphrase")
        server.files.remove("meta.json")
        assertThrows(IllegalStateException::class.java) { p.syncNow() }
        assertTrue(p.lastError()!!.contains("meta.json"))
    }

    @Test fun disconnectForgetsTheKeyAndTheWordsButNotTheReceivedRecords() {
        val words = SyncWordlist.WORDS.take(6).joinToString(" ")
        browser(words)
        val kv = Mem(); val records = MemoryRecordStore(); val p = phone(kv, records)
        p.connect(cfg, words); p.syncNow(); p.disconnect()
        assertFalse(p.isConnected()); assertNull(p.passphrase()); assertEquals("only the device id stays, it names this phone in the records it wrote", setOf("device"), kv.m.keys); assertNotNull("the phone's copy stays", records.get("note:n1"))
        assertThrows(IllegalStateException::class.java) { p.syncNow() }
    }
}
