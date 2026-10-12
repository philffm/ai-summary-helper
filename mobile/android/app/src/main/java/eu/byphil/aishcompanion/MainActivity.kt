package eu.byphil.aishcompanion

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.format.DateUtils
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import kotlinx.coroutines.launch

/**
 * Pair once (scan the code from the extension's Settings → Phone inbox). Then share links to AISH, and read the articles
 * you send from the browser ("Send to phone") in the reading list.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()   // content is drawn under the system bars; every screen pads itself with safeDrawingPadding()
        val store = Store(this)
        val articles = ArticleStore(this)
        if (store.pairing?.canReceive == true) ReceiveWorker.schedule(this)
        setContent {
            AishTheme {
                Surface(Modifier.fillMaxSize()) {
                    App(store, articles, onScan = { onResult -> scan(onResult) }, onOpenUrl = { openUrl(it) })
                }
            }
        }
    }

    private fun scan(onResult: (String?) -> Unit) {
        val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        GmsBarcodeScanning.getClient(this, options).startScan()
            .addOnSuccessListener { onResult(it.rawValue) }
            .addOnFailureListener { onResult(null) }
    }

    /** Only web links reach here (the article codec rejects anything else). */
    private fun openUrl(url: String) {
        if (url.startsWith("https://") || url.startsWith("http://")) startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    }
}

private sealed interface Route {
    data object Home : Route
    data object Articles : Route
    data class Read(val id: String) : Route
}

@Composable
private fun App(store: Store, articles: ArticleStore, onScan: ((String?) -> Unit) -> Unit, onOpenUrl: (String) -> Unit) {
    var route by remember { mutableStateOf<Route>(Route.Home) }
    BackHandler(enabled = route != Route.Home) { route = if (route is Route.Read) Route.Articles else Route.Home }
    when (val r = route) {
        Route.Home -> HomeScreen(store, articles, onScan, onOpenList = { route = Route.Articles })
        Route.Articles -> ListScreen(articles, onBack = { route = Route.Home }, onOpen = { route = Route.Read(it) })
        is Route.Read -> ReaderScreen(articles, r.id, onBack = { route = Route.Articles }, onOpenUrl = onOpenUrl)
    }
}

@Composable
private fun HomeScreen(store: Store, articles: ArticleStore, onScan: ((String?) -> Unit) -> Unit, onOpenList: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var pairing by remember { mutableStateOf(store.pairing) }
    var error by remember { mutableStateOf<String?>(null) }
    var pasted by remember { mutableStateOf("") }
    var showPaste by remember { mutableStateOf(false) }
    var checking by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    var count by remember { mutableStateOf(articles.list().size) }

    fun accept(text: String?) {
        val p = text?.let { Pairing.parse(it) }
        if (p == null) { error = "That is not an AISH pairing code."; return }
        store.pairing = p; store.lastError = null; pairing = p; error = null; pasted = ""; showPaste = false
        if (p.canReceive) ReceiveWorker.schedule(context) else ReceiveWorker.cancel(context)
    }

    Box(Modifier.fillMaxSize().safeDrawingPadding(), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = 520.dp).fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Header()
            val p = pairing
            if (p == null) {
                Steps(
                    "Set up once",
                    listOf(
                        "In the browser extension open Settings → Phone inbox and tap Pair a phone.",
                        "Tap Scan pairing code below and scan the QR code on your screen.",
                        "Then share any link to AISH from any app.",
                    ),
                )
                Button(onClick = { onScan { accept(it) } }, Modifier.fillMaxWidth()) { Text("Scan pairing code") }
                if (showPaste) {
                    OutlinedTextField(pasted, { pasted = it }, Modifier.fillMaxWidth(), label = { Text("Pairing code") }, singleLine = true)
                    Button(onClick = { accept(pasted) }, Modifier.fillMaxWidth(), enabled = pasted.isNotBlank()) { Text("Pair") }
                } else {
                    TextButton(onClick = { showPaste = true }) { Text("Paste the code instead") }
                }
            } else {
                StatusCard("Paired", "This phone can send links to your browser.")
                if (p.canReceive) {
                    StatusCard(
                        "Reading list",
                        if (count == 0) "Nothing yet. In the extension open ⋯ on an article and choose Send to phone."
                        else "$count article" + (if (count == 1) "" else "s") + " from your browser, saved on this phone.",
                    )
                    Button(onClick = onOpenList, Modifier.fillMaxWidth(), enabled = count > 0) { Text("Open reading list") }
                    OutlinedButton(
                        onClick = {
                            scope.launch {
                                checking = true; note = null
                                val out = Receiver.run(context)
                                checking = false
                                count = articles.list().size
                                note = when (out.error) {
                                    null -> if (out.added == 0) "Nothing new." else "${out.added} new."
                                    "unreachable" -> "The server is not reachable."
                                    "pairing-invalid" -> "The pairing is no longer valid. Scan the code again."
                                    else -> "Could not check right now."
                                }
                            }
                        },
                        Modifier.fillMaxWidth(), enabled = !checking,
                    ) { Text(if (checking) "Checking…" else "Check now") }
                    note?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                } else {
                    StatusCard("Send to phone is off", "To read articles from your browser here: in the extension open Settings → Phone inbox, tap Switch on Send to phone, then scan the new code.")
                    Button(onClick = { onScan { accept(it) } }, Modifier.fillMaxWidth()) { Text("Scan the new code") }
                }
                Steps(
                    "How to use",
                    listOf(
                        "In any app tap Share and choose AISH: the link goes to your browser, end-to-end encrypted.",
                        "In the browser open History → From phone and tap Summarize.",
                        "To read on the go, choose ⋯ → Send to phone on an article in the extension.",
                    ),
                )
                store.lastError?.let { StatusCard("Last problem", it, isError = true) }
                TextButton(onClick = {
                    store.pairing = null; pairing = null; ReceiveWorker.cancel(context)
                }) { Text("Unpair this phone") }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center) }
        }
    }
}

