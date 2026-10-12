package eu.byphil.aishcompanion

import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** A subscribed feed on this phone. [customTitle] is the name the user gave it; it is what syncs as the title. */
data class Feed(
    val url: String,
    val title: String,
    val customTitle: String = "",
    val tags: List<String> = emptyList(),
    val addedAt: Long = 0,
    val lastFetched: Long = 0,
    val error: String = "",
    /** Validators of the last download, so the next refresh can ask "has it changed?" and cost almost nothing when it has not. */
    val etag: String = "",
    val modified: String = "",
) {
    val name: String get() = customTitle.ifBlank { title.ifBlank { url } }
    /** The folder the phone shows the feed under: the first tag. */
    val folder: String get() = tags.firstOrNull() ?: ""
}

/** [sent]: sentiment from -1 (heavy) to 1 (good), rated by the on-device model; null = not rated yet. [cat]: reserved for a category label. */
data class StoredItem(val item: FeedItem, val read: Boolean, val sent: Double? = null, val cat: String = "", val fav: Boolean = false)

/** One entry of the "all items" list. */
data class FeedEntryRef(val feed: Feed, val stored: StoredItem)

/**
 * Feeds and their latest items in files under [dir] (app-private on the phone): feeds.json, and one items-<hash>.json per feed.
 * Items are the feed's own latest entries (at most [FeedXml.MAX_ITEMS]); they are never synced, each device fetches its own.
 * Pure JVM (a directory instead of a Context), so it is unit-tested.
 */
class FeedStore(private val dir: File) {
    init { dir.mkdirs() }

    private val feedsFile get() = File(dir, "feeds.json")

    private fun fileFor(url: String) = File(dir, "items-" + MessageDigest.getInstance("SHA-1").digest(url.toByteArray()).joinToString("") { "%02x".format(it) } + ".json")

    // ── feeds ──

    @Synchronized fun feeds(): List<Feed> = readRoot().first

    @Synchronized private fun readRoot(): Pair<List<Feed>, SyncState> {
        val f = feedsFile
        if (!f.exists()) return emptyList<Feed>() to SyncState()
        return try {
            val o = JSONObject(f.readText())
            val arr = o.optJSONArray("subs")
            val list = ArrayList<Feed>()
            if (arr != null) for (i in 0 until arr.length()) {
                val s = arr.optJSONObject(i) ?: continue
                val url = FeedSync.cleanFeedUrl(s.optString("url", ""))
                if (url.isEmpty()) continue
                val tags = ArrayList<String?>(); s.optJSONArray("tags")?.let { t -> for (j in 0 until t.length()) tags.add(t.optString(j, "")) }
                list.add(Feed(url, s.optString("title", ""), s.optString("customTitle", ""), FeedSync.cleanTags(tags), s.optLong("addedAt", 0), s.optLong("lastFetched", 0), s.optString("error", ""), s.optString("etag", ""), s.optString("modified", "")))
            }
            val sy = o.optJSONObject("sync")
            val state = if (sy == null) SyncState() else SyncState(sy.optLong("rev", 0), sy.optJSONArray("base")?.let { FeedSync.parseEntries(it) } ?: emptyList(), sy.optLong("lastSyncAt", 0))
            list to state
        } catch (_: Exception) { emptyList<Feed>() to SyncState() }
    }

    @Synchronized private fun write(feeds: List<Feed>, state: SyncState) {
        val subs = JSONArray()
        for (f in feeds) subs.put(JSONObject().put("url", f.url).put("title", f.title).put("customTitle", f.customTitle).put("tags", JSONArray(f.tags)).put("addedAt", f.addedAt).put("lastFetched", f.lastFetched).put("error", f.error).put("etag", f.etag).put("modified", f.modified))
        val base = JSONArray()
        for (e in state.base) base.put(JSONObject(FeedSync.canon(e)))
        val o = JSONObject().put("subs", subs).put("sync", JSONObject().put("rev", state.rev).put("lastSyncAt", state.lastSyncAt).put("base", base))
        val tmp = File(dir, "feeds.json.tmp")
        tmp.writeText(o.toString())
        if (!tmp.renameTo(feedsFile)) { feedsFile.delete(); tmp.renameTo(feedsFile) }
    }

