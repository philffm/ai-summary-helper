package eu.byphil.aishcompanion.sync

import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/** A server answer. Header names are lower case. */
class SyncResp(val status: Int, val headers: Map<String, String>, val bytes: ByteArray) {
    val ok get() = status in 200..299
    fun text() = String(bytes, Charsets.UTF_8)
}

/** What a store reports: `kind` tells the caller whether to try again later (retry), to ask for a new login (auth) or to give up (permanent). */
class StoreError(val status: Int, message: String, val kind: Kind = kindOf(status)) : Exception(message) {
    enum class Kind { RETRY, AUTH, PERMANENT }
    companion object { fun kindOf(status: Int) = when { status == 401 || status == 403 -> Kind.AUTH; status == 0 || status == 408 || status == 429 || status >= 500 -> Kind.RETRY; else -> Kind.PERMANENT } }
}

/** The one door to the network for sync: HTTPS only (plain http for a private address that was allowed), no redirects, no cookies, bounded time and size. */
class SyncHttp(private val allowInsecureLan: Boolean = false, private val maxBytes: Int = 20 * 1024 * 1024, client: OkHttpClient? = null) {
    private val http = client ?: OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).writeTimeout(60, TimeUnit.SECONDS).build()

    fun call(method: String, url: String, headers: Map<String, String> = emptyMap(), body: ByteArray? = null, contentType: String? = null): SyncResp {
        val u = try { java.net.URI(url) } catch (_: Exception) { throw StoreError(0, "Invalid address.", StoreError.Kind.PERMANENT) }
        if (u.scheme != "https" && !(u.scheme == "http" && allowInsecureLan)) throw StoreError(0, "HTTPS is required.", StoreError.Kind.PERMANENT)
        val b = Request.Builder().url(url)
        for ((k, v) in headers) b.header(k, v)
        val payload = when { body != null -> body.toRequestBody(contentType?.toMediaTypeOrNull()); method in setOf("PUT", "POST", "PROPFIND", "PATCH", "MKCOL") -> ByteArray(0).toRequestBody(null); else -> null }
        b.method(method, payload)
        try {
            http.newCall(b.build()).execute().use { r ->
                if (r.code in 300..399) throw StoreError(r.code, "The server redirected the request.", StoreError.Kind.PERMANENT)
                val len = r.body?.contentLength() ?: -1
                if (len > maxBytes) throw StoreError(r.code, "The answer is too large.", StoreError.Kind.PERMANENT)
                val bytes = r.body?.byteStream()?.use { s -> val out = java.io.ByteArrayOutputStream(); val buf = ByteArray(8192); var n: Int; var total = 0; while (s.read(buf).also { n = it } >= 0) { total += n; if (total > maxBytes) throw StoreError(r.code, "The answer is too large.", StoreError.Kind.PERMANENT); out.write(buf, 0, n) }; out.toByteArray() } ?: ByteArray(0)
                return SyncResp(r.code, r.headers.names().associate { it.lowercase() to (r.header(it) ?: "") }, bytes)
            }
        } catch (e: StoreError) { throw e }
        catch (e: IOException) { throw StoreError(0, "The server is not reachable.", StoreError.Kind.RETRY) }
    }

    /** Like call, but anything outside 2xx becomes a StoreError (404 and 412 included: the caller catches the status it expects). */
    fun expectOk(method: String, url: String, headers: Map<String, String> = emptyMap(), body: ByteArray? = null, contentType: String? = null): SyncResp {
        val r = call(method, url, headers, body, contentType)
        if (!r.ok) throw StoreError(r.status, "The server answered ${r.status}.")
        return r
    }
}
