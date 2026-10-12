package eu.byphil.aishcompanion

import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Wire format v1 of the AISH phone inbox (the same bytes the extension's inboxCrypto.js produces):
 * AES-256-GCM, 12-byte random nonce first, 16-byte tag last, additional data = the inbox id as UTF-8 text.
 * Pure JVM on purpose, so it is unit-tested against the shared vector (src/test/resources/inbox-vector.json).
 */
object InboxCrypto {
    private val b64 = Base64.getUrlEncoder().withoutPadding()
    private val b64d = Base64.getUrlDecoder()
    private val random = SecureRandom()

    fun newNonce(): ByteArray = ByteArray(12).also { random.nextBytes(it) }

    /** Returns the envelope `data` field: base64url(nonce || ciphertext || tag). */
    fun encrypt(pairing: Pairing, plaintext: String, nonce: ByteArray = newNonce()): String {
        require(nonce.size == 12) { "nonce must be 12 bytes" }
        val key = SecretKeySpec(b64d.decode(pairing.encKey), "AES")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, nonce))
        cipher.updateAAD(pairing.inboxId.toByteArray(Charsets.UTF_8))
        val sealed = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        return b64.encodeToString(nonce + sealed)
    }

    /** Used by tests (and handy for debugging) for links; articles use [decryptBytes] and [ArticleCodec]. */
    fun decrypt(pairing: Pairing, data: String): String = String(decryptBytes(pairing.inboxId, pairing.encKey, data), Charsets.UTF_8)

    /** Opens base64url(nonce || ciphertext || tag) with the key; [inboxId] is the additional data. Throws on a bad tag or another inbox. */
    fun decryptBytes(inboxId: String, encKey: String, data: String): ByteArray {
        val raw = b64d.decode(data)
        require(raw.size >= 12 + 16) { "message too short" }
        val key = SecretKeySpec(b64d.decode(encKey), "AES")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, raw.copyOfRange(0, 12)))
        cipher.updateAAD(inboxId.toByteArray(Charsets.UTF_8))
        return cipher.doFinal(raw.copyOfRange(12, raw.size))
    }

    /** The plaintext the extension expects: {v, url, sentAt, platform}. */
    fun messageJson(url: String, sentAt: Long): String =
        "{\"v\":1,\"url\":\"${jsonEscape(url)}\",\"sentAt\":$sentAt,\"platform\":\"android\"}"

    private fun jsonEscape(s: String): String = buildString {
        for (c in s) when {
            c == '"' -> append("\\\"")
            c == '\\' -> append("\\\\")
            c < ' ' -> append("\\u%04x".format(c.code))
            else -> append(c)
        }
    }
}
