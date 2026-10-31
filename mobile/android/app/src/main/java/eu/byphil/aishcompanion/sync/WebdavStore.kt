package eu.byphil.aishcompanion.sync

import java.util.Base64

/** WebDAV (Nextcloud, ownCloud, Synology, most NAS boxes): the Kotlin side of the extension's syncWebdav.js. */
class WebdavStore(url: String, root: String, private val username: String, private val password: String, private val http: SyncHttp) : SyncStore {
    private val base = url.trimEnd('/') + "/"
    private val rootSegs = segs(root.ifBlank { "aish-sync" })
    private val auth = if (username.isNotEmpty() || password.isNotEmpty()) mapOf("Authorization" to "Basic " + Base64.getEncoder().encodeToString("$username:$password".toByteArray())) else emptyMap()
    private val made = HashSet<String>()
    private fun urlOf(path: String) = base + (rootSegs + segs(path)).joinToString("/") { enc(it) }
    private fun status(e: StoreError) = e.status

    private fun mkcol(url: String) {
        try { http.expectOk("MKCOL", url, auth) } catch (e: StoreError) {
            if (e.status == 405) return   // it already exists
            if (e.status == 409) throw StoreError(409, "The server could not create the folder because the folder above it does not exist. Check the address: it must be an existing folder, for Nextcloud https://host/remote.php/dav/files/<your user>/", StoreError.Kind.PERMANENT)
            throw e
        }
    }
    private fun ensureDir(dir: List<String>) {
        val all = rootSegs + dir
        for (k in 1..all.size) {
            val parts = all.subList(0, k); val key = parts.joinToString("/")
            if (key in made) continue
            mkcol(base + parts.joinToString("/") { enc(it) }); made.add(key)
        }
    }
    private val propfindBody = "<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:getetag/><d:getcontentlength/><d:resourcetype/></d:prop></d:propfind>".toByteArray()

    override fun ping(): Boolean {
        try { http.expectOk("PROPFIND", base, auth + ("Depth" to "0")) } catch (e: StoreError) {
            if (e.status == 404) throw StoreError(404, "Nothing was found at the address. Check it (Nextcloud: https://host/remote.php/dav/files/<your user>/).", StoreError.Kind.PERMANENT)
            throw e
        }
        try { http.expectOk("PROPFIND", urlOf(""), auth + ("Depth" to "0")) } catch (e: StoreError) { if (e.status != 404) throw e; ensureDir(emptyList()) }
        return true
    }

    override fun put(path: String, body: ByteArray, contentType: String, ifMatch: String?, ifNoneMatch: String?): String {
        val parts = segs(path); val dir = parts.dropLast(1)
        try { ensureDir(dir) } catch (e: StoreError) { if (e.status != 409) throw e; made.clear(); ensureDir(dir) }
        val h = HashMap(auth); if (ifMatch != null) h["If-Match"] = "\"$ifMatch\""; if (ifNoneMatch != null) h["If-None-Match"] = ifNoneMatch
        val r = try { http.expectOk("PUT", urlOf(path), h, body, contentType) } catch (e: StoreError) {
            if (e.status != 409) throw e
            made.clear(); ensureDir(dir); http.expectOk("PUT", urlOf(path), h, body, contentType)   // the folder was removed since we made it
        }
        return stripEtag(r.headers["etag"])
    }

    override fun get(path: String): Fetched? = try { http.expectOk("GET", urlOf(path), auth).let { Fetched(it.bytes, stripEtag(it.headers["etag"])) } } catch (e: StoreError) { if (e.status == 404) null else throw e }
    override fun remove(path: String): Boolean = try { http.expectOk("DELETE", urlOf(path), auth); true } catch (e: StoreError) { if (e.status == 404) false else throw e }

    override fun list(prefix: String): List<StoredFile> {
        val res = try { http.expectOk("PROPFIND", urlOf(prefix), auth + ("Depth" to "1"), propfindBody, "application/xml") } catch (e: StoreError) { if (e.status == 404) return emptyList() else throw e }
        val dir = "/" + (rootSegs + segs(prefix)).joinToString("/") + "/"
        val out = ArrayList<StoredFile>()
        for (r in parseMultistatus(res.text())) {
            if (r.isDir) continue
            var p = r.href.replace(Regex("^https?://[^/]+"), "")
            val at = p.indexOf(dir); if (at < 0) continue
            p = p.substring(at + dir.length)
            if (p.isEmpty() || p.contains('/')) continue
            out.add(StoredFile((segs(prefix) + p).joinToString("/"), r.etag, r.size))
        }
        return out
    }

    class Entry(val href: String, val etag: String, val size: Long, val isDir: Boolean)
    companion object {
        /** The responses of a PROPFIND answer, without an XML parser (other prefixes, entity-escaped etags). */
        fun parseMultistatus(xml: String): List<Entry> {
            val out = ArrayList<Entry>()
            for (m in Regex("<(?:[\\w-]+:)?response[\\s>][\\s\\S]*?</(?:[\\w-]+:)?response>", RegexOption.IGNORE_CASE).findAll(xml)) {
                val block = m.value
                fun pick(tag: String) = Regex("<(?:[\\w-]+:)?$tag[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?$tag>", RegexOption.IGNORE_CASE).find(block)?.groupValues?.get(1)?.trim() ?: ""
                var href = pick("href"); href = try { java.net.URLDecoder.decode(href.replace("+", "%2B"), "UTF-8") } catch (_: Exception) { href }
                out.add(Entry(href, stripEtag(pick("getetag")), pick("getcontentlength").toLongOrNull() ?: 0, Regex("<(?:[\\w-]+:)?collection\\b", RegexOption.IGNORE_CASE).containsMatchIn(block)))
            }
            return out
        }
    }
}
