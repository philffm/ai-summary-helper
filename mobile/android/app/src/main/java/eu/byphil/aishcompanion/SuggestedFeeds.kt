package eu.byphil.aishcompanion

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

data class SuggestedFeed(val name: String, val url: String, val tags: List<String>, val note: String, val icon: String)

/**
 * The starter feeds of Add feed: the same list as the browser extension, kept in the repo as shared/suggested-feeds.json.
 * The app ships a copy (assets) and refreshes it from GitHub when Add feed opens, so the list can change without an app update.
 * Order of use: refreshed copy, else the shipped one. A broken download never replaces a good list.
 */
object SuggestedFeeds {
    const val SOURCE_URL = "https://raw.githubusercontent.com/philffm/ai-summary-helper/main/shared/suggested-feeds.json"
    private const val FILE = "suggested-feeds.json"
    private const val MAX_BYTES = 100_000

    /** Valid https entries only; null when the text is not a usable list. */
    fun parse(json: String?): List<SuggestedFeed>? = runCatching {
        val arr = JSONObject(json ?: return null).getJSONArray("feeds")
        val out = (0 until arr.length()).mapNotNull { i ->
            val o = arr.optJSONObject(i) ?: return@mapNotNull null
            val url = o.optString("url"); val name = o.optString("name").trim()
            if (!url.startsWith("https://") || name.isEmpty()) return@mapNotNull null
            val tags = o.optJSONArray("tags")?.let { t -> (0 until t.length()).map { t.optString(it).trim() }.filter { it.isNotEmpty() } } ?: emptyList()
            SuggestedFeed(name, url, tags, o.optString("note").trim(), o.optString("icon").ifBlank { "📰" })
        }.distinctBy { it.url }
        out.ifEmpty { null }
    }.getOrNull()

    fun load(context: Context): List<SuggestedFeed> {
        val cached = runCatching { parse(File(context.filesDir, FILE).readText()) }.getOrNull()
        if (cached != null) return cached
        return runCatching { parse(context.assets.open(FILE).bufferedReader().use { it.readText() }) }.getOrNull() ?: emptyList()
    }

    /** Blocking. Fetches the list from the repo and keeps it when it parses; returns the list to show (new, else what was there). */
    fun refresh(context: Context): List<SuggestedFeed> {
        runCatching {
            val c = URL(SOURCE_URL).openConnection() as HttpURLConnection
            c.connectTimeout = 8000; c.readTimeout = 8000; c.instanceFollowRedirects = false
            if (c.responseCode == 200) {
                val bytes = c.inputStream.use { it.readNBytes(MAX_BYTES + 1) }
                if (bytes.size <= MAX_BYTES) {
                    val text = String(bytes, Charsets.UTF_8)
                    if (parse(text) != null) File(context.filesDir, FILE).writeText(text)
                }
            }
            c.disconnect()
        }
        return load(context)
    }
}
