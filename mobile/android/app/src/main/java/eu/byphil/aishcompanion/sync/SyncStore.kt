package eu.byphil.aishcompanion.sync

import java.net.URLEncoder

/** One file in a place. */
data class StoredFile(val path: String, val etag: String, val size: Long)
class Fetched(val bytes: ByteArray, val etag: String)

/**
 * Where a place keeps its files: the same four operations on WebDAV and on S3, like the extension's stores. Paths are relative to the place's
 * root folder, with no leading slash. A failed condition (If-Match, If-None-Match) throws StoreError with status 412.
 */
interface SyncStore {
    fun ping(): Boolean
    fun put(path: String, body: ByteArray, contentType: String = "application/octet-stream", ifMatch: String? = null, ifNoneMatch: String? = null): String   // → etag
    fun get(path: String): Fetched?
    fun remove(path: String): Boolean
    fun list(prefix: String = ""): List<StoredFile>
}

internal fun segs(p: String) = p.split('/').filter { it.isNotEmpty() }
internal fun enc(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20").replace("*", "%2A").replace("%7E", "~")
internal fun stripEtag(v: String?) = (v ?: "").replace("&quot;", "\"").removePrefix("W/").trim('"')
