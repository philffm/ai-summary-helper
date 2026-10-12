package eu.byphil.aishcompanion

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.speech.tts.TextToSpeech
import androidx.compose.material.icons.filled.VolumeOff
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.runtime.DisposableEffect
import java.util.Locale
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.FilledTonalButton
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.OpenInBrowser
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.viewinterop.AndroidView

/**
 * A page inside the app: a progress bar, back through the page's own history, and a button that hands the page to the browser.
 * Web links only; other schemes (mailto:, intent:) go to the app that handles them. No file access, no app-to-page bridge.
 */
@OptIn(ExperimentalMaterial3Api::class)
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebScreen(url: String, canSend: Boolean = false, autoSummarize: Boolean = false, onSummarized: suspend (String, Page, String, List<String>) -> Unit = { _, _, _, _ -> }, onClose: () -> Unit) {
    val context = LocalContext.current
    var progress by remember { mutableFloatStateOf(0f) }
    var title by remember { mutableStateOf("") }
    var shown by remember { mutableStateOf(url) }
    var canGoBack by remember { mutableStateOf(false) }
    var web by remember { mutableStateOf<WebView?>(null) }
    var summary by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf("") }      // progress or error text while/after summarizing
    var busy by remember { mutableStateOf(false) }
    var sent by remember { mutableStateOf(false) }
    var saved by remember { mutableStateOf(false) }
    var autoPending by rememberSaveable { mutableStateOf(autoSummarize) }   // from the share sheet: summarize once the page has loaded
    var summaryTitle by remember { mutableStateOf("") }
    var summaryUrl by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    var speak by remember { mutableStateOf(Store(context).speakSummary) }   // read the summary aloud while it is written
    var tts by remember { mutableStateOf<TextToSpeech?>(null) }
    val spoken = remember { intArrayOf(0) }                                  // how much of the streamed text has been handed to the voice
    DisposableEffect(Unit) {
        val engine = TextToSpeech(context.applicationContext) { }
        tts = engine
        onDispose { engine.stop(); engine.shutdown() }
    }
    val speakNew: (String, Boolean) -> Unit = { text, last ->
        val engine = tts
        if (speak && engine != null) {
            val (sentences, upTo) = SpeechChunker.next(text, spoken[0], last)
            spoken[0] = upTo
            for (sentence in sentences) engine.speak(sentence, TextToSpeech.QUEUE_ADD, null, "sum-" + System.nanoTime())
        }
    }

    fun summarize() {
        val view = web ?: return
        if (busy) return
        if (!LocalLlm.installed(context)) { status = "Download the on-device model in Settings first."; return }
        val pageUrl = shown
        busy = true; status = "Reading the page…"; summary = null; saved = false
        tts?.stop(); spoken[0] = 0
        view.evaluateJavascript(PageExtract.SCRIPT) { raw ->
            val page = PageExtract.parse(raw)
            if (page == null || !PageSummary.enough(page)) { status = "This page has no readable text to summarize."; busy = false; return@evaluateJavascript }
            scope.launch {
                tts?.language = Locale.forLanguageTag(Store(context).summaryLang.ifBlank { page.lang.ifBlank { Locale.getDefault().toLanguageTag() } })
                var streamed = ""
                val result = withContext(Dispatchers.Default) {
                    PageSummary.summarize(context, page, progress = { i, n -> status = if (n > 1) "Summarizing… $i/$n" else "Summarizing…" },
                        onText = { t -> streamed = t; summary = t; speakNew(t, false) })   // the summary grows on screen and is read sentence by sentence
                }
                summary = result?.text
                if (result != null) speakNew(streamed.ifBlank { result.text }, true)
                if (result != null) {
                    summaryTitle = page.title.ifBlank { Uri.parse(pageUrl).host ?: pageUrl }; summaryUrl = pageUrl
                    saved = runCatching { onSummarized(pageUrl, page, result.text, result.passages) }.isSuccess   // into the reading list, marked "on this phone"
                }
                status = if (result == null) "The model could not summarize this page." else ""
                busy = false
            }
        }
    }

    BackHandler { if (canGoBack) web?.goBack() else onClose() }

    Column(Modifier.fillMaxSize().navigationBarsPadding()) {
        TopAppBar(
            title = { Text(title.ifBlank { Uri.parse(shown).host ?: shown }, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            navigationIcon = { IconButton(onClick = onClose) { Icon(Icons.Filled.Close, contentDescription = "Close") } },
            actions = {
                IconButton(onClick = { speak = !speak; Store(context).speakSummary = speak; if (!speak) tts?.stop() }) {
                    Icon(if (speak) Icons.Filled.VolumeUp else Icons.Filled.VolumeOff, contentDescription = if (speak) "Reading summaries aloud: on" else "Reading summaries aloud: off")
                }
                IconButton(onClick = { summarize() }, enabled = !busy) { Icon(Icons.Filled.AutoAwesome, contentDescription = "Summarize on this phone") }
                if (canSend) IconButton(onClick = { SendWorker.enqueue(context, shown); sent = true }) {
                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = if (sent) "Sent to the browser" else "Send to the AISH browser extension", tint = if (sent) MaterialTheme.colorScheme.primary else LocalContentColor.current)
                }
                IconButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(shown))) }) { Icon(Icons.Filled.OpenInBrowser, contentDescription = "Open in browser") }
            },
        )
        if (progress in 0.01f..0.99f) LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth())
        if (busy || status.isNotEmpty()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                Text(status, Modifier.padding(start = if (busy) 12.dp else 0.dp), style = MaterialTheme.typography.bodySmall)
            }
        }
        summary?.takeIf { it.isNotBlank() }?.let { text ->
            Surface(tonalElevation = 2.dp, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Summary (on this phone)", style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
                        IconButton(onClick = { summary = null; tts?.stop() }) { Icon(Icons.Filled.Close, contentDescription = "Hide summary") }
                    }
                    Text(text, Modifier.heightIn(max = 240.dp).verticalScroll(rememberScrollState()), style = MaterialTheme.typography.bodyMedium)
                    Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilledTonalButton(onClick = { shareText(context, summaryTitle, PageSummary.shareText(summaryTitle, text, summaryUrl)) }) {
                            Icon(Icons.Filled.Share, null, Modifier.size(18.dp)); Text("  Share")
                        }
                        if (saved) Text("Saved to reading list", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        AndroidView(
            modifier = Modifier.weight(1f).fillMaxWidth(),   // the page gets exactly the space left under the bars and panels
            factory = { ctx ->
                WebView(ctx).apply {
                    layoutParams = android.view.ViewGroup.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.MATCH_PARENT)
                    isVerticalScrollBarEnabled = true
                    overScrollMode = android.view.View.OVER_SCROLL_IF_CONTENT_SCROLLS
                    // the page scrolls itself: nothing around it may take the vertical drag away
                    setOnTouchListener { v, _ -> v.parent?.requestDisallowInterceptTouchEvent(true); false }
                    settings.useWideViewPort = true
                    settings.loadWithOverviewMode = true
                    settings.setSupportZoom(true)
                    settings.builtInZoomControls = true
                    settings.displayZoomControls = false
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.allowFileAccess = false
                    settings.allowContentAccess = false
                    settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                    settings.setSupportMultipleWindows(false)
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                            val u = request.url
                            if (u.scheme == "https" || u.scheme == "http") return false
                            try { ctx.startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (_: Exception) { /* no app for it */ }
                            return true
                        }
                        override fun onPageStarted(view: WebView, u: String, favicon: Bitmap?) { shown = u; canGoBack = view.canGoBack() }
                        override fun onPageFinished(view: WebView, u: String) {
                            shown = u; canGoBack = view.canGoBack()
                            if (autoPending) { autoPending = false; view.postDelayed({ summarize() }, 800) }   // a moment for scripts to fill the page
                        }
                    }
                    webChromeClient = object : WebChromeClient() {
                        override fun onProgressChanged(view: WebView, newProgress: Int) { progress = newProgress / 100f }
                        override fun onReceivedTitle(view: WebView, t: String?) { title = t ?: "" }
                    }
                    web = this
                    loadUrl(url)
                }
            },
            onRelease = { it.stopLoading(); it.destroy(); web = null },
        )
    }
}