@Composable
private fun ListScreen(articles: ArticleStore, onBack: () -> Unit, onOpen: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf(articles.list()) }
    var checking by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxSize().safeDrawingPadding(), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 640.dp).fillMaxSize().padding(horizontal = 16.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(onClick = onBack) { Text("‹ Back") }
                TextButton(
                    onClick = { scope.launch { checking = true; Receiver.run(context); checking = false; list = articles.list() } },
                    enabled = !checking,
                ) { Text(if (checking) "Checking…" else "Check now") }
            }
            Text("Reading list", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp))
            if (list.isEmpty()) {
                Text(
                    "Nothing here yet. In the extension choose ⋯ → Send to phone on an article; it arrives within about 15 minutes, or tap Check now.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(8.dp),
                )
            }
            LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 12.dp)) {
                items(list, key = { it.id }) { a ->
                    val unread = !articles.isRead(a.id)
                    Card(onClick = { onOpen(a.id) }, modifier = Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (unread) Box(Modifier.size(8.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary))
                                Text(
                                    listOf(a.site, DateUtils.getRelativeTimeSpanString(a.receivedAt, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS).toString()).filter { it.isNotBlank() }.joinToString(" · "),
                                    style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Text(a.title, style = MaterialTheme.typography.titleMedium, fontWeight = if (unread) FontWeight.Bold else FontWeight.Normal)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ReaderScreen(articles: ArticleStore, id: String, onBack: () -> Unit, onOpenUrl: (String) -> Unit) {
    val article = remember(id) { articles.load(id) }
    LaunchedEffect(id) { articles.markRead(id) }
    Box(Modifier.fillMaxSize().safeDrawingPadding(), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 640.dp).fillMaxSize().padding(horizontal = 20.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                TextButton(onClick = onBack) { Text("‹ Reading list") }
                if (article != null) TextButton(onClick = { onOpenUrl(article.url) }) { Text("Open original") }
            }
            if (article == null) {
                Text("This article could not be opened.", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(8.dp))
                return@Column
            }
            LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 32.dp)) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(article.title.ifBlank { article.url }, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                        val meta = listOf(article.byline, article.site).filter { it.isNotBlank() }.joinToString(" · ")
                        if (meta.isNotEmpty()) Text(meta, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (article.summary.isNotBlank()) item {
                    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("AISH summary", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                            Text(article.summary, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
                items(article.blocks) { b -> BlockView(b) }
                if (article.truncated) item {
                    Text("This long article was shortened to fit. Open the original to read the rest.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(top = 8.dp)) {
                        OutlinedButton(onClick = { onOpenUrl(article.url) }) { Text("Open original") }
                        TextButton(onClick = { articles.delete(id); onBack() }) { Text("Delete from this phone") }
                    }
                }
            }
        }
    }
}

@Composable
private fun BlockView(b: Block) {
    when (b.type) {
        "h1" -> Text(b.text, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp))
        "h2" -> Text(b.text, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 10.dp))
        "h3" -> Text(b.text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 6.dp))
        "li" -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("•", style = MaterialTheme.typography.bodyLarge)
            Text(b.text, style = MaterialTheme.typography.bodyLarge, lineHeight = 26.sp, modifier = Modifier.weight(1f))
        }
        "q" -> Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.width(3.dp).fillMaxHeight().background(MaterialTheme.colorScheme.primary))
            Text(b.text, style = MaterialTheme.typography.bodyLarge, fontStyle = FontStyle.Italic, lineHeight = 26.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        "pre" -> Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(8.dp)) {
            Text(b.text, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall, modifier = Modifier.horizontalScroll(rememberScrollState()).padding(12.dp))
        }
        else -> Text(b.text, style = MaterialTheme.typography.bodyLarge, lineHeight = 26.sp)
    }
}

@Composable
private fun Header() {
    Column(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.size(112.dp).clip(CircleShape)) {
            Image(painterResource(R.drawable.ic_launcher_background), contentDescription = null, modifier = Modifier.fillMaxSize())
            Image(painterResource(R.drawable.ic_launcher_foreground), contentDescription = null, modifier = Modifier.fillMaxSize())
        }
        Text("AISH Companion", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Text(
            "Send links from your phone to AI Summary Helper in your browser.",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun StatusCard(title: String, body: String, isError: Boolean = false) {
    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = if (isError) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.primaryContainer),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(body, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun Steps(title: String, steps: List<String>) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            steps.forEachIndexed { i, text ->
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                    Surface(color = MaterialTheme.colorScheme.primary, shape = CircleShape, modifier = Modifier.size(24.dp)) {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text("${i + 1}", color = MaterialTheme.colorScheme.onPrimary, style = MaterialTheme.typography.labelMedium)
                        }
                    }
                    Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                }
            }
        }
    }
}
