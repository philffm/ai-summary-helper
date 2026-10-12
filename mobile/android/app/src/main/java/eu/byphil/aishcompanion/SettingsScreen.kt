package eu.byphil.aishcompanion

import androidx.compose.foundation.Image
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** Pairing, feed sync, sending articles: everything that has to do with the link to the browser extension. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(model: AppModel, onScan: ((String?) -> Unit) -> Unit) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var error by remember { mutableStateOf<String?>(null) }
    var pasted by remember { mutableStateOf("") }
    var showPaste by remember { mutableStateOf(false) }
    val p = model.pairing

    LaunchedEffect(model.message) { model.message?.let { snackbar.showSnackbar(it); model.consumeMessage() } }

    fun accept(text: String?) {
        val parsed = text?.let { Pairing.parse(it) }
        if (parsed == null) { error = "That is not an AISH pairing code."; return }
        model.applyPairing(parsed); error = null; pasted = ""; showPaste = false
        if (parsed.canSync) scope.launch { model.syncFeeds() }
    }

    var panel by rememberSaveable { mutableStateOf<String?>(null) }
    var query by rememberSaveable { mutableStateOf("") }
    BackHandler(enabled = panel != null) { panel = null }

    val rows = listOf(
        SettingsRow("link", "ACCOUNT", "🔗", "Browser link", if (p == null) "Not paired" else listOf("Paired", if (p.canSync) "feed sync" else "", if (p.canReceive) "send to phone" else "").filter { it.isNotEmpty() }.joinToString(" · "), "pair pairing qr scan sync send to phone unpair extension browser"),
        SettingsRow("ai", "SUMMARIZING", "🤖", "On-device AI", "Model · summary language · highlights · read aloud", "model gemma download language ghost highlight key passages read aloud tts speak summary"),
        SettingsRow("feeds", "FEEDS", "📰", "Feed preferences", if (model.groupSimilar) "Grouping similar items" else "Not grouping", "group similar stories stacks refresh"),
        SettingsRow("access", "APP", "♿", "Accessibility", if (model.leftHanded) "Left-handed layout" else "Right-handed layout", "left handed right hand thumb reach text size font large accessibility"),
        SettingsRow("alarm", "APP", "⏰", "Morning alarm", "Wake up to your briefing", "alarm morning briefing wake clock"),
        SettingsRow("pro", "APP", "⭐", "Pro", "Extras", "pro license extras"),
    )
    val title = rows.firstOrNull { it.id == panel }?.title ?: "Settings"

    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = { if (panel != null) IconButton(onClick = { panel = null }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
            )
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize(), contentAlignment = Alignment.TopCenter) {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Column(Modifier.widthLimit(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    when (panel) {
                        null -> {
                            OutlinedTextField(
                                query, { query = it }, Modifier.fillMaxWidth(), singleLine = true, placeholder = { Text("Search settings…") },
                                leadingIcon = { Icon(Icons.Filled.Search, null) }, shape = RoundedCornerShape(28.dp),
                                trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(Icons.Filled.Close, contentDescription = "Clear") } },
                            )
                            val q = query.trim().lowercase()
                            val shown = if (q.isEmpty()) rows else rows.filter { (it.title + " " + it.sub + " " + it.keywords).lowercase().let { t -> q.split(" ").all { w -> w in t } } }
                            if (q.isNotEmpty() && shown.isEmpty()) Text("Nothing matches that.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(8.dp))
                            var last = ""
                            for (r in shown) {
                                if (q.isEmpty() && r.group != last) { SettingsCaption(r.group); last = r.group }
                                NavRow(r) { panel = r.id }
                            }
                        }
                        "link" -> {
                    if (p == null) {
                        Header()
                        Steps("Set up once", listOf(
                            "In the browser extension open Settings → Phone inbox and tap Pair a phone.",
                            "Tap Scan pairing code below and scan the QR code on your screen.",
                            "Then share links to AISH, read feeds, and read articles you send from the browser.",
                        ))
                        Button(onClick = { onScan { accept(it) } }, Modifier.fillMaxWidth()) { Text("Scan pairing code") }
                        if (showPaste) {
                            OutlinedTextField(pasted, { pasted = it }, Modifier.fillMaxWidth(), label = { Text("Pairing code") }, singleLine = true)
                            Button(onClick = { accept(pasted) }, Modifier.fillMaxWidth(), enabled = pasted.isNotBlank()) { Text("Pair") }
                        } else TextButton(onClick = { showPaste = true }) { Text("Paste the code instead") }
                    } else {
                        InfoCard("Paired", "This phone can send links to your browser.")
                        if (p.canSync) {
                            InfoCard("Feed sync is on", "Your feed list (not the articles) syncs end-to-end encrypted with the browser. " +
                                (if (model.lastSyncAt > 0) "Last synced ${relativeTime(model.lastSyncAt)}." else "Not synced yet.")) {
                                OutlinedButton(onClick = { scope.launch { model.syncFeeds() } }, enabled = !model.syncing) { Text(if (model.syncing) "Syncing…" else "Sync now") }
                            }
                        } else {
                            InfoCard("Feed sync is off", "To keep your feeds in step with the browser: in the extension open Settings → Phone inbox, tap Switch on feed sync, then scan the new code.") {
                                Button(onClick = { onScan { accept(it) } }) { Text("Scan the new code") }
                            }
                        }
                        if (p.canReceive) {
                            InfoCard("Send to phone is on", "${model.articleList.size} article" + (if (model.articleList.size == 1) "" else "s") + " saved on this phone. They arrive within about 15 minutes.") {
                                OutlinedButton(onClick = { scope.launch { model.message = model.checkArticles() } }, enabled = !model.checking) { Text(if (model.checking) "Checking…" else "Check now") }
                            }
                        } else {
                            InfoCard("Send to phone is off", "To read articles from your browser here: in the extension open Settings → Phone inbox, tap Switch on Send to phone, then scan the new code.") {
                                Button(onClick = { onScan { accept(it) } }) { Text("Scan the new code") }
                            }
                        }
                        Steps("How to use", listOf(
                            "In any app tap Share and choose AISH: the link goes to your browser, end-to-end encrypted.",
                            "In the browser open History → From phone and tap Summarize.",
                            "To read on the go, choose ⋯ → Send to phone on an article in the extension.",
                            "In Feeds, open an item and tap To browser to send it to the extension.",
                        ))
                        model.store.lastError?.let { InfoCard("Last problem", it, isError = true) }
                        TextButton(onClick = { model.applyPairing(null) }) { Text("Unpair this phone") }
                    }
                        }
                        "ai" -> { ModelCard(model); SummaryCard(model) }
                        "feeds" -> FeedsCard(model)
                        "access" -> AccessibilityCard(model)
                        "alarm" -> AlarmCard(model)
                        "pro" -> ExtrasCard(model)
                    }
                    error?.let { Text(it, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center) }
                }
            }
        }
    }
}

