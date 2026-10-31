package eu.byphil.aishcompanion.sync

import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * S3-compatible storage (AWS, Cloudflare R2, Backblaze B2, MinIO, Wasabi): the Kotlin side of the extension's syncS3.js. Path-style addressing,
 * AWS Signature Version 4. Conditional writes are sent and also checked with a HEAD first, because not every provider enforces them.
 */
class S3Store(endpoint: String, private val region: String, private val bucket: String, private val accessKeyId: String, private val secretKey: String, root: String,
              private val http: SyncHttp, private val now: () -> Instant = { Instant.now() }) : SyncStore {
    private val endpoint = endpoint.trimEnd('/')
    private val rootSegs = segs(root)
    private fun keyOf(path: String) = (rootSegs + segs(path)).joinToString("/")
    private fun urlOf(key: String, query: String = "") = "$endpoint/${enc(bucket)}${if (key.isEmpty()) "" else "/" + key.split('/').joinToString("/") { enc(it) }}${if (query.isEmpty()) "" else "?$query"}"

    companion object {
        private fun sha256Hex(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }
        private fun hmac(key: ByteArray, data: String) = Mac.getInstance("HmacSHA256").run { init(SecretKeySpec(key, "HmacSHA256")); doFinal(data.toByteArray()) }
        class Signed(val authorization: String, val signature: String, val stringToSign: String)

        /** AWS Signature Version 4. `headers` are exactly the ones to sign (lower-case names, host and x-amz-date included). */
        fun sign(method: String, url: String, headers: Map<String, String>, payloadHash: String, accessKeyId: String, secretKey: String, region: String, amzDate: String, service: String = "s3"): Signed {
            val u = java.net.URI(url)
            val names = headers.keys.map { it.lowercase() }.sorted()
            val canonHeaders = names.joinToString("") { n -> "$n:${headers.entries.first { it.key.lowercase() == n }.value.trim().replace(Regex("\\s+"), " ")}\n" }
            val signedHeaders = names.joinToString(";")
            val query = (u.rawQuery ?: "").split('&').filter { it.isNotEmpty() }.map { p -> val i = p.indexOf('='); val k = if (i < 0) p else p.substring(0, i); val v = if (i < 0) "" else p.substring(i + 1); enc(java.net.URLDecoder.decode(k, "UTF-8")) to enc(java.net.URLDecoder.decode(v.replace("+", "%2B"), "UTF-8")) }
                .sortedWith(compareBy({ it.first }, { it.second })).joinToString("&") { "${it.first}=${it.second}" }
            val canonicalUri = (u.rawPath.ifEmpty { "/" }).split('/').joinToString("/") { enc(java.net.URLDecoder.decode(it.replace("+", "%2B"), "UTF-8")) }
            val canonicalRequest = listOf(method, canonicalUri, query, canonHeaders, signedHeaders, payloadHash).joinToString("\n")
            val day = amzDate.substring(0, 8); val scope = "$day/$region/$service/aws4_request"
            val stringToSign = listOf("AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest.toByteArray())).joinToString("\n")
            val k = hmac(hmac(hmac(hmac(("AWS4$secretKey").toByteArray(), day), region), service), "aws4_request")
            val signature = hmac(k, stringToSign).joinToString("") { "%02x".format(it) }
            return Signed("AWS4-HMAC-SHA256 Credential=$accessKeyId/$scope, SignedHeaders=$signedHeaders, Signature=$signature", signature, stringToSign)
        }
        private val amzFormat = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'").withZone(ZoneOffset.UTC)
    }

    private fun call(method: String, url: String, body: ByteArray? = null, extra: Map<String, String> = emptyMap(), contentType: String? = null): SyncResp {
        val amzDate = amzFormat.format(now())
        val payloadHash = sha256Hex(body ?: ByteArray(0))
        val u = java.net.URI(url)
        val host = if (u.port > 0 && !(u.scheme == "https" && u.port == 443) && !(u.scheme == "http" && u.port == 80)) "${u.host}:${u.port}" else u.host   // the client leaves a default port out of the Host header
        val signed = HashMap<String, String>().apply { put("host", host); put("x-amz-content-sha256", payloadHash); put("x-amz-date", amzDate); if (contentType != null) put("content-type", contentType) }
        val s = sign(method, url, signed, payloadHash, accessKeyId, secretKey, region, amzDate)
        return http.call(method, url, extra + mapOf("x-amz-content-sha256" to payloadHash, "x-amz-date" to amzDate, "Authorization" to s.authorization), body, contentType)
    }
    private fun ok(r: SyncResp): SyncResp { if (!r.ok) throw StoreError(r.status, "The server answered ${r.status}."); return r }
    private fun head(key: String): String? { val r = call("HEAD", urlOf(key)); return when { r.status == 404 -> null; r.ok -> stripEtag(r.headers["etag"]); else -> throw StoreError(r.status, "The server answered ${r.status}.") } }
    private fun conflict(m: String) = StoreError(412, m, StoreError.Kind.PERMANENT)

    override fun ping(): Boolean {
        val dir = keyOf("").let { if (it.isEmpty()) "" else "$it/" }
        val r = call("GET", urlOf("", "list-type=2&max-keys=1&prefix=${enc(dir)}"))
        if (r.status == 404) throw StoreError(404, "The bucket was not found. Check the bucket name, the region and the endpoint address.", StoreError.Kind.PERMANENT)
        if (r.status == 403) throw StoreError(403, "The access key was not accepted, or it may not use this bucket.", StoreError.Kind.AUTH)
        ok(r); return true
    }

    override fun put(path: String, body: ByteArray, contentType: String, ifMatch: String?, ifNoneMatch: String?): String {
        val key = keyOf(path)
        if (ifMatch != null || ifNoneMatch != null) {
            val cur = head(key)
            if (ifNoneMatch == "*" && cur != null) throw conflict("The file already exists.")
            if (ifMatch != null && cur != ifMatch) throw conflict("The file changed since it was read.")
        }
        val h = HashMap<String, String>(); if (ifMatch != null) h["If-Match"] = "\"$ifMatch\""; if (ifNoneMatch != null) h["If-None-Match"] = ifNoneMatch
        var r = call("PUT", urlOf(key), body, h, contentType)
        if (r.status == 412) throw conflict("The file changed since it was read.")
        if (r.status == 501 && h.isNotEmpty()) r = call("PUT", urlOf(key), body, emptyMap(), contentType)   // this provider does not do conditional writes: the HEAD above had to do
        return stripEtag(ok(r).headers["etag"])
    }

    override fun get(path: String): Fetched? { val r = call("GET", urlOf(keyOf(path))); if (r.status == 404) return null; ok(r); return Fetched(r.bytes, stripEtag(r.headers["etag"])) }
    override fun remove(path: String): Boolean { val key = keyOf(path); if (head(key) == null) return false; ok(call("DELETE", urlOf(key))); return true }   // S3 says 204 for a key that is not there: ask first

    override fun list(prefix: String): List<StoredFile> {
        val base = keyOf(prefix); val dir = if (base.isEmpty()) "" else "$base/"
        val out = ArrayList<StoredFile>(); var token = ""
        do {
            val q = "delimiter=%2F&list-type=2" + (if (token.isNotEmpty()) "&continuation-token=${enc(token)}" else "") + (if (dir.isNotEmpty()) "&prefix=${enc(dir)}" else "")
            val xml = ok(call("GET", urlOf("", q))).text()
            for (m in Regex("<Contents>[\\s\\S]*?</Contents>").findAll(xml)) {
                val k = unxml(Regex("<Key>([\\s\\S]*?)</Key>").find(m.value)?.groupValues?.get(1) ?: "")
                if (!k.startsWith(dir) || k == dir || k.substring(dir.length).contains('/')) continue
                out.add(StoredFile((segs(prefix) + k.substring(dir.length)).joinToString("/"), stripEtag(unxml(Regex("<ETag>([\\s\\S]*?)</ETag>").find(m.value)?.groupValues?.get(1) ?: "")), Regex("<Size>(\\d+)</Size>").find(m.value)?.groupValues?.get(1)?.toLongOrNull() ?: 0))
            }
            token = if (Regex("<IsTruncated>true</IsTruncated>").containsMatchIn(xml)) unxml(Regex("<NextContinuationToken>([\\s\\S]*?)</NextContinuationToken>").find(xml)?.groupValues?.get(1) ?: "") else ""
        } while (token.isNotEmpty())
        return out
    }
    private fun unxml(s: String) = s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace(Regex("&#(\\d+);")) { String(Character.toChars(it.groupValues[1].toInt())) }.replace("&amp;", "&")
}
