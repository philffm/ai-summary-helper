package eu.byphil.aishcompanion

import java.net.URLDecoder

/**
 * What the QR code carries: aish-inbox://v1?i=<inboxId>&k=<encKey>&w=<writeToken>[&ti=<toPhoneInboxId>&tr=<toPhoneReadToken>].
 * i/k/w: the inbox this phone WRITES links to. ti/tr: the second inbox the extension writes articles to and this phone READS
 * (same key k). The read token of the first inbox never leaves the extension.
 */
data class Pairing(
    val inboxId: String,
    val encKey: String,
    val writeToken: String,
    val toPhoneInboxId: String? = null,
    val toPhoneReadToken: String? = null,
) {
    /** True when the extension has switched on "Send to phone" and this code carries the second inbox. */
    val canReceive: Boolean get() = toPhoneInboxId != null && toPhoneReadToken != null

    fun toCode(): String = "aish-inbox://v1?i=$inboxId&k=$encKey&w=$writeToken" + if (canReceive) "&ti=$toPhoneInboxId&tr=$toPhoneReadToken" else ""

    companion object {
        private const val PREFIX = "aish-inbox://v1?"
        private val ID = Regex("^[A-Za-z0-9_-]{22}$")
        private val SECRET = Regex("^[A-Za-z0-9_-]{43}$")   // 32 bytes, base64url without padding

        /** Null when the text is not a valid pairing code. */
        fun parse(text: String): Pairing? {
            val t = text.trim()
            if (!t.startsWith(PREFIX)) return null
            val q = t.removePrefix(PREFIX).split('&').mapNotNull {
                val i = it.indexOf('=')
                if (i < 1) null else it.substring(0, i) to URLDecoder.decode(it.substring(i + 1), "UTF-8")
            }.toMap()
            val id = q["i"] ?: return null
            val k = q["k"] ?: return null
            val w = q["w"] ?: return null
            if (!ID.matches(id) || !SECRET.matches(k) || !SECRET.matches(w)) return null
            val ti = q["ti"]
            val tr = q["tr"]
            return if (ti != null && tr != null && ID.matches(ti) && SECRET.matches(tr)) Pairing(id, k, w, ti, tr) else Pairing(id, k, w)
        }
    }
}
