package eu.byphil.aishcompanion.sync

import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.security.SecureRandom
import java.util.Base64
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * Keys and encrypted files for encrypted sync places: the Kotlin side of the extension's modules/syncCrypto.js.
 *
 *   passphrase --PBKDF2-SHA256(salt, iterations)--> 32-byte master key
 *   master --HKDF-SHA256--> encKey (AES-256-GCM) and nameKey (HMAC-SHA256, for opaque file names)
 *   file = version byte (1) | 12-byte nonce | AES-GCM ciphertext (tag appended) of gzip(JSON)
 */
object SyncCrypto {
    const val FILE_VERSION = 1
    const val KDF_ITERATIONS = 600_000
    private const val CHECK_TEXT = "aish-sync-ok"

    class Keys(val enc: ByteArray, val name: ByteArray)
    class Opened(val master: ByteArray, val keys: Keys)
    class WrongKey(message: String) : Exception(message)

    fun deriveMaster(passphrase: String, salt: ByteArray, iterations: Int = KDF_ITERATIONS): ByteArray =
        SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(PBEKeySpec(passphrase.toCharArray(), salt, iterations, 256)).encoded

    private fun hmac(key: ByteArray, data: ByteArray): ByteArray = Mac.getInstance("HmacSHA256").run { init(SecretKeySpec(key, "HmacSHA256")); doFinal(data) }

    /** HKDF-SHA256 with an empty salt (RFC 5869: a zero-filled salt of the hash length), one block of output. */
    private fun hkdf(master: ByteArray, info: String): ByteArray {
        val prk = hmac(ByteArray(32), master)
        return hmac(prk, info.toByteArray() + byteArrayOf(1))
    }
    fun subKeys(master: ByteArray) = Keys(hkdf(master, "aish-sync-enc-v1"), hkdf(master, "aish-sync-name-v1"))

    private fun gzip(b: ByteArray) = ByteArrayOutputStream().also { o -> GZIPOutputStream(o).use { it.write(b) } }.toByteArray()
    private fun gunzip(b: ByteArray, max: Int = 64 * 1024 * 1024): ByteArray {
        val out = ByteArrayOutputStream(); val buf = ByteArray(8192)
        GZIPInputStream(ByteArrayInputStream(b)).use { i -> while (true) { val n = i.read(buf); if (n < 0) break; out.write(buf, 0, n); if (out.size() > max) throw WrongKey("The file is larger than expected.") } }
        return out.toByteArray()
    }

    /** A JSON text (the record, as the extension writes it) to the bytes of an encrypted file. `nonce` only for tests. */
    fun encrypt(keys: Keys, json: String, nonce: ByteArray = ByteArray(12).also { SecureRandom().nextBytes(it) }): ByteArray {
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, SecretKeySpec(keys.enc, "AES"), GCMParameterSpec(128, nonce)) }
        val ct = c.doFinal(gzip(json.toByteArray(Charsets.UTF_8)))
        return byteArrayOf(FILE_VERSION.toByte()) + nonce + ct
    }

    /** Encrypted file bytes to the JSON text. Throws WrongKey for a wrong key, a damaged file or an unknown version. */
    fun decrypt(keys: Keys, bytes: ByteArray): String {
        if (bytes.size < 30 || bytes[0].toInt() != FILE_VERSION) throw WrongKey("This file is not a sync file this version understands.")
        val plain = try {
            Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, SecretKeySpec(keys.enc, "AES"), GCMParameterSpec(128, bytes.copyOfRange(1, 13))) }.doFinal(bytes, 13, bytes.size - 13)
        } catch (_: Exception) { throw WrongKey("The file could not be decrypted: wrong passphrase or damaged file.") }
        return String(gunzip(plain), Charsets.UTF_8)
    }

    /** Opaque, stable file name for a record: hex of HMAC(nameKey, "type:id"). */
    fun nameOf(keys: Keys, type: String, id: String): String = hmac(keys.name, "$type:$id".toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    /** Opens an existing place (its meta.json) with its passphrase. Throws WrongKey("Wrong passphrase."). */
    fun openMeta(meta: JSONObject, passphrase: String): Opened {
        if (meta.optString("mode") != "encrypted" || !meta.has("salt") || !meta.has("check")) throw WrongKey("This place is not an encrypted AISH sync place.")
        val master = deriveMaster(passphrase, Base64.getDecoder().decode(meta.getString("salt")), meta.optInt("iterations", KDF_ITERATIONS))
        val keys = subKeys(master)
        val ok = try { JSONObject.quote(CHECK_TEXT) == decrypt(keys, Base64.getDecoder().decode(meta.getString("check"))) } catch (_: Exception) { false }
        if (!ok) throw WrongKey("Wrong passphrase.")
        return Opened(master, keys)
    }
    /** Opens a place with a master key this device already holds. */
    fun openWithMaster(meta: JSONObject, master: ByteArray): Keys {
        val keys = subKeys(master)
        val ok = try { JSONObject.quote(CHECK_TEXT) == decrypt(keys, Base64.getDecoder().decode(meta.getString("check"))) } catch (_: Exception) { false }
        if (!ok) throw WrongKey("The key saved on this device does not open this place any more.")
        return keys
    }
    /** A new place: random salt, key-check blob. */
    fun createMeta(passphrase: String, iterations: Int = KDF_ITERATIONS): Pair<JSONObject, Opened> {
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val master = deriveMaster(passphrase, salt, iterations); val keys = subKeys(master)
        val meta = JSONObject().put("aish", "sync/1").put("mode", "encrypted").put("kdf", "pbkdf2-sha256").put("iterations", iterations)
            .put("salt", Base64.getEncoder().encodeToString(salt)).put("check", Base64.getEncoder().encodeToString(encrypt(keys, JSONObject.quote(CHECK_TEXT))))
        return meta to Opened(master, keys)
    }
}
