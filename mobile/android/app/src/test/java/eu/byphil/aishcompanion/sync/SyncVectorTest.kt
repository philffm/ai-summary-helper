package eu.byphil.aishcompanion.sync

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

/** Reads plugin/tests/fixtures/sync-vector.json, made by the extension's own code: this app must agree with it, or devices could not sync. */
class SyncVectorTest {
    private val vec = JSONObject(javaClass.getResource("/sync-vector.json")!!.readText())
    private val crypto = vec.getJSONObject("crypto")
    private fun hex(s: String) = s.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    private fun toHex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }

    @Test fun hashesEveryValueLikeTheExtension() {
        val list = vec.getJSONArray("hashValues")
        assertTrue(list.length() > 20)
        for (i in 0 until list.length()) {
            val e = list.getJSONObject(i)
            assertEquals("value #$i: ${e.opt("value")}", e.getString("hash"), SyncStamps.hashValue(e.opt("value")))
        }
    }

    @Test fun derivesTheMasterKeyAndTheRecoveryKey() {
        val master = SyncCrypto.deriveMaster(crypto.getString("passphrase"), hex(crypto.getString("saltHex")), crypto.getInt("iterations"))
        assertEquals(crypto.getString("masterHex"), toHex(master))
        assertEquals(crypto.getString("recoveryKey"), SyncCrypto.recoveryKeyOf(master))
        assertArrayEquals(master, SyncCrypto.masterFromRecoveryKey(crypto.getString("recoveryKey").lowercase().replace("-", " ")))
    }

    @Test fun opensTheExtensionsPlaceWithPassphraseOrRecoveryKey() {
        val meta = crypto.getJSONObject("meta")
        val byPass = SyncCrypto.openMeta(meta, passphrase = crypto.getString("passphrase"))
        assertEquals(crypto.getString("masterHex"), toHex(byPass.master))
        assertEquals(crypto.getString("masterHex"), toHex(SyncCrypto.openMeta(meta, recoveryKey = crypto.getString("recoveryKey")).master))
        assertThrows(SyncCrypto.WrongKey::class.java) { SyncCrypto.openMeta(meta, passphrase = "wrong") }
        SyncCrypto.openWithMaster(meta, byPass.master)
    }

    @Test fun namesRecordsLikeTheExtension() {
        val keys = SyncCrypto.subKeys(hex(crypto.getString("masterHex")))
        val names = crypto.getJSONArray("names")
        for (i in 0 until names.length()) { val n = names.getJSONObject(i); assertEquals(n.getString("name"), SyncCrypto.nameOf(keys, n.getString("type"), n.getString("id"))) }
    }

    @Test fun readsARecordFileTheExtensionWrote() {
        val keys = SyncCrypto.openMeta(crypto.getJSONObject("meta"), passphrase = crypto.getString("passphrase")).keys
        val rec = JSONObject(SyncCrypto.decrypt(keys, Base64.getDecoder().decode(crypto.getString("recordFile"))))
        assertEquals(SyncStamps.canonical(crypto.getJSONObject("record")), SyncStamps.canonical(rec))
        assertEquals("Grüße 🌍", rec.getJSONObject("values").getString("title"))
    }

    @Test fun writesFilesThatAreReadBackAndRejectsDamage() {
        val keys = SyncCrypto.subKeys(hex(crypto.getString("masterHex")))
        val text = crypto.getJSONObject("record").toString()
        val file = SyncCrypto.encrypt(keys, text)
        assertEquals(text, SyncCrypto.decrypt(keys, file))
        assertFalse(String(file, Charsets.ISO_8859_1).contains("Grüße"))
        val bad = file.copyOf().also { it[it.size - 3] = (it[it.size - 3].toInt() xor 1).toByte() }
        assertThrows(SyncCrypto.WrongKey::class.java) { SyncCrypto.decrypt(keys, bad) }
        assertThrows(SyncCrypto.WrongKey::class.java) { SyncCrypto.decrypt(SyncCrypto.subKeys(ByteArray(32) { 7 }), file) }
        // a file with the extension's fixed nonce, for the one-off cross check with node (see README)
        java.io.File(System.getProperty("java.io.tmpdir"), "aish-kotlin-record.bin").writeBytes(SyncCrypto.encrypt(keys, text, hex(crypto.getString("nonceHex"))))
    }

    @Test fun mergesEveryCaseLikeTheExtension() {
        val cases = vec.getJSONArray("mergeCases")
        assertTrue(cases.length() >= 10)
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val r = SyncMerge.mergeRecord(c.optJSONObject("local"), c.optJSONObject("remote"))
            val name = c.getString("name")
            assertEquals(name, SyncStamps.canonical(c.getJSONObject("merged")), SyncStamps.canonical(r.merged))
            assertEquals("$name: changedLocal", c.getBoolean("changedLocal"), r.changedLocal)
            assertEquals("$name: changedRemote", c.getBoolean("changedRemote"), r.changedRemote)
        }
    }

    @Test fun spellsAPassphraseLikeTheExtension() {
        val v = vec.getJSONObject("passphrases")
        val words = SyncWordlist.WORDS
        assertEquals(v.getInt("words"), words.size)
        val sha = java.security.MessageDigest.getInstance("SHA-256").digest((words.joinToString("\n") + "\n").toByteArray()).joinToString("") { "%02x".format(it) }
        assertEquals("the word list is the one the extension suggests from", v.getString("wordlistSha256"), sha)
        val cases = v.getJSONArray("cases")
        for (i in 0 until cases.length()) { val c = cases.getJSONObject(i); assertEquals(c.getString("input"), c.getString("canonical"), SyncPassphrase.canonical(c.getString("input"))) }
    }
}
