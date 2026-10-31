package eu.byphil.aishcompanion.sync

import okhttp3.Headers
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import java.security.MessageDigest

/** An in-memory WebDAV server for the tests: folders (MKCOL), PUT with If-Match / If-None-Match, GET, DELETE, PROPFIND, optional basic auth. */
class FakeDav(private val prefix: String = "/dav/", private val user: String = "phil", private val pass: String = "secret") : Dispatcher() {
    val files = HashMap<String, Pair<ByteArray, String>>(); val dirs = hashSetOf(""); val log = ArrayList<String>(); private var n = 0
    private fun r(code: Int, body: ByteArray = ByteArray(0), vararg h: Pair<String, String>) = MockResponse().setResponseCode(code).apply { h.forEach { addHeader(it.first, it.second) }; if (body.isNotEmpty()) setBody(Buffer().write(body)) }
    override fun dispatch(req: RecordedRequest): MockResponse {
        val method = req.method!!; val raw = req.path!!.substringBefore('?'); log.add("$method ${java.net.URLDecoder.decode(raw, "UTF-8")}")
        val expected = "Basic " + java.util.Base64.getEncoder().encodeToString("$user:$pass".toByteArray())
        if (req.getHeader("Authorization") != expected) return r(401)
        if (!raw.startsWith(prefix)) return r(404)
        val path = java.net.URLDecoder.decode(raw.removePrefix(prefix), "UTF-8").trimEnd('/')
        val parent = if (path.contains('/')) path.substringBeforeLast('/') else ""
        return when (method) {
            "MKCOL" -> if (path in dirs) r(405) else if (parent !in dirs) r(409) else { dirs.add(path); r(201) }
            "PUT" -> {
                if (parent !in dirs) return r(409)
                val cur = files[path]
                if (req.getHeader("If-None-Match") == "*" && cur != null) return r(412)
                req.getHeader("If-Match")?.let { if (cur == null || "\"${cur.second}\"" != it) return r(412) }
                val etag = "e${++n}"; files[path] = req.body.readByteArray() to etag; r(if (cur != null) 204 else 201, ByteArray(0), "ETag" to "\"$etag\"")
            }
            "GET" -> files[path]?.let { r(200, it.first, "ETag" to "\"${it.second}\"") } ?: r(404)
            "DELETE" -> if (files.remove(path) != null) r(204) else r(404)
            "PROPFIND" -> {
                if (path !in dirs && path !in files) return r(404)
                val rows = StringBuilder("<d:response><d:href>$prefix${path.split('/').filter { it.isNotEmpty() }.joinToString("/") { enc(it) }}${if (path in dirs && path.isNotEmpty()) "/" else ""}</d:href><d:propstat><d:prop><d:resourcetype>${if (path in dirs) "<d:collection/>" else ""}</d:resourcetype></d:prop></d:propstat></d:response>")
                if (req.getHeader("Depth") == "1" && path in dirs) {
                    fun inDir(p: String) = p != path && p.substringBeforeLast('/', "") == path
                    for (d in dirs) if (d.isNotEmpty() && inDir(d)) rows.append("<d:response><d:href>$prefix${d.split('/').joinToString("/") { enc(it) }}/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>")
                    for ((p, f) in files) if (inDir(p)) rows.append("<d:response><d:href>$prefix${p.split('/').joinToString("/") { enc(it) }}</d:href><d:propstat><d:prop><d:getetag>&quot;${f.second}&quot;</d:getetag><d:getcontentlength>${f.first.size}</d:getcontentlength><d:resourcetype/></d:prop></d:propstat></d:response>")
                }
                r(207, "<?xml version=\"1.0\"?><d:multistatus xmlns:d=\"DAV:\">$rows</d:multistatus>".toByteArray(), "Content-Type" to "application/xml")
            }
            else -> r(405)
        }
    }
}

