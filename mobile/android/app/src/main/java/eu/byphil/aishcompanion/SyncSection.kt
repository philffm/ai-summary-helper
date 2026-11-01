package eu.byphil.aishcompanion

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusEvent
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import eu.byphil.aishcompanion.sync.FileRecordStore
import eu.byphil.aishcompanion.sync.KeyValue
import eu.byphil.aishcompanion.sync.LibraryCode
import eu.byphil.aishcompanion.sync.LibrarySync
import eu.byphil.aishcompanion.sync.StoreError
import eu.byphil.aishcompanion.sync.SyncCrypto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.TimeUnit

/** The library place of this phone, backed by app-private storage (nothing in it is ever included in a settings export). */
fun libraryOf(context: Context): LibrarySync {
    val app = context.applicationContext
    val prefs = app.getSharedPreferences("aish-sync", Context.MODE_PRIVATE)
    val kv = object : KeyValue {
        override fun get(key: String) = prefs.getString(key, null)
        override fun put(key: String, value: String?) { prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply() }
    }
    return LibrarySync(kv, FileRecordStore(File(app.filesDir, "sync")))
}

/** Makes reading-list articles of the synced records (the background run has no screen to refresh: the list reads them when the app opens). */
fun materializeLibrary(context: Context): Int {
    val app = context.applicationContext
    val r = ArticleMaterializer(libraryOf(app).records, ArticleStoreSink(ArticleStore(app)), File(app.filesDir, "sync/materialized.json")).run()
    return r.saved + r.removed
}

private const val WORK = "aish-library-sync"

/** Sync every few hours while there is a network, as long as a library is joined. */
fun scheduleLibrarySync(context: Context, on: Boolean) {
    val wm = WorkManager.getInstance(context.applicationContext)
    if (!on) { wm.cancelUniqueWork(WORK); return }
    val req = PeriodicWorkRequestBuilder<LibrarySyncWorker>(6, TimeUnit.HOURS).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
    wm.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, req)
}

/** One run soon (after a note was written): the work waits for a network and is skipped when no library is joined. */
fun syncLibrarySoon(context: Context) {
    val req = androidx.work.OneTimeWorkRequestBuilder<LibrarySyncWorker>().setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
    WorkManager.getInstance(context.applicationContext).enqueueUniqueWork("aish-library-sync-soon", androidx.work.ExistingWorkPolicy.REPLACE, req)
}

class LibrarySyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val lib = libraryOf(applicationContext)
        if (!lib.isConnected()) return Result.success()
        return try { lib.syncNow(); materializeLibrary(applicationContext); Result.success() }
        catch (e: StoreError) { if (e.kind == StoreError.Kind.PERMANENT) Result.failure() else Result.retry() }   // the screen shows the last problem
        catch (_: Exception) { Result.failure() }
    }
}

