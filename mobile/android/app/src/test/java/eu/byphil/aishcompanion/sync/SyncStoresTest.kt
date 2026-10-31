package eu.byphil.aishcompanion.sync

import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class SyncStoresTest {
    private val server = MockWebServer()
    private val http = SyncHttp(allowInsecureLan = true)
    @After fun stop() { server.shutdown() }
    private fun url(path: String) = server.url(path).toString().trimEnd('/')

    // ── SigV4: AWS's documented S3 example "GET Object with a Range header" ──
    @Test fun signsLikeTheAwsExample() {
        val empty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        val s = S3Store.sign("GET", "https://examplebucket.s3.amazonaws.com/test.txt", mapOf("host" to "examplebucket.s3.amazonaws.com", "range" to "bytes=0-9", "x-amz-content-sha256" to empty, "x-amz-date" to "20130524T000000Z"),
            empty, "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "us-east-1", "20130524T000000Z")
        assertTrue(s.stringToSign.endsWith("\n7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972"))
        assertEquals("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41", s.signature)
    }

    @Test fun refusesPlainHttpAndRedirects() {
        assertThrows(StoreError::class.java) { SyncHttp().call("GET", "http://example.com/x") }
        server.start(); server.enqueue(okhttp3.mockwebserver.MockResponse().setResponseCode(302).addHeader("Location", "http://elsewhere.test/"))
        assertEquals(302, assertThrows(StoreError::class.java) { http.call("GET", url("/a")) }.status)
    }

    // ── WebDAV ──
    @Test fun webdavDoesWhatTheExtensionsStoreDoes() {
        val dav = FakeDav(); server.dispatcher = dav; server.start()
        val st = WebdavStore(url("/dav/"), "aish-sync/v1", "phil", "secret", http)
        assertTrue(st.ping()); assertTrue(dav.dirs.containsAll(listOf("aish-sync", "aish-sync/v1")))
        assertEquals(401, assertThrows(StoreError::class.java) { WebdavStore(url("/dav/"), "x", "phil", "nope", http).ping() }.status)
        val a = st.put("r/a1", byteArrayOf(1, 2, 3)); assertTrue(a.isNotEmpty()); assertTrue(dav.dirs.contains("aish-sync/v1/r"))
        assertArrayEquals(byteArrayOf(1, 2, 3), st.get("r/a1")!!.bytes); assertEquals(a, st.get("r/a1")!!.etag); assertNull(st.get("r/nope"))
        assertEquals(412, assertThrows(StoreError::class.java) { st.put("r/a1", byteArrayOf(9), ifNoneMatch = "*") }.status)
        assertEquals(412, assertThrows(StoreError::class.java) { st.put("r/a1", byteArrayOf(9), ifMatch = "stale") }.status)
        val b = st.put("r/a1", byteArrayOf(4), ifMatch = a); assertNotEquals(a, b)
        st.put("r/ä ö.json", byteArrayOf(5)); assertEquals(1, dav.files.keys.count { it.endsWith("ä ö.json") })
        st.put("meta.json", "{}".toByteArray())
        assertEquals(listOf("r/a1", "r/ä ö.json"), st.list("r").map { it.path }.sorted()); assertTrue(st.list("r").all { it.etag.isNotEmpty() && it.size > 0 })
        assertEquals("folders are not files", listOf("meta.json"), st.list("").map { it.path }); assertEquals(emptyList<StoredFile>(), st.list("nothing"))
        assertTrue(st.remove("r/a1")); assertFalse(st.remove("r/a1"))
        // the folder disappears on the server: the next upload makes it again
        dav.files.clear(); dav.dirs.clear(); dav.dirs.add("")
        assertTrue(st.put("r/back", byteArrayOf(7)).isNotEmpty()); assertTrue(dav.files.containsKey("aish-sync/v1/r/back"))
    }

    // ── S3 ──
    @Test fun s3DoesWhatTheExtensionsStoreDoes() {
        val s3 = FakeS3(); server.dispatcher = s3; server.start()
        val st = S3Store(url(""), "eu-central-1", "bucket1", "AKIDTEST", "secret", "aish/sync", http)
        assertTrue(st.ping())
        assertEquals(404, assertThrows(StoreError::class.java) { S3Store(url(""), "eu-central-1", "nope", "AKIDTEST", "secret", "x", http).ping() }.status)
        assertEquals(StoreError.Kind.AUTH, assertThrows(StoreError::class.java) { S3Store(url(""), "eu-central-1", "bucket1", "WRONG", "secret", "x", http).ping() }.kind)
        val a = st.put("r/a1", byteArrayOf(1, 2, 3)); assertTrue(s3.files.containsKey("aish/sync/r/a1"))
        assertArrayEquals(byteArrayOf(1, 2, 3), st.get("r/a1")!!.bytes); assertEquals(a, st.get("r/a1")!!.etag); assertNull(st.get("r/none"))
        assertEquals(412, assertThrows(StoreError::class.java) { st.put("r/a1", byteArrayOf(9), ifNoneMatch = "*") }.status)
        assertEquals(412, assertThrows(StoreError::class.java) { st.put("r/a1", byteArrayOf(9), ifMatch = "stale") }.status)
        assertEquals(412, assertThrows(StoreError::class.java) { st.put("r/new", byteArrayOf(9), ifMatch = "any") }.status)
        assertNotEquals(a, st.put("r/a1", byteArrayOf(4), ifMatch = a))
        st.put("r/ä ö+&.json", byteArrayOf(5)); assertArrayEquals(byteArrayOf(5), st.get("r/ä ö+&.json")!!.bytes)
        for (i in 0 until 7) st.put("r/f$i", byteArrayOf(1)); st.put("meta.json", "{}".toByteArray()); st.put("deep/er/file", byteArrayOf(1))
        val listed = st.list("r"); assertEquals("across pages", 9, listed.size); assertTrue(listed.any { it.path == "r/ä ö+&.json" }); assertTrue(listed.all { it.path.startsWith("r/") && it.etag.isNotEmpty() && it.size > 0 })
        assertEquals(listOf("meta.json"), st.list("").map { it.path }); assertEquals(emptyList<StoredFile>(), st.list("nothing"))
        assertTrue(st.remove("r/f0")); assertFalse(st.remove("r/f0"))
    }

    @Test fun s3WithAProviderThatIgnoresConditionsIsStillProtected() {
        val s3 = FakeS3(enforceConditions = false); server.dispatcher = s3; server.start()
        val st = S3Store(url(""), "us-east-1", "bucket1", "AKIDTEST", "secret", "p", http, now = { Instant.parse("2026-10-31T10:00:00Z") })
        st.put("x", byteArrayOf(1))
        assertEquals(412, assertThrows(StoreError::class.java) { st.put("x", byteArrayOf(2), ifNoneMatch = "*") }.status)
        assertEquals(412, assertThrows(StoreError::class.java) { st.put("x", byteArrayOf(2), ifMatch = "old") }.status)
    }

    @Test fun parsesPropfindAnswersWithOtherPrefixesAndEscapedEtags() {
        val xml = "<D:multistatus xmlns:D=\"DAV:\"><D:response><D:href>/dav/x/a%20b.json</D:href><D:propstat><D:prop><D:getetag>&quot;abc&quot;</D:getetag><D:getcontentlength>12</D:getcontentlength><D:resourcetype/></D:prop></D:propstat></D:response></D:multistatus>"
        val e = WebdavStore.parseMultistatus(xml).single(); assertEquals("/dav/x/a b.json", e.href); assertEquals("abc", e.etag); assertEquals(12L, e.size); assertFalse(e.isDir)
    }
}