/** An in-memory S3 for the tests: path-style, PUT/GET/HEAD/DELETE, ListObjectsV2 with paging, conditions (switchable), and a check that every request is signed and its body hash is right. */
class FakeS3(private val bucket: String = "bucket1", private val accessKeyId: String = "AKIDTEST", private val pageSize: Int = 3, private val enforceConditions: Boolean = true) : Dispatcher() {
    val files = HashMap<String, Pair<ByteArray, String>>(); val log = ArrayList<String>(); private var n = 0
    private fun r(code: Int, body: ByteArray = ByteArray(0), vararg h: Pair<String, String>) = MockResponse().setResponseCode(code).apply { h.forEach { addHeader(it.first, it.second) }; if (body.isNotEmpty()) setBody(Buffer().write(body)) }
    private fun query(raw: String) = raw.substringAfter('?', "").split('&').filter { it.isNotEmpty() }.associate { val i = it.indexOf('='); java.net.URLDecoder.decode(if (i < 0) it else it.substring(0, i), "UTF-8") to java.net.URLDecoder.decode(if (i < 0) "" else it.substring(i + 1).replace("+", "%2B"), "UTF-8") }
    override fun dispatch(req: RecordedRequest): MockResponse {
        val method = req.method!!; val raw = req.path!!
        val auth = req.getHeader("Authorization") ?: ""
        if (!Regex("^AWS4-HMAC-SHA256 Credential=$accessKeyId/\\d{8}/[\\w-]+/s3/aws4_request, SignedHeaders=(content-type;)?host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$").matches(auth)) return r(403)
        val body = req.body.readByteArray()
        if (req.getHeader("x-amz-content-sha256") != MessageDigest.getInstance("SHA-256").digest(body).joinToString("") { "%02x".format(it) }) return r(400)
        val parts = java.net.URLDecoder.decode(raw.substringBefore('?').replace("+", "%2B"), "UTF-8").split('/').filter { it.isNotEmpty() }
        if (parts.firstOrNull() != bucket) return r(404)
        val key = parts.drop(1).joinToString("/")
        log.add("$method ${key.ifEmpty { "(bucket)" }}")
        if (key.isEmpty()) {
            val q = query(raw); val prefix = q["prefix"] ?: ""; val token = q["continuation-token"]?.toInt() ?: 0
            val keys = files.keys.filter { it.startsWith(prefix) && !(q["delimiter"] != null && it.substring(prefix.length).contains(q["delimiter"]!!)) }.sorted()
            val page = keys.drop(token).take(pageSize); val more = token + pageSize < keys.size
            fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;")
            return r(200, ("<?xml version=\"1.0\"?><ListBucketResult><IsTruncated>$more</IsTruncated>${if (more) "<NextContinuationToken>${token + pageSize}</NextContinuationToken>" else ""}" +
                page.joinToString("") { "<Contents><Key>${esc(it)}</Key><ETag>&quot;${files[it]!!.second}&quot;</ETag><Size>${files[it]!!.first.size}</Size></Contents>" } + "</ListBucketResult>").toByteArray(), "Content-Type" to "application/xml")
        }
        val cur = files[key]
        return when (method) {
            "PUT" -> {
                if (enforceConditions) {
                    if (req.getHeader("If-None-Match") == "*" && cur != null) return r(412)
                    req.getHeader("If-Match")?.let { if (cur == null || "\"${cur.second}\"" != it) return r(412) }
                }
                val etag = "e${++n}"; files[key] = body to etag; r(200, ByteArray(0), "ETag" to "\"$etag\"")
            }
            "GET" -> cur?.let { r(200, it.first, "ETag" to "\"${it.second}\"") } ?: r(404)
            "HEAD" -> cur?.let { r(200, ByteArray(0), "ETag" to "\"${it.second}\"") } ?: r(404)
            "DELETE" -> { files.remove(key); r(204) }
            else -> r(405)
        }
    }
}
