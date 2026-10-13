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
    /** The Pro license key (from the pairing code or typed in); empty when there is none. */
    var license by mutableStateOf(store.license)
    /** Why the alarm could not be set, for the settings card. */
    var alarmError by mutableStateOf<String?>(null)
    var refreshing by mutableStateOf(false)
    /** True while the on-device model rates the feed items by mood. */
    var rating by mutableStateOf(false)
    var syncing by mutableStateOf(false)
    var checking by mutableStateOf(false)
    var lastSyncAt by mutableStateOf(feedStore.syncState().lastSyncAt)
    /** One short line for a snackbar; the UI shows it once and calls [consumeMessage]. */
    var message by mutableStateOf<String?>(null)

    fun consumeMessage() { message = null }

    /** Bumped when read state flips so lists redraw. */
    var readTick by androidx.compose.runtime.mutableIntStateOf(0)

    fun toggleRead(id: String) {
        if (articles.isRead(id)) articles.markUnread(id) else articles.markRead(id)
        readTick++
    }

    fun reload() {
        feeds = feedStore.feeds()
        entries = feedStore.everything()
        articleList = articles.list()
        lastSyncAt = feedStore.syncState().lastSyncAt
        pairing = store.pairing
    }

    /** Puts a page summarized on the phone into the reading list (marked as local; same link replaces the old entry). */
    suspend fun saveSummary(url: String, page: Page, summary: String, passages: List<String> = emptyList()) = withContext(Dispatchers.IO) {
        val now = System.currentTimeMillis()
        val id = PageSummary.localId(url)
        val json = PageSummary.articleJson(url, page, summary, now, passages)
        articles.save(ArticleCodec.parse(json, id), json, now)
        articleList = articles.list()
    }

    var leftHanded by mutableStateOf(store.leftHanded.also { Handed.left = it })
    fun changeLeftHanded(on: Boolean) { store.leftHanded = on; leftHanded = on; Handed.left = on }
    var groupSimilar by mutableStateOf(store.groupSimilar)
    fun changeGroupSimilar(on: Boolean) { store.groupSimilar = on; groupSimilar = on }
    var summaryLang by mutableStateOf(store.summaryLang)
    var speakSummary by mutableStateOf(store.speakSummary)
    fun changeSpeakSummary(on: Boolean) { store.speakSummary = on; speakSummary = on }
    var ghostMarks by mutableStateOf(store.ghostMarks)
    fun changeSummaryLang(code: String) { store.summaryLang = code; summaryLang = code }
    fun changeGhostMarks(on: Boolean) { store.ghostMarks = on; ghostMarks = on }

    fun applyPairing(p: Pairing?) {
        store.pairing = p; store.lastError = null; pairing = p
        if (p == null) saveLicense("")   // unpairing also forgets the Pro key
        else p.license?.let { saveLicense(it) }   // a key in the code replaces the one entered by hand
        if (p?.canReceive == true) ReceiveWorker.schedule(app) else ReceiveWorker.cancel(app)
    }

    var accountEmail by mutableStateOf(store.accountEmail)
    fun signIn(s: Signed) { store.accountEmail = s.email; accountEmail = store.accountEmail; if (s.license.isNotBlank()) saveLicense(s.license) }
    fun signOut() { store.accountEmail = ""; accountEmail = ""; saveLicense("") }
    fun saveLicense(key: String) { store.license = key; license = store.license }

    /** Saves the alarm settings and sets the system alarm to match. */
    fun changeAlarm(next: AlarmSettings) {
        Guard.begin(app, "alarm")   // cleared by the settings card once it has been drawn with the new settings
        store.alarm = next; alarm = next
        try {
            AlarmScheduler.reschedule(app); alarmError = null
        } catch (e: Throwable) {
            alarmError = "The alarm could not be set: ${e::class.java.simpleName}: ${e.message}"
            store.alarm = next.copy(enabled = false); alarm = store.alarm
            Guard.end(app, "alarm")
        }
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
                // gentle: a feed fetched a moment ago is left alone, a feed that failed last time waits longer
                val wait = if (f.error.isNotEmpty() && !force) BROKEN_MS else if (force) MIN_MS else STALE_MS
                if (now - f.lastFetched < wait) continue
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

    var recapText by mutableStateOf(store.recapText)
    var recapAt by mutableStateOf(store.recapAt)
    var recapCount by mutableStateOf(store.recapCount)
    var recapBusy by mutableStateOf(false)

    /** Writes the day recap with the on-device model (never automatically: it takes a while and uses battery). Returns a short line only when something is wrong. */
    suspend fun refreshRecap(): String? = withContext(Dispatchers.Default) {
        if (!LocalLlm.installed(app)) "Download the on-device AI in Settings to write the recap."
        else {
            val ranked = DayRecap.pickRanked(feedStore.everything(), System.currentTimeMillis())
            val items = ranked.map { it.lead }
            if (items.isEmpty()) "No stories from today yet. Pull down to refresh."
            else {
                recapBusy = true
                try {
                    val text = DayRecap.cleanReply(LocalLlm.generate(app, DayRecap.system(store.summaryLang), DayRecap.user(items, ranked.map { it.sources })))
                    if (text == null) "The model could not write the recap. Try again."
                    else {
                        val at = System.currentTimeMillis()
                        store.recapText = text; store.recapAt = at; store.recapCount = items.size
                        recapText = text; recapAt = at; recapCount = items.size
                        null
                    }
                } finally { recapBusy = false }
            }
        }
    }

    /** Rates unrated recent items by mood with the on-device model. Returns a short line for the UI. */
    suspend fun rateMood(): String = withContext(Dispatchers.Default) {
        if (!LocalLlm.installed(app)) "Download the on-device AI in Settings first."
        else {
            rating = true
            try {
                val n = MoodRater.rate(app, feedStore, feedStore.everything())
                reload()
                if (n == 0) "Nothing new to rate." else "Rated $n items by mood."
            } finally { rating = false }
        }
    }

    suspend fun markRead(feedUrl: String, id: String, read: Boolean = true) = withContext(Dispatchers.IO) {
        feedStore.markRead(feedUrl, id, read); entries = feedStore.everything()
    }

    suspend fun setFavorite(feedUrl: String, id: String, fav: Boolean) = withContext(Dispatchers.IO) {
        feedStore.setFavorite(feedUrl, id, fav); entries = feedStore.everything()
    }

    /** Actions on a selection: [keys] are [selectionKey]s ("feed url\nitem id"). */
    private fun grouped(keys: Collection<String>): Map<String, Set<String>> =
        keys.groupBy({ it.substringBefore('\n') }, { it.substringAfter('\n') }).mapValues { it.value.toSet() }

    suspend fun markReadMany(keys: Collection<String>, read: Boolean) = withContext(Dispatchers.IO) {
        grouped(keys).forEach { (u, ids) -> feedStore.markReadIds(u, ids, read) }; entries = feedStore.everything()
    }

    suspend fun setFavoriteMany(keys: Collection<String>, fav: Boolean) = withContext(Dispatchers.IO) {
        grouped(keys).forEach { (u, ids) -> feedStore.setFavoriteIds(u, ids, fav) }; entries = feedStore.everything()
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
        /** Pull-to-refresh and the refresh button skip feeds fetched less than this ago. */
        const val MIN_MS = 2L * 60 * 1000
        /** A feed that failed is not retried by the automatic refresh before this. */
        const val BROKEN_MS = 6L * 60 * 60 * 1000
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
