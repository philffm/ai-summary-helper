package eu.byphil.aishcompanion

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI

/** One feed in the sync vault: a live feed (title, tags) or a tombstone (removed = true). Same shape as the extension's feedSync.js. */
data class FeedEntry(val url: String, val title: String, val tags: List<String>, val updatedAt: Long, val removed: Boolean = false)

/** A feed on this phone as the vault sees it. */
data class SyncSub(val url: String, val title: String, val tags: List<String>)

data class SyncPlan(val add: List<SyncSub>, val update: List<SyncSub>, val remove: List<String>) {
    val isEmpty: Boolean get() = add.isEmpty() && update.isEmpty() && remove.isEmpty()
}

/**
 * Merge rules for the feed-URL vault; a port of the extension's feedSync.js and checked against the same shared vector
 * (src/test/resources/feed-sync-vector.json). Entries match by URL; the larger updatedAt wins; on a tie a tombstone wins, then the
 * larger canonical JSON. Tombstones older than 90 days are dropped. Order: updatedAt descending, then URL ascending.
 */
object FeedSync {
    const val TOMBSTONE_TTL_MS = 90L * 24 * 3600 * 1000
    const val MAX_FEEDS = 1000
    private const val MAX_TAGS = 8
    private val SPACES = Regex("[\\s\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+")
    private val STRIP = Regex("[\\u0000-\\u001f\\u007f\\s\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+")

    private fun clip(v: String?, n: Int): String = (v ?: "").replace(SPACES, " ").trim(' ').let { if (it.length > n) it.substring(0, n) else it }

    /** Web feed URLs only, in the form the browser's URL parser would write them (lower-case scheme and host, no default port, "/" for an empty path). "" when unusable. */
    fun cleanFeedUrl(raw: String?): String {
        if (raw == null) return ""
        val s = raw.replace(STRIP, "")
        if (s.isEmpty() || s.length > 2048) return ""
        val u = try { URI(s) } catch (_: Exception) { return "" }
        val scheme = u.scheme?.lowercase() ?: return ""
        if (scheme != "https" && scheme != "http") return ""
        if (u.userInfo != null) return ""
        // java.net.URI leaves the host null for names such as "a_b.example"; read those from the authority
        var host = u.host?.lowercase()
        var portNo = u.port
        if (host == null) {
            val auth = u.rawAuthority ?: return ""
            if ('@' in auth) return ""
            val i = auth.lastIndexOf(':')
            host = (if (i >= 0) auth.substring(0, i) else auth).lowercase()
            portNo = if (i >= 0) (auth.substring(i + 1).toIntOrNull() ?: return "") else -1
            if (!Regex("^[a-z0-9._-]+$").matches(host)) return ""
        }
        if (host.isEmpty()) return ""
        val port = if (portNo == -1 || (scheme == "https" && portNo == 443) || (scheme == "http" && portNo == 80)) "" else ":$portNo"
        val path = u.rawPath.let { if (it.isNullOrEmpty()) "/" else it }
        val query = u.rawQuery?.let { "?$it" } ?: ""
        val frag = u.rawFragment?.let { "#$it" } ?: ""
        return "$scheme://$host$port$path$query$frag"
    }

    fun cleanTags(tags: List<String?>): List<String> {
        val out = ArrayList<String>()
        for (t in tags) {
            val v = clip(t, 40)
            if (v.isNotEmpty() && out.none { it.lowercase() == v.lowercase() }) out.add(v)
            if (out.size >= MAX_TAGS) break
        }
        return out
    }

    fun clean(e: FeedEntry): FeedEntry? {
        val url = cleanFeedUrl(e.url)
        if (url.isEmpty() || e.updatedAt < 0) return null
        return if (e.removed) FeedEntry(url, "", emptyList(), e.updatedAt, true)
        else FeedEntry(url, clip(e.title, 200), cleanTags(e.tags), e.updatedAt)
    }

    private fun jsonString(s: String): String = buildString {
        append('"')
        for (c in s) when {
            c == '"' -> append("\\\"")
            c == '\\' -> append("\\\\")
            c == '\b' -> append("\\b")
            c == '\u000c' -> append("\\f")
            c == '\n' -> append("\\n")
            c == '\r' -> append("\\r")
            c == '\t' -> append("\\t")
            c < ' ' -> append("\\u%04x".format(c.code))
            else -> append(c)
        }
        append('"')
    }

