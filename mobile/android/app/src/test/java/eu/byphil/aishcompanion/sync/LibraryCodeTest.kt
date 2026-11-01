package eu.byphil.aishcompanion.sync

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The phone reads exactly what the extension's own code makes (plugin/tests/fixtures/sync-vector.json → phoneCodes). */
class LibraryCodeTest {
    private val cases = JSONObject(javaClass.getResource("/sync-vector.json")!!.readText()).getJSONArray("phoneCodes")

    @Test fun readsEveryCodeTheBrowserMakes() {
        assertTrue(cases.length() >= 3)
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i); val conn = c.getJSONObject("connection"); val p = LibraryCode.parse(c.getString("code"))!!
            assertEquals(c.getString("name"), conn.getString("url"), p.config.url); assertEquals(c.getString("root"), p.config.root)
            if (conn.getString("service") == "s3") {
                assertEquals("s3", p.config.kind); assertEquals(conn.getString("username"), p.config.accessKeyId); assertEquals(c.getString("password"), p.config.secretKey)
                assertEquals(conn.getString("bucket"), p.config.bucket); assertEquals(conn.getString("region"), p.config.region)
            } else {
                assertEquals("webdav", p.config.kind); assertEquals(conn.getString("username"), p.config.username); assertEquals(c.getString("name"), c.getString("password"), p.config.password)
            }
            assertEquals(c.getString("name"), c.getString("words").ifEmpty { null }, p.words)
        }
    }

    @Test fun refusesWhatIsNotALibraryCode() {
        for (bad in listOf("", "https://example.com", "aish-inbox://v1?i=1&k=2&w=3", "aish-library://v1?k=ftp&u=https%3A%2F%2Fx", "aish-library://v1?k=webdav&u=http%3A%2F%2Fplain.example%2F", "aish-library://v1?k=webdav"))
            assertNull(bad, LibraryCode.parse(bad))
        assertFalse(LibraryCode.looksLikeOne("aish-inbox://v1?x")); assertTrue(LibraryCode.looksLikeOne(" aish-library://v1?k=s3"))
        assertNull(LibraryCode.parse(null))
    }

    @Test fun aPlusInASecretIsNotASpace() {
        val p = LibraryCode.parse("aish-library://v1?k=webdav&u=https%3A%2F%2Fx.test%2Fdav%2F&n=phil&p=a%2Bb+c&r=aish-sync")!!
        assertEquals("a+b+c", p.config.password)   // the browser percent-encodes a plus as %2B; a bare + from a hand-made code is kept as it is
    }
}
