package eu.byphil.aishcompanion

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import java.util.Base64

/** The same vector the extension's tests/test129.mjs uses: both sides must produce and read identical bytes. */
class InboxCryptoTest {
    private val vec = JSONObject(javaClass.getResource("/inbox-vector.json")!!.readText())
    private val pairing = Pairing(vec.getString("inboxId"), vec.getString("encKey"), vec.getString("writeToken"))
    private val data = vec.getJSONObject("envelope").getString("data")

    @Test fun decryptsTheSharedVector() {
        assertEquals(vec.getString("plaintext"), InboxCrypto.decrypt(pairing, data))
    }

    @Test fun reproducesTheSharedVectorWithItsNonce() {
        val nonce = vec.getString("nonceHex").chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        assertEquals(data, InboxCrypto.encrypt(pairing, vec.getString("plaintext"), nonce))
    }

    @Test fun messageJsonIsWhatTheExtensionExpects() {
        val m = JSONObject(InboxCrypto.messageJson("https://example.com/a?b=1&c=\"x\"", 1760000000000))
        assertEquals(1, m.getInt("v")); assertEquals("https://example.com/a?b=1&c=\"x\"", m.getString("url"))
        assertEquals(1760000000000, m.getLong("sentAt")); assertEquals("android", m.getString("platform"))
    }

    @Test fun freshNonceEveryTime() {
        assertNotEquals(InboxCrypto.encrypt(pairing, "x"), InboxCrypto.encrypt(pairing, "x"))
    }

    @Test fun tamperingAndOtherInboxesAreRejected() {
        val raw = Base64.getUrlDecoder().decode(data)
        raw[20] = (raw[20].toInt() xor 1).toByte()
        assertThrows(Exception::class.java) { InboxCrypto.decrypt(pairing, Base64.getUrlEncoder().withoutPadding().encodeToString(raw)) }
        assertThrows(Exception::class.java) { InboxCrypto.decrypt(pairing.copy(inboxId = "AAAAAAAAAAAAAAAAAAAAAA"), data) }
    }

    @Test fun parsesThePairingCodeFromTheVector() {
        assertEquals(pairing, Pairing.parse(vec.getString("pairing")))
        assertNull(Pairing.parse("https://example.com"))
        assertNull(Pairing.parse("aish-inbox://v1?i=short&k=x&w=y"))
        assertNotNull(Pairing.parse("  " + vec.getString("pairing") + "\n"))
    }

    @Test fun extractsTheFirstWebLink() {
        assertEquals("https://example.com/a?b=1", LinkExtractor.firstLink("Great read: https://example.com/a?b=1."))
        assertEquals("http://example.com/x", LinkExtractor.firstLink("(http://example.com/x)"))
        assertNull(LinkExtractor.firstLink("javascript:alert(1)"))
        assertNull(LinkExtractor.firstLink("ftp://example.com/file"))
        assertNull(LinkExtractor.firstLink("no link here"))
        assertNull(LinkExtractor.firstLink("https://example.com/" + "a".repeat(2100)))
    }
}
