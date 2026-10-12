package eu.byphil.aishcompanion

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Share
import androidx.compose.ui.platform.LocalContext
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** The reading list: articles sent from the browser (Send to phone). Two panes on wide screens. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReadingScreen(model: AppModel, selected: String, onSelect: (String) -> Unit, onOpenWeb: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val canReceive = model.pairing?.canReceive == true
    val current = model.articleList.firstOrNull { it.id == selected }

    LaunchedEffect(Unit) { model.reload() }

    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text("Reading list") },
                navigationIcon = { if (!isWide() && current != null) IconButton(onClick = { onSelect("") }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
                actions = {
                    if (canReceive) IconButton(onClick = { scope.launch { snackbar.showSnackbar(model.checkArticles()) } }, enabled = !model.checking) { Icon(Icons.Filled.Refresh, contentDescription = "Check for new articles") }
                },
            )
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            ListDetail(
                hasSelection = current != null,
                onBackToList = { onSelect("") },
                list = {
                    if (model.articleList.isEmpty()) {
                        EmptyState(
                            "Nothing to read yet",
                            if (canReceive) "In the browser extension open ⋯ → Send to phone on an article. It arrives within about 15 minutes, or tap refresh."
                            else "Switch on Send to phone in the extension (Settings → Phone inbox), then scan the new code in Settings here.",
                        )
                    } else {
                        PullToRefreshBox(isRefreshing = model.checking, onRefresh = { scope.launch { snackbar.showSnackbar(model.checkArticles()) } }, modifier = Modifier.fillMaxSize()) {
                            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                items(model.articleList, key = { it.id }) { a ->
                                    val unread = !model.articles.isRead(a.id)
                                    Card(
                                        onClick = { onSelect(a.id); model.articles.markRead(a.id) },
                                        modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp),
                                        colors = CardDefaults.cardColors(containerColor = if (a.id == selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceVariant),
                                    ) {
                                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                                if (unread) Box(Modifier.size(8.dp).background(MaterialTheme.colorScheme.primary, CircleShape))
                                                Text(listOf(a.site, relativeTime(a.receivedAt), if (a.local) "Summarized on this phone" else "").filter { it.isNotBlank() }.joinToString(" · "), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                            }
                                            Text(a.title, style = MaterialTheme.typography.titleMedium, fontWeight = if (unread) FontWeight.Bold else FontWeight.Normal, maxLines = 3, overflow = TextOverflow.Ellipsis)
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                detail = { current?.let { ArticleReader(model, it.id, onClosed = { onSelect("") }, onOpenWeb = onOpenWeb) } },
                empty = { EmptyState("Pick an article", "Choose an article from the list to read it here.") },
            )
        }
    }
}

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun ArticleReader(model: AppModel, id: String, onClosed: () -> Unit, onOpenWeb: (String) -> Unit) {
    val context = LocalContext.current
    var sent by remember(id) { mutableStateOf(false) }
    val article = remember(id) { model.articles.load(id) }
    LaunchedEffect(id) { model.articles.markRead(id) }
    if (article == null) { EmptyState("This article could not be opened", "It may have been removed from this phone."); return }
    val placed = remember(id) { Highlighter.place(article.blocks, article.highlights) }
    ReadingColumn {
        LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 40.dp)) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(article.title.ifBlank { article.url }, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                    val meta = listOf(article.byline, article.site).filter { it.isNotBlank() }.joinToString(" · ")
                    if (meta.isNotEmpty()) Text(meta, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(top = 4.dp)) {
                        Button(onClick = { onOpenWeb(article.url) }) { Text("Read original") }
                        if (article.summary.isNotBlank()) OutlinedButton(onClick = { shareText(context, article.title, PageSummary.shareText(article.title, article.summary, article.url)) }) { Icon(Icons.Filled.Share, null, Modifier.size(18.dp)); Text("  Share") }
                        if (model.pairing != null) OutlinedButton(onClick = { SendWorker.enqueue(context, article.url); sent = true }, enabled = !sent) { Text(if (sent) "Sent" else "To browser") }
                        OutlinedButton(onClick = { model.articles.delete(id); model.reload(); onClosed() }) { Icon(Icons.Filled.Delete, null, Modifier.size(18.dp)); Text("  Delete") }
                    }
                }
            }
            if (article.summary.isNotBlank()) item {
                Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(if (article.local) "Summary · made on this phone" else "AISH summary", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                        PlainText(article.summary)
                    }
                }
            }
            item { HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant) }
            items(article.blocks.size) { i -> BlockView(article.blocks[i], placed[i] ?: emptyList()) }
            if (article.truncated) item { Text("This long article was shortened to fit. Tap Read original for the rest.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            if (article.highlights.isNotEmpty()) item { Highlights(article.highlights) }
        }
    }
}

@Composable
private fun Highlights(list: List<Highlight>) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 16.dp)) {
        Text("Highlights", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        for (h in list) {
            val (bg, fg) = if (h.ghost) MaterialTheme.colorScheme.secondaryContainer to MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.tertiaryContainer to MaterialTheme.colorScheme.onTertiaryContainer
            Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp), colors = CardDefaults.cardColors(containerColor = bg, contentColor = fg)) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(if (h.ghost) "AI highlight" else "Your highlight", style = MaterialTheme.typography.labelSmall)
                    Text(h.text, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}
