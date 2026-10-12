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

    @Test fun decryptsTheSharedArticleVector() {
        val art = vec.getJSONObject("article")
        val (a, json) = ArticleCodec.decrypt(art.getString("inboxId"), vec.getString("encKey"), art.getJSONObject("envelope").getString("data"), "abc123")
        val m = art.getJSONObject("message")
        assertEquals(m.getString("title"), a.title); assertEquals(m.getString("url"), a.url); assertEquals(m.getString("byline"), a.byline)
        assertEquals(m.getLong("sentAt"), a.sentAt)
        assertEquals(m.getJSONArray("blocks").length(), a.blocks.size)
        assertEquals("Überschrift 日本語", a.blocks[0].text); assertEquals("h2", a.blocks[0].type)
        assertEquals(true, a.blocks[1].text.contains("🙂"))
        assertEquals(a, ArticleCodec.parse(json, "abc123"))
    }

    @Test fun articleFromAnotherInboxOrTamperedIsRejected() {
        val art = vec.getJSONObject("article")
        val data = art.getJSONObject("envelope").getString("data")
        assertThrows(Exception::class.java) { ArticleCodec.decrypt("AAAAAAAAAAAAAAAAAAAAAA", vec.getString("encKey"), data, "x") }
        val raw = Base64.getUrlDecoder().decode(data); raw[30] = (raw[30].toInt() xor 1).toByte()
        assertThrows(Exception::class.java) { ArticleCodec.decrypt(art.getString("inboxId"), vec.getString("encKey"), Base64.getUrlEncoder().withoutPadding().encodeToString(raw), "x") }
    }

    @Test fun decompressionBombIsRefused() {
        val bomb = java.io.ByteArrayOutputStream().also { o -> java.util.zip.GZIPOutputStream(o).use { z -> val zero = ByteArray(1 shl 20); repeat(8) { z.write(zero) } } }.toByteArray()
        assertThrows(IllegalArgumentException::class.java) { ArticleCodec.gunzip(bomb) }
    }

    @Test fun articleParserKeepsOnlyKnownBlocksAndWebLinks() {
        val ok = """{"v":2,"url":"https://example.com/a","blocks":[["p","x"],["script","y"],["p"," "],["h2","H"]]}"""
        assertEquals(listOf(Block("p", "x"), Block("h2", "H")), ArticleCodec.parse(ok, "i").blocks)
        assertThrows(Exception::class.java) { ArticleCodec.parse("""{"v":2,"url":"javascript:alert(1)","blocks":[["p","x"]]}""", "i") }
        assertThrows(Exception::class.java) { ArticleCodec.parse("""{"v":2,"url":"https://example.com","blocks":[]}""", "i") }
        assertThrows(Exception::class.java) { ArticleCodec.parse("""{"v":1,"url":"https://example.com","blocks":[["p","x"]]}""", "i") }
    }

    @Test fun pairingCodeWithTheSecondInbox() {
        val art = vec.getJSONObject("article")
        val code = vec.getString("pairing") + "&ti=" + art.getString("inboxId") + "&tr=" + vec.getString("readToken")
        val p = Pairing.parse(code)!!
        assertEquals(true, p.canReceive); assertEquals(art.getString("inboxId"), p.toPhoneInboxId); assertEquals(vec.getString("readToken"), p.toPhoneReadToken)
        assertEquals(p, Pairing.parse(p.toCode()))
        assertEquals(false, Pairing.parse(vec.getString("pairing"))!!.canReceive)
        assertEquals(false, Pairing.parse(vec.getString("pairing") + "&ti=short&tr=x")!!.canReceive)
    }

    @Test fun articleIdsMustBePlainFileNames() {
        assertEquals(true, ArticleStore.ID.matches("3f9a7c1d2e4b5a60"))
        assertEquals(false, ArticleStore.ID.matches("../etc/passwd")); assertEquals(false, ArticleStore.ID.matches("a/b")); assertEquals(false, ArticleStore.ID.matches(""))
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
