package eu.byphil.aishcompanion

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.GZIPOutputStream

// The collection name in the byPhil database: aish_vaults (one encrypted document per user: the feed list).
const val VAULT_API = "https://api.byphil.eu/v1/projects/ai_summary_helper/aish_vaults"

/** The sealed feed list: gzip(JSON {v:1, feeds}) in AES-256-GCM with the vault id as additional data, like the extension's encryptVault/decryptVault. */
object VaultCodec {
    const val MAX_GZ = 55_000          // keeps the base64url text under the server's 80,000-character cap
    const val MAX_RAW = 1_000_000

    fun gzip(bytes: ByteArray): ByteArray {
        val out = ByteArrayOutputStream()
        GZIPOutputStream(out).use { it.write(bytes) }
        return out.toByteArray()
    }

    /** Returns the envelope `data` field. Throws IllegalArgumentException("vault too large") when it would not fit on the server. */
    fun seal(vaultId: String, encKey: String, entries: List<FeedEntry>, nonce: ByteArray = InboxCrypto.newNonce()): String {
        val gz = gzip(FeedSync.toJson(entries).toByteArray(Charsets.UTF_8))
        require(gz.size <= MAX_GZ) { "vault too large" }
        return InboxCrypto.seal(vaultId, encKey, gz, nonce)
    }

    /** Throws on a bad tag, another vault, a wrong version or a decompression bomb. */
    fun open(vaultId: String, encKey: String, data: String): List<FeedEntry> {
        val json = String(ArticleCodec.gunzip(InboxCrypto.decryptBytes(vaultId, encKey, data), MAX_RAW), Charsets.UTF_8)
        return FeedSync.parse(json)
    }
}

data class HttpResult(val code: Int, val body: String)

/** One HTTP call, never throwing: code 0 means the network failed. */
fun interface Http {
    fun request(method: String, url: String, headers: Map<String, String>, body: String?): HttpResult
}

object UrlHttp : Http {
    override fun request(method: String, url: String, headers: Map<String, String>, body: String?): HttpResult {
        var conn: HttpURLConnection? = null
        return try {
            conn = URL(url).openConnection() as HttpURLConnection
            conn.requestMethod = method
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            for ((k, v) in headers) conn.setRequestProperty(k, v)
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            HttpResult(code, stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: "")
        } catch (_: IOException) {
            HttpResult(0, "")
        } finally {
            conn?.disconnect()
        }
    }
}

/** What the phone remembers between syncs: the vault revision it saw and the merged list as of then (including tombstones). */
data class SyncState(val rev: Long = 0, val base: List<FeedEntry> = emptyList(), val lastSyncAt: Long = 0)

/** error: null on success, else not-paired, not-enabled, unreadable, too-large, conflict, rate-limited, pairing-invalid, unreachable, error. */
data class SyncResult(val error: String?, val plan: SyncPlan = SyncPlan(emptyList(), emptyList(), emptyList()), val merged: List<FeedEntry> = emptyList(), val rev: Long = 0, val uploaded: Boolean = false)

/** The phone's side of the feed-URL vault; the same protocol as the extension's inboxManager.syncFeeds. */
class VaultClient(private val api: String = VAULT_API, private val http: Http = UrlHttp) {
    companion object { const val RETRIES = 5 }

    private fun classify(code: Int): String = when {
        code == 0 || code >= 500 -> "unreachable"
        code == 429 -> "rate-limited"
        code == 401 || code == 403 || code == 404 -> "pairing-invalid"
        else -> "error"
    }

    /**
     * Downloads the vault, merges it with [subs], uploads the result when it differs (If-Match; on 409 merges the newer document and retries),
     * and returns what to change on this phone. The caller applies [SyncResult.plan] and then stores [SyncResult.merged] and [SyncResult.rev] as the new [SyncState].
     */
    fun sync(pairing: Pairing, subs: List<SyncSub>, state: SyncState, now: Long): SyncResult {
        val vaultId = pairing.vaultId ?: return SyncResult("not-enabled")
        val token = pairing.vaultToken ?: return SyncResult("not-enabled")
        val url = "$api/$vaultId"
        val auth = mapOf("Authorization" to "Bearer $token")
        val local = FeedSync.localEntries(subs, state.base, now)

        val first = http.request("GET", url, auth, null)
        if (first.code != 200) return SyncResult(classify(first.code))
        var doc = try { JSONObject(first.body) } catch (_: Exception) { return SyncResult("error") }
        var rev = doc.optLong("rev")
        var merged: List<FeedEntry> = emptyList()
        var uploaded = false
        for (attempt in 0 until RETRIES) {
            val remote = try {
                val data = if (doc.isNull("data")) null else doc.optString("data")
                if (data == null) emptyList() else VaultCodec.open(vaultId, pairing.encKey, data)
            } catch (_: Exception) { return SyncResult("unreadable") }
            merged = FeedSync.merge(local, remote, now)
            if (FeedSync.same(merged, remote)) break
            val sealed = try { VaultCodec.seal(vaultId, pairing.encKey, merged) } catch (_: IllegalArgumentException) { return SyncResult("too-large") }
            val put = http.request("PUT", url, auth + ("If-Match" to rev.toString()), "{\"v\":1,\"data\":\"$sealed\"}")
            when (put.code) {
                200 -> { rev = JSONObject(put.body).optLong("rev"); uploaded = true }
                409 -> {
                    if (attempt == RETRIES - 1) return SyncResult("conflict")
                    doc = try { JSONObject(put.body) } catch (_: Exception) { return SyncResult("error") }
                    rev = doc.optLong("rev")
                    continue
                }
                413 -> return SyncResult("too-large")
                429 -> return SyncResult("rate-limited")
                else -> return SyncResult(classify(put.code))
            }
            break
        }
        return SyncResult(null, FeedSync.plan(subs, merged), merged, rev, uploaded)
    }
}