    /** The exact text JSON.stringify gives the extension for this entry: the tie-break compares it, so it must match byte for byte. */
    fun canon(e: FeedEntry): String =
        if (e.removed) "{\"url\":${jsonString(e.url)},\"updatedAt\":${e.updatedAt},\"removed\":true}"
        else "{\"url\":${jsonString(e.url)},\"title\":${jsonString(e.title)},\"tags\":[${e.tags.joinToString(",") { jsonString(it) }}],\"updatedAt\":${e.updatedAt}}"

    private fun pick(a: FeedEntry, b: FeedEntry): FeedEntry = when {
        a.updatedAt != b.updatedAt -> if (a.updatedAt > b.updatedAt) a else b
        a.removed != b.removed -> if (a.removed) a else b
        else -> if (canon(a) >= canon(b)) a else b
    }

    private fun sorted(list: Collection<FeedEntry>): List<FeedEntry> = list.sortedWith(compareByDescending<FeedEntry> { it.updatedAt }.thenBy { it.url })

    fun cleanEntries(list: List<FeedEntry>): List<FeedEntry> {
        val map = LinkedHashMap<String, FeedEntry>()
        for (raw in list) {
            val e = clean(raw) ?: continue
            map[e.url] = map[e.url]?.let { pick(it, e) } ?: e
        }
        return sorted(map.values).take(MAX_FEEDS)
    }

    fun merge(a: List<FeedEntry>, b: List<FeedEntry>, now: Long): List<FeedEntry> {
        val map = LinkedHashMap<String, FeedEntry>()
        for (e in cleanEntries(a) + cleanEntries(b)) map[e.url] = map[e.url]?.let { pick(it, e) } ?: e
        return sorted(map.values.filter { !(it.removed && now - it.updatedAt > TOMBSTONE_TTL_MS) }).take(MAX_FEEDS)
    }

    fun same(a: List<FeedEntry>, b: List<FeedEntry>): Boolean = cleanEntries(a).map(::canon) == cleanEntries(b).map(::canon)

    /** What this phone did since the last sync: unchanged feeds keep their stamp, new or edited ones get [now], vanished ones become tombstones. */
    fun localEntries(subs: List<SyncSub>, base: List<FeedEntry>, now: Long): List<FeedEntry> {
        val was = cleanEntries(base).associateBy { it.url }
        val out = ArrayList<FeedEntry>()
        val live = HashSet<String>()
        for (s in subs) {
            val cur = clean(FeedEntry(s.url, s.title, s.tags, 0)) ?: continue
            if (!live.add(cur.url)) continue
            val old = was[cur.url]
            val unchanged = old != null && !old.removed && old.title == cur.title && old.tags == cur.tags
            out.add(if (unchanged) old!! else cur.copy(updatedAt = now))
        }
        for ((url, old) in was) {
            if (url in live) continue
            out.add(if (old.removed) old else FeedEntry(url, "", emptyList(), now, true))
        }
        return out
    }

    fun plan(subs: List<SyncSub>, merged: List<FeedEntry>): SyncPlan {
        val have = subs.associateBy { it.url }
        val add = ArrayList<SyncSub>(); val update = ArrayList<SyncSub>(); val remove = ArrayList<String>()
        for (e in merged) {
            val s = have[e.url]
            if (e.removed) { if (s != null) remove.add(e.url); continue }
            if (s == null) { add.add(SyncSub(e.url, e.title, e.tags)); continue }
            if ((e.title.isNotEmpty() && s.title != e.title) || cleanTags(s.tags) != e.tags) update.add(SyncSub(e.url, e.title.ifEmpty { s.title }, e.tags))
        }
        return SyncPlan(add, update, remove)
    }

    // ── document (JSON inside the sealed envelope) ──

    fun toJson(entries: List<FeedEntry>): String = "{\"v\":1,\"feeds\":[${entries.joinToString(",") { canon(it) }}]}"

    /** Reads the decrypted document. Throws on a wrong version; unusable entries are dropped by [cleanEntries]. */
    fun parse(json: String): List<FeedEntry> {
        val o = JSONObject(json)
        require(o.optInt("v") == 1) { "unsupported vault" }
        return parseEntries(o.getJSONArray("feeds"))
    }

    fun parseEntries(arr: JSONArray): List<FeedEntry> {
        val out = ArrayList<FeedEntry>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val removed = o.optBoolean("removed", false)
            val tagsArr = o.optJSONArray("tags")
            val tags = ArrayList<String?>()
            if (tagsArr != null) for (j in 0 until tagsArr.length()) tags.add(tagsArr.optString(j, ""))
            out.add(FeedEntry(o.optString("url", ""), o.optString("title", ""), tags.map { it ?: "" }, o.optLong("updatedAt", -1), removed))
        }
        return cleanEntries(out)
    }
}
