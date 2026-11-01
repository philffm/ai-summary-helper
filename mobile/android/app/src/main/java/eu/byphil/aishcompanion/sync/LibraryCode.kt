package eu.byphil.aishcompanion.sync

import java.net.URLDecoder

/**
 * What the browser's QR code carries for joining a library: aish-library://v1?k=webdav&u=<address>&n=<user>&p=<password>&r=<folder>[&w=<words>]
 * (S3: k=s3 with g=<region> and b=<bucket>; u = endpoint, n = access key id, p = secret key). The Kotlin side of syncPhoneCode.js in the extension, checked
 * against a shared vector. The code holds secrets: it is read once and never stored as it is.
 */
object LibraryCode {
    class Parsed(val config: LibrarySync.Config, val words: String?)

    fun looksLikeOne(text: String?) = text != null && text.trim().startsWith("aish-library://")

    fun parse(text: String?): Parsed? {
        val m = Regex("^aish-library://v1\\?(.+)$").find(text?.trim().orEmpty()) ?: return null
        val q = HashMap<String, String>()
        for (part in m.groupValues[1].split('&')) {
            val i = part.indexOf('=')
            if (i > 0) q[part.substring(0, i)] = runCatching { URLDecoder.decode(part.substring(i + 1).replace("+", "%2B"), "UTF-8") }.getOrNull() ?: return null
        }
        val kind = q["k"]; if (kind != "webdav" && kind != "s3") return null
        val url = q["u"].orEmpty(); if (!url.startsWith("https://")) return null   // the app talks to servers over HTTPS only
        val config = LibrarySync.Config(kind, url, q["n"].orEmpty(), q["p"].orEmpty(), q["r"].orEmpty().ifEmpty { "aish-sync" },
            if (kind == "s3") q["g"].orEmpty().ifEmpty { "us-east-1" } else "us-east-1", if (kind == "s3") q["b"].orEmpty() else "",
            if (kind == "s3") q["n"].orEmpty() else "", if (kind == "s3") q["p"].orEmpty() else "")
        return Parsed(if (kind == "s3") config.copy(username = "", password = "") else config, q["w"]?.takeIf { it.isNotBlank() })
    }
}