    @Synchronized fun saveFeeds(feeds: List<Feed>) = write(feeds, readRoot().second)

    /** False when the URL is not a web link or is already subscribed. */
    @Synchronized fun add(url: String, title: String, tags: List<String>, now: Long): Feed? {
        val clean = FeedSync.cleanFeedUrl(url)
        val (feeds, state) = readRoot()
        if (clean.isEmpty() || feeds.any { it.url == clean }) return null
        val f = Feed(clean, title.trim().take(200), "", FeedSync.cleanTags(tags), now)
        write(feeds + f, state)
        return f
    }

    @Synchronized fun update(url: String, change: (Feed) -> Feed) {
        val (feeds, state) = readRoot()
        write(feeds.map { if (it.url == url) change(it) else it }, state)
    }

    @Synchronized fun remove(url: String) {
        val (feeds, state) = readRoot()
        write(feeds.filter { it.url != url }, state)
        fileFor(url).delete()
    }

    // ── sync ──

    @Synchronized fun syncState(): SyncState = readRoot().second
    @Synchronized fun saveSyncState(s: SyncState) = write(readRoot().first, s)

    /** The feeds as the vault sees them (the name the user sees is the title that syncs). */
    fun syncSubs(): List<SyncSub> = feeds().map { SyncSub(it.url, it.name.takeIf { n -> n != it.url } ?: "", it.tags) }

    /** Makes the stored feeds match what the vault says (see [FeedSync.plan]). */
    @Synchronized fun applyPlan(plan: SyncPlan, now: Long) {
        var (feeds, state) = readRoot()
        for (u in plan.remove) { feeds = feeds.filter { it.url != u }; fileFor(u).delete() }
        feeds = feeds.map { f ->
            val up = plan.update.firstOrNull { it.url == f.url } ?: return@map f
            f.copy(tags = up.tags, customTitle = if (up.title.isNotBlank() && up.title != f.title) up.title else "")
        }
        for (a in plan.add) if (feeds.none { it.url == a.url }) feeds = feeds + Feed(a.url, a.title, "", a.tags, now)
        write(feeds, state)
    }

    // ── items ──

    @Synchronized fun items(url: String): List<StoredItem> {
        val f = fileFor(url)
        if (!f.exists()) return emptyList()
        return try {
            val arr = JSONArray(f.readText())
            (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                StoredItem(FeedItem(o.optString("id", ""), o.optString("title", ""), o.optString("link", ""), o.optLong("published", 0), o.optString("author", ""), o.optString("summary", ""), o.optString("body", ""), o.optString("audio", ""), o.optInt("duration", 0)), o.optBoolean("read", false),
                    if (o.has("sent")) o.optDouble("sent").takeIf { !it.isNaN() } else null, o.optString("cat", ""), o.optBoolean("fav", false))
            }
        } catch (_: Exception) { emptyList() }
    }

    /**
     * Replaces the stored items with the feed's latest, keeping read flag, rating and favourite of items seen before. Favourites that
     * have dropped out of the feed stay (after the fresh ones), so a starred item is never lost. Returns how many are new.
     */
    @Synchronized fun saveItems(url: String, fresh: List<FeedItem>): Int {
        val old = items(url).associateBy { it.item.id }
        val arr = JSONArray()
        var added = 0
        val kept = HashSet<String>()
        for (it in fresh.take(FeedXml.MAX_ITEMS)) {
            val was = old[it.id]
            if (was == null) added++
            kept += it.id
            arr.put(json(StoredItem(it, was?.read ?: false, was?.sent, was?.cat ?: "", was?.fav ?: false)))
        }
        for (was in old.values) if (was.fav && was.item.id !in kept) arr.put(json(was))
        fileFor(url).writeText(arr.toString())
        return added
    }

