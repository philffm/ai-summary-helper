package eu.byphil.aishcompanion.sync

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.security.MessageDigest

/** A store on a plain directory (a synced folder): etag = hash of the content, so the extension's test script can read and write the same files. */
class DirStore(private val root: File) : SyncStore {
    private fun f(path: String) = File(root, path)
    private fun etag(b: ByteArray) = MessageDigest.getInstance("SHA-1").digest(b).joinToString("") { "%02x".format(it) }
    override fun ping() = root.isDirectory
    override fun put(path: String, body: ByteArray, contentType: String, ifMatch: String?, ifNoneMatch: String?): String {
        val file = f(path); val cur = file.takeIf { it.exists() }?.readBytes()?.let { etag(it) }
        if (ifNoneMatch == "*" && cur != null) throw StoreError(412, "exists")
        if (ifMatch != null && cur != ifMatch) throw StoreError(412, "changed")
        file.parentFile.mkdirs(); file.writeBytes(body); return etag(body)
    }
    override fun get(path: String) = f(path).takeIf { it.isFile }?.readBytes()?.let { Fetched(it, etag(it)) }
    override fun remove(path: String) = f(path).delete()
    override fun list(prefix: String) = (f(prefix).listFiles { x -> x.isFile } ?: emptyArray()).map { StoredFile((prefix.trim('/') + "/" + it.name).trimStart('/'), etag(it.readBytes()), it.length()) }
}

/**
 * Runs only when plugin/tests/xsync.mjs drives it (AISH_XSYNC_DIR is set): the extension's engine and this phone engine sync through one folder,
 * one after the other, and each must understand what the other wrote.
 */
class CrossSyncTest {
    @Test fun syncsWithTheExtensionsEngineThroughAFolder() {
        val dir = System.getenv("AISH_XSYNC_DIR"); assumeTrue(dir != null)
        val phase = System.getenv("AISH_XSYNC_PHASE") ?: "1"
        val place = File(dir!!, "place"); val state = File(dir, "phone-state").apply { mkdirs() }
        val store = DirStore(place)
        val meta = JSONObject(String(store.get("meta.json")!!.bytes))
        val keys = SyncCrypto.openMeta(meta, passphrase = "xsync passphrase").keys
        val records = FileRecordStore(state)
        val clockFile = File(state, "clock.json")
        val clock = clockFile.takeIf { it.exists() }?.let { JSONObject(it.readText()).let { j -> SyncClock(j.getLong("t"), j.getString("d")) } } ?: SyncClock(device = "d_phone_kotlin")
        fun run(): SyncEngine.Result { val r = SyncEngine(store, keys, meta, records, clock, "x1").run(); clockFile.writeText(JSONObject().put("t", clock.t).put("d", clock.device).toString()); return r }
        fun note(id: String) = records.get("note:$id")?.let { SyncFields.noteOf(it) }
        var t = System.currentTimeMillis()
        fun addNote(id: String, text: String, tags: List<String>) {
            val n = JSONObject().put("id", id).put("kind", "note").put("text", text).put("created", t).put("tags", org.json.JSONArray(tags))
            records.put("note:$id", SyncFields.stampRecord(null, SyncFields.noteFields(n), clock, ++t).record)
        }

        if (phase == "1") {
            val r1 = run(); assertTrue(r1.errors.joinToString(), r1.errors.isEmpty())
            // everything the extension wrote is understood: articles, a highlight, a collection, and its note
            val title = records.get("article:x-a1")!!.getJSONObject("values").getString("title")
            assertEquals("Grüße 🌍 Prices and wages", title)
            assertEquals(listOf("economy", "wages"), (records.get("article:x-a1")!!.getJSONObject("values").keys().asSequence().filter { it.startsWith("tag:") }.map { records.get("article:x-a1")!!.getJSONObject("values").getString(it) }.toList().sorted()))
            assertNotNull(records.get("hl:h-1")); assertNotNull(records.get("coll:c-1"))
            assertEquals("JS note", note("n-js")!!.getString("text")); assertEquals("nothing of the browser data is sent back", 0, r1.pushed)
            addNote("n-phone", "Phone note with ünïcode 🌍", listOf("android", "idea"))
            val r2 = run(); assertEquals(1, r2.pushed); assertTrue(r2.errors.isEmpty())
        } else {
            val r = run(); assertTrue(r.errors.joinToString(), r.errors.isEmpty())
            assertEquals("JS note, edited in the extension", note("n-js")!!.getString("text"))
            assertEquals("a note the extension added later", note("n-js2")!!.getString("text"))
            assertTrue("a deletion in the extension arrives", records.get("note:n-gone")!!.optBoolean("deleted"))
            // edit the phone's own note; the extension must see it
            val rec = records.get("note:n-phone")!!; val n = SyncFields.noteOf(rec)!!.put("text", "Phone note, edited on the phone")
            records.put("note:n-phone", SyncFields.stampRecord(rec, SyncFields.noteFields(n), clock, ++t).record)
            val r2 = run(); assertEquals(1, r2.pushed); assertTrue(r2.errors.isEmpty())
        }
    }
}