private class SettingsRow(val id: String, val group: String, val emoji: String, val title: String, val sub: String, val keywords: String)

/** One row of the settings home, as in the extension: emoji, title with a live subtitle, chevron. */
@Composable
private fun NavRow(r: SettingsRow, onClick: () -> Unit) {
    SettingsCard {
        Row(Modifier.clickable(onClick = onClick).padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(r.emoji, style = MaterialTheme.typography.titleLarge)
            Column(Modifier.weight(1f)) {
                Text(r.title, style = MaterialTheme.typography.titleMedium)
                Text(r.sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private fun Modifier.widthLimit(): Modifier = this.fillMaxWidth().widthIn(max = 560.dp)

@Composable
private fun Header() {
    Column(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.size(96.dp).clip(CircleShape)) {
            Image(painterResource(R.drawable.ic_launcher_background), contentDescription = null, modifier = Modifier.fillMaxSize())
            Image(painterResource(R.drawable.ic_launcher_foreground), contentDescription = null, modifier = Modifier.fillMaxSize())
        }
        Text("AI Summary Helper", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Text("Your feeds, your reading list and your links, in step with AI Summary Helper in the browser.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
    }
}

@Composable
private fun Steps(title: String, steps: List<String>) {
    SettingsCard {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            steps.forEachIndexed { i, text ->
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                    Surface(color = MaterialTheme.colorScheme.primary, shape = CircleShape, modifier = Modifier.size(24.dp)) {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("${i + 1}", color = MaterialTheme.colorScheme.onPrimary, style = MaterialTheme.typography.labelMedium) }
                    }
                    Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String) = SettingsCaption(text)
