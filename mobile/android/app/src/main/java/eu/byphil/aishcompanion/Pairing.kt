package eu.byphil.aishcompanion

import java.net.URLDecoder

/**
 * What the QR code carries: aish-inbox://v1?i=<inboxId>&k=<encKey>&w=<writeToken> [&ti=<toPhoneInboxId>&tr=<toPhoneReadToken>][&vi=<vaultId>&vt=<vaultToken>][&lk=<proLicenseKey>].
 * i/k/w: the inbox this phone WRITES links to. ti/tr: the second inbox the extension writes articles to and this phone READS
 * (same key k). vi/vt: the feed-URL vault the devices share (feed list sync). The read token of the first inbox never leaves the extension.
 */
data class Pairing(
    val inboxId: String,
    val encKey: String,
    val writeToken: String,
    val toPhoneInboxId: String? = null,
    val toPhoneReadToken: String? = null,
    val vaultId: String? = null,
    val vaultToken: String? = null,
    /** The Pro license key, when the extension has one (lk). Used only for the cloud extra; the inbox and vault stay anonymous. */
    val license: String? = null,
) {
    /** True when the extension has switched on "Send to phone" and this code carries the second inbox. */
    val canReceive: Boolean get() = toPhoneInboxId != null && toPhoneReadToken != null

    /** True when the extension has switched on feed sync and this code carries the vault. */
    val canSync: Boolean get() = vaultId != null && vaultToken != null

    fun toCode(): String = "aish-inbox://v1?i=$inboxId&k=$encKey&w=$writeToken" +
        (if (canReceive) "&ti=$toPhoneInboxId&tr=$toPhoneReadToken" else "") +
        (if (canSync) "&vi=$vaultId&vt=$vaultToken" else "") +
        (if (license != null) "&lk=$license" else "")

    companion object {
        private const val PREFIX = "aish-inbox://v1?"
        private val ID = Regex("^[A-Za-z0-9_-]{22}$")
        private val LICENSE = Regex("^[A-Za-z0-9._~:-]{8,200}$")
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
            val vi = q["vi"]
            val vt = q["vt"]
            val second = ti != null && tr != null && ID.matches(ti) && SECRET.matches(tr)
            val vault = vi != null && vt != null && ID.matches(vi) && SECRET.matches(vt)
            val lk = q["lk"]?.takeIf { LICENSE.matches(it) }   // a malformed key is ignored, the code still works
            return Pairing(id, k, w, if (second) ti else null, if (second) tr else null, if (vault) vi else null, if (vault) vt else null, lk)
        }
    }
}