    @Synchronized private fun rewrite(url: String, change: (StoredItem) -> StoredItem) {
        val list = items(url)
        if (list.isEmpty()) return
        val arr = JSONArray()
        for (s in list) arr.put(json(change(s)))
        fileFor(url).writeText(arr.toString())
    }

    @Synchronized fun markRead(url: String, id: String, read: Boolean = true) = rewrite(url) { if (it.item.id == id) it.copy(read = read) else it }

    @Synchronized fun setFavorite(url: String, id: String, fav: Boolean) = rewrite(url) { if (it.item.id == id) it.copy(fav = fav) else it }

    /** Stores sentiment ratings (item id → -1..1) next to the items; other items keep what they have. */
    @Synchronized fun setRatings(url: String, ratings: Map<String, Double>) {
        if (ratings.isEmpty()) return
        rewrite(url) { s -> s.copy(sent = ratings[s.item.id]?.coerceIn(-1.0, 1.0) ?: s.sent) }
    }

    private fun json(s: StoredItem): JSONObject {
        val item = s.item
        val o = JSONObject().put("id", item.id).put("title", item.title).put("link", item.link).put("published", item.published)
            .put("author", item.author).put("summary", item.summary).put("body", item.body).put("read", s.read)
        if (item.audio.isNotEmpty()) o.put("audio", item.audio)
        if (item.duration > 0) o.put("duration", item.duration)
        if (s.sent != null) o.put("sent", s.sent)
        if (s.cat.isNotEmpty()) o.put("cat", s.cat)
        if (s.fav) o.put("fav", true)
        return o
    }

    @Synchronized fun markAllRead(url: String) = rewrite(url) { it.copy(read = true) }

    /** Everything, newest first; items without a date sort by feed order after dated ones. */
    fun everything(): List<FeedEntryRef> =
        feeds().flatMap { f -> items(f.url).map { FeedEntryRef(f, it) } }
            .sortedWith(compareByDescending<FeedEntryRef> { it.stored.item.published })

    fun unread(url: String? = null): Int = if (url != null) items(url).count { !it.read } else feeds().sumOf { f -> items(f.url).count { !it.read } }
}

/** Downloads a feed or a page: https and http only, follows up to 5 redirects (also http → https), at most [MAX_BYTES], never throws. */
object Net {
    const val MAX_BYTES = 3_000_000

    data class Page(val code: Int, val text: String, val finalUrl: String, val error: String? = null, val etag: String = "", val modified: String = "", val notModified: Boolean = false)

    /** [etag] / [modified] from the last download make this a conditional request: an unchanged feed answers 304 (notModified) with no body. */
    fun get(url: String, timeoutMs: Int = 20_000, etag: String = "", modified: String = ""): Page {
        var current = url
        try {
            for (hop in 0..5) {
                if (!(current.startsWith("https://") || current.startsWith("http://"))) return Page(0, "", current, "not-web")
                val conn = URL(current).openConnection() as HttpURLConnection
                try {
                    conn.instanceFollowRedirects = false
                    conn.connectTimeout = timeoutMs; conn.readTimeout = timeoutMs
                    conn.setRequestProperty("User-Agent", "AISH-Companion/1 (+https://byphil.eu)")
                    if (etag.isNotEmpty()) conn.setRequestProperty("If-None-Match", etag)
                    if (modified.isNotEmpty()) conn.setRequestProperty("If-Modified-Since", modified)
                    conn.setRequestProperty("Accept", "application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, text/html;q=0.8, */*;q=0.5")
                    val code = conn.responseCode
                    if (code in 301..308 && code != 304) {
                        val loc = conn.getHeaderField("Location") ?: return Page(code, "", current, "redirect")
                        current = FeedXml.resolve(current, loc); if (current.isEmpty()) return Page(code, "", url, "redirect")
                        continue
                    }
                    if (code == 304) return Page(304, "", current, notModified = true)
                    if (code !in 200..299) return Page(code, "", current, "http-$code")
                    val bytes = conn.inputStream.use { readLimited(it, MAX_BYTES) } ?: return Page(code, "", current, "too-large")
                    return Page(code, decode(bytes, conn.contentType), current, etag = conn.getHeaderField("ETag") ?: "", modified = conn.getHeaderField("Last-Modified") ?: "")
                } finally { conn.disconnect() }
            }
            return Page(0, "", current, "redirect")
        } catch (_: java.net.UnknownServiceException) {
            return Page(0, "", current, "cleartext")
        } catch (_: IOException) {
            return Page(0, "", current, "unreachable")
        }
    }

