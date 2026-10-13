package eu.byphil.aishcompanion

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.RssFeed
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.foundation.layout.Spacer
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

/**
 * AI Summary Helper (AISH) on the phone: Feeds, Reading list and Settings, like the extension's Feeds · Summarize · History bar. Pair once (scan the
 * code from the extension), then read feeds (kept in step through the encrypted feed sync), read articles sent from the browser,
 * and share links to the browser. The layout follows the window width, so it also fits foldables: the Fold's inner screen shows
 * a side rail and list + detail side by side. The activity handles size changes itself (see the manifest), so folding and
 * unfolding keeps the open article and the scroll position.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()   // content is drawn under the system bars; the screens pad themselves
        CrashLog.install(this)
        val crash = CrashLog.read(this)
        val pending = Guard.pending(this)
        if (crash != null || pending.isNotEmpty()) {
            // The last run crashed or died in the middle of a step: show why instead of risking the same crash again.
            val report = (crash ?: "") + (if (pending.isEmpty()) "" else "\nThe app closed while: " + pending.joinToString(", ") { Guard.describe(it) })
            setContent {
                AishTheme {
                    CrashScreen(
                        report.trim(),
                        onSafeStart = {
                            Store(this).let { it.alarm = it.alarm.copy(enabled = false, useAi = false) }
                            runCatching { AlarmScheduler.reschedule(this) }
                            CrashLog.clear(this); Guard.clear(this); recreate()
                        },
                        onOpenAnyway = { CrashLog.clear(this); Guard.clear(this); recreate() },
                    )
                }
            }
            return
        }
        Guard.begin(this, "start")   // cleared once the first screen has been drawn
        val model = AppModel(this)
        appModel = model
        intent?.getStringExtra(EXTRA_OPEN_ARTICLE)?.let { model.openArticle = it }
        if (model.pairing?.canReceive == true) ReceiveWorker.schedule(this)
        FeedWorker.schedule(this)
        runCatching { AlarmScheduler.reschedule(this) }   // keeps the alarm right after updates, restarts and clock changes
        setContent {
            AishTheme(highContrast = model.highContrast, reduceMotion = model.reduceMotion) {
                Surface(Modifier.fillMaxSize()) {
                    App(model, onScan = { onResult -> scan(onResult) }, onReady = { Guard.end(this, "start") },
                        startUrl = intent?.getStringExtra(EXTRA_OPEN_URL).orEmpty(), startSummarize = intent?.getBooleanExtra(EXTRA_SUMMARIZE, false) == true)
                }
            }
        }
    }

    companion object {
        /** From the share sheet: open this page in the app, and with [EXTRA_SUMMARIZE] start the on-device summary once it has loaded. */
        const val EXTRA_OPEN_URL = "eu.byphil.aishcompanion.OPEN_URL"
        const val EXTRA_SUMMARIZE = "eu.byphil.aishcompanion.SUMMARIZE"
        /** From a reminder notification: open this reading-list article. */
        const val EXTRA_OPEN_ARTICLE = "eu.byphil.aishcompanion.OPEN_ARTICLE"
    }

    private var appModel: AppModel? = null

    /** A reminder tapped while the app is already open (singleTop). */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.getStringExtra(EXTRA_OPEN_ARTICLE)?.let { appModel?.openArticle = it }
    }

    private fun scan(onResult: (String?) -> Unit) {
        val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        GmsBarcodeScanning.getClient(this, options).startScan()
            .addOnSuccessListener { onResult(it.rawValue) }
            .addOnFailureListener { onResult(null) }
    }
}

private enum class Tab(val label: String, val icon: ImageVector) {
    Feeds("Feeds", Icons.Filled.RssFeed),
    Reading("Reading", Icons.AutoMirrored.Filled.MenuBook),
    Settings("Settings", Icons.Filled.Settings),
}

