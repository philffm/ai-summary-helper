package eu.byphil.aishcompanion

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Everything the screens show, in one place: feeds, their items, the reading list and the sync state. The data lives in files
 * (see [FeedStore] and [ArticleStore]); this class keeps Compose state in step with them. Created once per activity.
 */
class AppModel(context: Context) {
    private val app = context.applicationContext
    val store = Store(app)
    val articles = ArticleStore(app)
    val feedStore = FeedStore(File(app.filesDir, "feeds"))

    var pairing by mutableStateOf(store.pairing)
    var feeds by mutableStateOf(feedStore.feeds())
    var entries by mutableStateOf(feedStore.everything())
    var articleList by mutableStateOf(articles.list())
    var alarm by mutableStateOf(store.alarm)
    var refreshing by mutableStateOf(false)
    var syncing by mutableStateOf(false)
    var checking by mutableStateOf(false)
    var lastSyncAt by mutableStateOf(feedStore.syncState().lastSyncAt)
    /** One short line for a snackbar; the UI shows it once and calls [consumeMessage]. */
    var message by mutableStateOf<String?>(null)

    fun consumeMessage() { message = null }

    fun reload() {
        feeds = feedStore.feeds()
        entries = feedStore.everything()
        articleList = articles.list()
        lastSyncAt = feedStore.syncState().lastSyncAt
        pairing = store.pairing
    }

    fun applyPairing(p: Pairing?) {
        store.pairing = p; store.lastError = null; pairing = p
        if (p?.canReceive == true) ReceiveWorker.schedule(app) else ReceiveWorker.cancel(app)
    }

    /** Saves the alarm settings and sets the system alarm to match. */
    fun changeAlarm(next: AlarmSettings) {
        store.alarm = next; alarm = next
        AlarmScheduler.reschedule(app)
    }

    // ── feeds ──

    /** Fetches every feed (one after the other) and, when the vault is paired, syncs the list first. Returns the number of new items. */
    suspend fun refreshAll(force: Boolean = true): Int = withContext(Dispatchers.IO) {
        refreshing = true
        try {
            if (pairing?.canSync == true) runSync()
            var added = 0
            val now = System.currentTimeMillis()
            for (f in feedStore.feeds()) {
                if (!force && now - f.lastFetched < STALE_MS) continue
                FeedFetcher.refresh(feedStore, f, System.currentTimeMillis())?.let { added += it }
            }
            reload()
            added
        } finally { refreshing = false }
    }

    /** null on success, else a short reason for the UI. */
    suspend fun addFeed(input: String, tagText: String): String? = withContext(Dispatchers.IO) {
        when (val r = FeedFetcher.lookup(input)) {
            is FeedLookup.Failed -> when (r.reason) {
                "invalid", "empty" -> "That is not a web address."
                "no-feed" -> "No feed found at that address."
                "unreachable", "cleartext" -> "Could not reach that address."
                else -> "Could not read that address."
            }
            is FeedLookup.Found -> {
                val now = System.currentTimeMillis()
                val f = feedStore.add(r.url, r.feed.title, parseTags(tagText), now)
                if (f == null) "Already subscribed."
                else {
                    feedStore.saveItems(f.url, r.feed.items)
                    feedStore.update(f.url) { it.copy(lastFetched = now) }
                    reload()
                    if (pairing?.canSync == true) syncFeeds()
                    null
                }
            }
        }
    }

    suspend fun removeFeed(url: String) = withContext(Dispatchers.IO) {
        feedStore.remove(url); reload()
        if (pairing?.canSync == true) syncFeeds()
    }

    /** Replaces the feed's tags with the comma-separated [tagText]. The extension's tags are all kept and shown; nothing is reduced to one folder. */
    suspend fun setTags(url: String, tagText: String) = withContext(Dispatchers.IO) {
        feedStore.update(url) { it.copy(tags = parseTags(tagText)) }; reload()
        if (pairing?.canSync == true) syncFeeds()
    }

    suspend fun rename(url: String, name: String) = withContext(Dispatchers.IO) {
        feedStore.update(url) { it.copy(customTitle = if (name.isBlank() || name == it.title) "" else name.trim().take(200)) }; reload()
        if (pairing?.canSync == true) syncFeeds()
    }

    suspend fun markRead(feedUrl: String, id: String, read: Boolean = true) = withContext(Dispatchers.IO) {
        feedStore.markRead(feedUrl, id, read); entries = feedStore.everything()
    }

    suspend fun markAllRead(feedUrls: List<String>) = withContext(Dispatchers.IO) {
        feedUrls.forEach { feedStore.markAllRead(it) }; entries = feedStore.everything()
    }

    // ── sync ──

    /** Runs one vault sync and stores the result. Returns an error code or null. Call on a background thread. */
    private fun runSync(): String? {
        val p = pairing ?: return "not-enabled"
        if (!p.canSync) return "not-enabled"
        val now = System.currentTimeMillis()
        val result = VaultClient().sync(p, feedStore.syncSubs(), feedStore.syncState(), now)
        if (result.error != null) return result.error
        feedStore.applyPlan(result.plan, now)
        feedStore.saveSyncState(SyncState(result.rev, result.merged, now))
        reload()
        return null
    }

    /** User-triggered sync with a message. */
    suspend fun syncFeeds(): String = withContext(Dispatchers.IO) {
        syncing = true
        try {
            val before = feedStore.feeds().size
            val err = runSync()
            val text = when (err) {
                null -> { val after = feedStore.feeds().size; if (after == before) "Feed list is up to date." else "Feed list synced (${after - before} " + (if (after >= before) "new" else "removed") + ")." }
                "not-enabled" -> "Switch on feed sync in the extension first, then scan the new code."
                "unreadable" -> "The synced list could not be read. Scan the code again."
                "too-large" -> "The feed list is too large to sync."
                "conflict" -> "Another device changed the list at the same time. Try again."
                "rate-limited" -> "Too many requests. Try again later."
                "pairing-invalid" -> "The pairing is no longer valid. Scan the code again."
                "unreachable" -> "The server is not reachable."
                else -> "Sync did not work."
            }
            message = text
            text
        } finally { syncing = false }
    }

    suspend fun checkArticles(): String = withContext(Dispatchers.IO) {
        checking = true
        try {
            val out = Receiver.run(app)
            reload()
            when (out.error) {
                null -> if (out.added == 0) "Nothing new." else "${out.added} new."
                "unreachable" -> "The server is not reachable."
                "pairing-invalid" -> "The pairing is no longer valid. Scan the code again."
                else -> "Could not check right now."
            }
        } finally { checking = false }
    }

    companion object {
        const val STALE_MS = 30L * 60 * 1000
        fun parseTags(text: String): List<String> = FeedSync.cleanTags(text.split(',', ';'))
    }
}

/** Refreshes the feeds and syncs the list once an hour while online. */
class FeedWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val model = AppModel(applicationContext)
        return try { model.refreshAll(force = false); Result.success() } catch (_: Exception) { Result.retry() }
    }

    companion object {
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<FeedWorker>(1, TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("refresh-feeds", ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}
