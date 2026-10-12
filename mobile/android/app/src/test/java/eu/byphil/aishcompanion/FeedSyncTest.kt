package eu.byphil.aishcompanion

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** The shared vector the extension's tests/test147.mjs writes: the sealed document opens, and every merge case gives the same list on both sides. */
class FeedSyncTest {
    private val vec = JSONObject(javaClass.getResource("/feed-sync-vector.json")!!.readText())
    private val inbox = JSONObject(javaClass.getResource("/inbox-vector.json")!!.readText())
    private val vaultId = vec.getString("vaultId")
    private val key = inbox.getString("encKey")

    @Test fun opensTheExtensionsSealedDocument() {
        val feeds = VaultCodec.open(vaultId, key, vec.getJSONObject("envelope").getString("data"))
        assertEquals(2, feeds.size)
        assertTrue(feeds.any { it.title == "Größe & Wunder ✓" && it.tags == listOf("Nachrichten", "日本語") })
        assertTrue(feeds.any { it.removed && it.url == "https://b.example/rss" })
    }

    @Test fun ownRoundTripAndWrongVaultRejected() {
        val feeds = listOf(FeedEntry("https://a.example/f", "A", listOf("x"), 5), FeedEntry("https://b.example/f", "", emptyList(), 6, true))
        val sealed = VaultCodec.seal(vaultId, key, feeds)
        assertEquals(FeedSync.cleanEntries(feeds), VaultCodec.open(vaultId, key, sealed))
        assertThrows(javax.crypto.AEADBadTagException::class.java) { VaultCodec.open("AAAAAAAAAAAAAAAAAAAAAA", key, sealed) }
    }

    @Test fun mergeCasesMatchTheExtension() {
        val now = vec.getLong("now")
        val cases = vec.getJSONArray("merge")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val a = FeedSync.parseEntries(c.getJSONArray("a")); val b = FeedSync.parseEntries(c.getJSONArray("b")); val expect = FeedSync.parseEntries(c.getJSONArray("expect"))
            assertEquals(c.getString("name"), expect, FeedSync.merge(a, b, now))
            assertEquals(c.getString("name") + " (swapped)", expect, FeedSync.merge(b, a, now))
        }
    }

    @Test fun urlsAreCheckedAndNormalised() {
        assertEquals("https://example.com/", FeedSync.cleanFeedUrl("HTTPS://Example.COM:443"))
        assertEquals("", FeedSync.cleanFeedUrl("javascript:alert(1)"))
        assertEquals("", FeedSync.cleanFeedUrl("file:///etc/passwd"))
        assertEquals("", FeedSync.cleanFeedUrl("https://user@h.example/"))
        assertEquals("https://a_b.example/x", FeedSync.cleanFeedUrl("https://a_b.example/x"))
    }

    @Test fun whatThisPhoneDidAndWhatToChange() {
        val base = listOf(FeedEntry("https://a.example/f", "A", listOf("t"), 10), FeedEntry("https://b.example/f", "B", emptyList(), 10), FeedEntry("https://c.example/f", "", emptyList(), 10, true))
        val subs = listOf(SyncSub("https://a.example/f", "A", listOf("t")), SyncSub("https://c.example/f", "C again", emptyList()))
        val local = FeedSync.localEntries(subs, base, 99)
        assertEquals(10L, local.first { it.url == "https://a.example/f" }.updatedAt)
        assertTrue(local.first { it.url == "https://b.example/f" }.removed)
        assertEquals(99L, local.first { it.url == "https://c.example/f" }.updatedAt)
        val plan = FeedSync.plan(listOf(SyncSub("https://a.example/f", "x", emptyList())), listOf(FeedEntry("https://a.example/f", "A", listOf("n"), 3), FeedEntry("https://z.example/f", "", emptyList(), 3, true), FeedEntry("https://c.example/f", "C", emptyList(), 3)))
        assertEquals(listOf(SyncSub("https://c.example/f", "C", emptyList())), plan.add)
        assertEquals(listOf(SyncSub("https://a.example/f", "A", listOf("n"))), plan.update)
        assertTrue(plan.remove.isEmpty())
        assertFalse(plan.isEmpty)
    }

    @Test fun pairingCarriesTheVault() {
        val p = Pairing.parse("aish-inbox://v1?i=${inbox.getString("inboxId")}&k=$key&w=${inbox.getString("writeToken")}&vi=${inbox.getString("inboxId")}&vt=${inbox.getString("readToken")}")!!
        assertTrue(p.canSync); assertFalse(p.canReceive)
        assertEquals(p, Pairing.parse(p.toCode()))
        assertFalse(Pairing.parse(inbox.getString("pairing"))!!.canSync)
    }
}