    private fun readLimited(input: java.io.InputStream, limit: Int): ByteArray? {
        val out = ByteArrayOutputStream(); val buf = ByteArray(16 * 1024); var total = 0
        while (true) { val n = input.read(buf); if (n < 0) break; total += n; if (total > limit) return null; out.write(buf, 0, n) }
        return out.toByteArray()
    }

    fun decode(bytes: ByteArray, contentType: String?): String {
        val fromHeader = contentType?.let { Regex("charset=([\\w-]+)", RegexOption.IGNORE_CASE).find(it)?.groupValues?.get(1) }
        val head = String(bytes, 0, minOf(bytes.size, 300), Charsets.ISO_8859_1)
        val fromProlog = Regex("encoding=[\"']([\\w-]+)[\"']", RegexOption.IGNORE_CASE).find(head)?.groupValues?.get(1)
        val cs = try { java.nio.charset.Charset.forName(fromHeader ?: fromProlog ?: "UTF-8") } catch (_: Exception) { Charsets.UTF_8 }
        return String(bytes, cs)
    }
}

/** Result of reading one feed address. */
sealed interface FeedLookup {
    data class Found(val url: String, val feed: ParsedFeed) : FeedLookup
    data class Failed(val reason: String) : FeedLookup
}

/** Fetching and finding feeds. Blocking: call from a background thread. */
object FeedFetcher {
    /** Reads [input] as a feed address, or as a web page that links to its feed (the first one found). */
    fun lookup(input: String, fetch: (String) -> Net.Page = { Net.get(it) }): FeedLookup {
        var u = input.trim()
        if (u.isEmpty()) return FeedLookup.Failed("empty")
        if (!u.contains("://")) u = "https://$u"
        val clean = FeedSync.cleanFeedUrl(u)
        if (clean.isEmpty()) return FeedLookup.Failed("invalid")
        val page = fetch(clean)
        if (page.error != null) return FeedLookup.Failed(page.error)
        FeedXml.parse(page.text, page.finalUrl)?.let { return FeedLookup.Found(FeedSync.cleanFeedUrl(page.finalUrl).ifEmpty { clean }, it) }
        for (candidate in FeedXml.discover(page.text, page.finalUrl)) {
            val p2 = fetch(candidate)
            if (p2.error != null) continue
            val parsed = FeedXml.parse(p2.text, p2.finalUrl) ?: continue
            return FeedLookup.Found(FeedSync.cleanFeedUrl(p2.finalUrl).ifEmpty { candidate }, parsed)
        }
        return FeedLookup.Failed("no-feed")
    }

    /**
     * Refreshes one stored feed; returns the number of new items, or null with the error saved on the feed. Sends the validators of the
     * last download, so an unchanged feed costs one tiny request (304) and no parsing.
     */
    fun refresh(store: FeedStore, feed: Feed, now: Long, fetch: (String) -> Net.Page = { u -> Net.get(u, etag = feed.etag, modified = feed.modified) }): Int? {
        val page = fetch(feed.url)
        if (page.notModified) { store.update(feed.url) { it.copy(lastFetched = now, error = "") }; return 0 }
        val parsed = if (page.error == null) FeedXml.parse(page.text, page.finalUrl) else null
        if (parsed == null) {
            store.update(feed.url) { it.copy(error = page.error ?: "not-a-feed") }
            return null
        }
        val added = store.saveItems(feed.url, parsed.items)
        store.update(feed.url) { it.copy(title = parsed.title.ifBlank { it.title }, lastFetched = now, error = "", etag = page.etag, modified = page.modified) }
        return added
    }
}