@Composable
private fun App(model: AppModel, onScan: ((String?) -> Unit) -> Unit, onReady: () -> Unit, startUrl: String = "", startSummarize: Boolean = false) {
    androidx.compose.runtime.LaunchedEffect(Unit) { onReady() }
    // All of this is saved, so it also survives the system restarting the activity; it is not touched by folding or unfolding.
    var tab by rememberSaveable { mutableIntStateOf(Tab.Feeds.ordinal) }
    var feedSource by rememberSaveable { mutableStateOf("all") }
    var feedSel by rememberSaveable { mutableStateOf("") }
    var articleSel by rememberSaveable { mutableStateOf("") }
    var settingsPanel by rememberSaveable { mutableStateOf("") }
    var webUrl by rememberSaveable { mutableStateOf(startUrl) }
    var autoSummarize by rememberSaveable { mutableStateOf(startSummarize) }

    if (webUrl.isNotEmpty()) { WebScreen(webUrl, canSend = model.pairing != null, autoSummarize = autoSummarize, onSummarized = { u, page, text, marks -> model.saveSummary(u, page, text, marks) }, onOpenReading = { id -> articleSel = id; tab = Tab.Reading.ordinal; webUrl = ""; autoSummarize = false }) { webUrl = ""; autoSummarize = false }; return }

    androidx.compose.runtime.LaunchedEffect(tab) { if (tab != Tab.Settings.ordinal) settingsPanel = "" }
    // A reminder was tapped: show that article in the reading list.
    androidx.compose.runtime.LaunchedEffect(model.openArticle) {
        if (model.openArticle.isNotEmpty()) { webUrl = ""; tab = Tab.Reading.ordinal; articleSel = model.openArticle; model.openArticle = "" }
    }
    val wide = isWide()
    val feedUnread = model.entries.count { !it.stored.read }
    val readingUnread = model.articleList.count { !model.articles.isRead(it.id) }
    val badge = mapOf(Tab.Feeds to feedUnread, Tab.Reading to readingUnread, Tab.Settings to 0)

    @Composable
    fun TabIcon(t: Tab) {
        val n = badge[t] ?: 0
        if (n > 0) BadgedBox(badge = { Badge { Text(if (n > 99) "99+" else "$n") } }) { Icon(t.icon, contentDescription = t.label) }
        else Icon(t.icon, contentDescription = t.label)
    }

    Scaffold(
        contentWindowInsets = if (wide) WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom) else WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal),
        bottomBar = {
            if (!wide) NavigationBar {
                Tab.entries.forEach { t -> NavigationBarItem(selected = tab == t.ordinal, onClick = { tab = t.ordinal }, icon = { TabIcon(t) }, label = { Text(t.label) }) }
            }
        },
    ) { padding ->
        Row(Modifier.padding(padding).fillMaxSize()) {
            if (wide) NavigationRail {
                // The items sit in the vertical middle of the rail, not at the top: equal spacers above and below.
                Spacer(Modifier.weight(1f))
                Tab.entries.forEach { t -> NavigationRailItem(selected = tab == t.ordinal, onClick = { tab = t.ordinal }, icon = { TabIcon(t) }, label = { Text(t.label) }) }
                Spacer(Modifier.weight(1f))
            }
            androidx.compose.foundation.layout.Column(Modifier.weight(1f).fillMaxSize()) {
                Box(Modifier.weight(1f).fillMaxSize()) {
                    when (Tab.entries[tab]) {
                        Tab.Feeds -> FeedsScreen(model, feedSource, { feedSource = it }, feedSel, { feedSel = it }, onOpenWeb = { webUrl = it }, onOpenSettings = { settingsPanel = it; tab = Tab.Settings.ordinal })
                        Tab.Reading -> ReadingScreen(model, articleSel, { articleSel = it }, onOpenWeb = { webUrl = it })
                        Tab.Settings -> SettingsScreen(model, onScan, startPanel = settingsPanel)
                    }
                }
                MiniPlayer()
            }
        }
    }
}
