package eu.byphil.aishcompanion

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
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
fun WebScreen(url: String, onClose: () -> Unit) {
    val context = LocalContext.current
    var progress by remember { mutableFloatStateOf(0f) }
    var title by remember { mutableStateOf("") }
    var shown by remember { mutableStateOf(url) }
    var canGoBack by remember { mutableStateOf(false) }
    var web by remember { mutableStateOf<WebView?>(null) }

    BackHandler { if (canGoBack) web?.goBack() else onClose() }

    Column(Modifier.fillMaxSize().navigationBarsPadding()) {
        TopAppBar(
            title = { Text(title.ifBlank { Uri.parse(shown).host ?: shown }, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            navigationIcon = { IconButton(onClick = onClose) { Icon(Icons.Filled.Close, contentDescription = "Close") } },
            actions = { IconButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(shown))) }) { Icon(Icons.Filled.OpenInBrowser, contentDescription = "Open in browser") } },
        )
        if (progress in 0.01f..0.99f) LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth())
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                WebView(ctx).apply {
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
                        override fun onPageFinished(view: WebView, u: String) { shown = u; canGoBack = view.canGoBack() }
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