/** Joins the encrypted library the browser made, in a Nextcloud/WebDAV folder or an S3 bucket, and syncs it. */
@Composable
fun LibrarySyncCard(model: AppModel, onScan: ((String?) -> Unit) -> Unit = {}) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    val lib = model.library
    var tick by remember { mutableStateOf(0) }   // re-reads the state kept by the library after every action
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var failed by remember { mutableStateOf(false) }
    var shown by remember { mutableStateOf<String?>(null) }
    var kind by remember { mutableStateOf("webdav") }
    var url by remember { mutableStateOf("") }; var user by remember { mutableStateOf("") }; var pass by remember { mutableStateOf("") }
    var root by remember { mutableStateOf("aish-sync") }
    var region by remember { mutableStateOf("us-east-1") }; var bucket by remember { mutableStateOf("") }
    var keyId by remember { mutableStateOf("") }; var secret by remember { mutableStateOf("") }
    var passphrase by remember { mutableStateOf("") }
    @Suppress("UNUSED_EXPRESSION") tick
    val connected = lib.isConnected()

    fun friendly(e: Throwable): String = when (e) {
        is SyncCrypto.WrongKey -> "Wrong passphrase. Check the words: capitals, spaces and dashes do not matter, but every word must be right."
        is StoreError -> e.message ?: "The server could not be reached."
        else -> e.message ?: e.javaClass.simpleName
    }
    fun run(block: suspend () -> String?) {
        busy = true; message = null; failed = false
        scope.launch {
            try { message = withContext(Dispatchers.IO) { block() } } catch (e: Exception) { message = friendly(e); failed = true }
            busy = false; tick++
        }
    }
    fun summary(s: eu.byphil.aishcompanion.sync.LibrarySync.Summary): String {
        val articles = model.materialize()   // runs here, off the main thread (see run())
        return if (s.errors.isNotEmpty()) "${s.errors.size} problem(s): ${s.errors.first()}" else if (s.needsConfirm > 0) "${s.needsConfirm} deletion(s) from other devices are waiting for your OK." else
            "Done. ${s.pulled} received, ${s.pushed} sent." + (if (articles > 0) " $articles article(s) added to your reading list." else "") + if (s.more) " More to come, it continues next time." else ""
    }

    fun join(cfg: LibrarySync.Config, phrase: String) = run { lib.connect(cfg, phrase); passphrase = ""; scheduleLibrarySync(context, true); summary(lib.syncNow()) }
    fun readCode(text: String?) {
        val p = LibraryCode.parse(text)
        if (p == null) { message = "That is not a library code from the browser."; failed = true; return }
        val c = p.config
        kind = c.kind; url = c.url; user = c.username; pass = c.password; root = c.root; region = c.region; bucket = c.bucket; keyId = c.accessKeyId; secret = c.secretKey
        failed = false
        if (p.words != null) { passphrase = p.words; join(c, p.words) } else message = "Code read. Type your passphrase to finish."
    }

    if (!connected) {
        InfoCard("Join your library", "Set up sync in the browser first (Settings → Sync & backup → Add a place). Then enter the same server and passphrase here. Your library is encrypted before it leaves the browser, and this phone opens it with the passphrase.")
        SettingsGroup {
            Button(onClick = { onScan { readCode(it) } }, Modifier.fillMaxWidth(), enabled = !busy) { Text("Scan code from the browser") }
            Text("In the browser: Settings → Sync & backup → your place → Show code for the phone. Or fill in the details below.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(kind == "webdav", { kind = "webdav" }, { Text("Nextcloud / WebDAV") })
                FilterChip(kind == "s3", { kind = "s3" }, { Text("S3") })
            }
            if (kind == "webdav") {
                OutlinedTextField(url, { url = it }, Modifier.fillMaxWidth().keepVisible(), label = { Text("WebDAV address") }, placeholder = { Text("https://cloud.example.com/remote.php/dav/files/you/") }, singleLine = true)
                OutlinedTextField(user, { user = it }, Modifier.fillMaxWidth().keepVisible(), label = { Text("Username") }, singleLine = true)
                OutlinedTextField(pass, { pass = it }, Modifier.fillMaxWidth().keepVisible(), label = { Text("App password") }, singleLine = true, visualTransformation = PasswordVisualTransformation())
                Text("In Nextcloud: Settings → Security → create an app password. Never use your main password.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                OutlinedTextField(url, { url = it }, Modifier.fillMaxWidth().keepVisible(), label = { Text("Endpoint address") }, placeholder = { Text("https://s3.eu-central-1.amazonaws.com") }, singleLine = true)
                OutlinedTextField(region, { region = it }, Modifier.fillMaxWidth().keepVisible(), label = { Text("Region") }, singleLine = true)
                OutlinedTextField(bucket, { bucket = it }, Modifier.fillMaxWidth().keepVisible(), label = { Text("Bucket") }, singleLine = true)
                OutlinedTextField(keyId, { keyId = it }, Modifier.fillMaxWidth().keepVisible(), label = { Text("Access key ID") }, singleLine = true)
                OutlinedTextField(secret, { secret = it }, Modifier.fillMaxWidth().keepVisible(), label = { Text("Secret access key") }, singleLine = true, visualTransformation = PasswordVisualTransformation())
            }
            OutlinedTextField(root, { root = it }, Modifier.fillMaxWidth().keepVisible(), label = { Text("Folder on the server") }, singleLine = true)
            OutlinedTextField(passphrase, { passphrase = it }, Modifier.fillMaxWidth().keepVisible(), label = { Text("Passphrase") }, singleLine = true, visualTransformation = PasswordVisualTransformation())
            val ready = !busy && passphrase.isNotBlank() && url.isNotBlank() && (if (kind == "s3") bucket.isNotBlank() && keyId.isNotBlank() && secret.isNotBlank() else user.isNotBlank() && pass.isNotBlank())
            Button(onClick = {
                val cfg = LibrarySync.Config(kind, url.trim(), user.trim(), pass, root.trim().ifEmpty { "aish-sync" }, region.trim().ifEmpty { "us-east-1" }, bucket.trim(), keyId.trim(), secret)
                join(cfg, passphrase)
            }, Modifier.fillMaxWidth(), enabled = ready) { Text(if (busy) "Joining…" else "Join library") }
        }
    } else {
        val received = lib.records.keys("article:").size
        val notes = lib.records.keys("note:").size
        InfoCard("Joined · ${lib.config()?.label().orEmpty()}",
            (if (lib.lastSyncAt() > 0) "Last synced ${relativeTime(lib.lastSyncAt())}." else "Not synced yet.") + " $received article(s) and $notes note(s) received.") {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { run { summary(lib.syncNow()) } }, Modifier.fillMaxWidth(), enabled = !busy) { Text(if (busy) "Syncing…" else "Sync now") }
                if (lib.passphrase() != null) OutlinedButton(onClick = { shown = if (shown == null) lib.passphrase() else null }, Modifier.fillMaxWidth()) { Text(if (shown == null) "Show passphrase" else "Hide passphrase") }
                shown?.let { Text(it, style = MaterialTheme.typography.titleMedium) }
                TextButton(onClick = { scheduleLibrarySync(context, false); lib.disconnect(); shown = null; message = "Disconnected. What was received stays on this phone."; failed = false; tick++ }) { Text("Disconnect this phone") }
            }
        }
        lib.lastError()?.let { InfoCard("Last problem", it, isError = true) }
    }
    message?.let { InfoCard(if (failed) "Could not finish" else "Library sync", it, isError = failed) }
}

/** When this field gets focus, scroll it into view once the keyboard is up (it would otherwise sit under it, low on the screen). */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun Modifier.keepVisible(): Modifier {
    val requester = remember { androidx.compose.foundation.relocation.BringIntoViewRequester() }
    val scope = rememberCoroutineScope()
    return this.bringIntoViewRequester(requester).onFocusEvent { if (it.isFocused) scope.launch { kotlinx.coroutines.delay(350); requester.bringIntoView() } }
}
