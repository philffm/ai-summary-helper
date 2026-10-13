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
import androidx.compose.material.icons.filled.OpenInBrowser
import androidx.compose.material.icons.filled.TextDecrease
import androidx.compose.material.icons.filled.TextIncrease
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.MarkEmailUnread
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
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
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

    // Delete with a way back: the article waits in a bin while the snackbar offers Undo; it is gone for good when that goes away.
    val deleteWithUndo: (String) -> Unit = { id ->
        if (model.articles.trash(id)) {
            model.reload()
            onSelect("")
            scope.launch {
                val result = snackbar.showSnackbar("Article deleted", actionLabel = "Undo", withDismissAction = true, duration = SnackbarDuration.Long)
                if (result == SnackbarResult.ActionPerformed) model.articles.restore(id) else model.articles.purge(id)
                model.reload()
            }
        }
    }

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
                                    val unread = model.readTick >= 0 && !model.articles.isRead(a.id)
                                    val dismiss = rememberSwipeToDismissBoxState(confirmValueChange = { v -> when (v) { SwipeToDismissBoxValue.EndToStart -> { deleteWithUndo(a.id); true }; SwipeToDismissBoxValue.StartToEnd -> { model.toggleRead(a.id); false }; else -> false } })
                                    SwipeToDismissBox(
                                        state = dismiss,
                                        backgroundContent = {
                                            val right = dismiss.dismissDirection == SwipeToDismissBoxValue.StartToEnd
                                            Box(
                                                Modifier.fillMaxSize().background(if (right) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.errorContainer, RoundedCornerShape(20.dp)).padding(horizontal = 24.dp),
                                                contentAlignment = if (right) Alignment.CenterStart else Alignment.CenterEnd,
                                            ) {
                                                if (right) Icon(if (unread) Icons.Filled.DoneAll else Icons.Filled.MarkEmailUnread, contentDescription = if (unread) "Mark as read" else "Mark as unread")
                                                else Icon(Icons.Filled.Delete, contentDescription = "Delete", tint = MaterialTheme.colorScheme.onErrorContainer)
                                            }
                                        },
                                    ) {
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
                    }
                },
                detail = { current?.let { ArticleReader(model, it.id, onDelete = deleteWithUndo, onOpenWeb = onOpenWeb) } },
                empty = { EmptyState("Pick an article", "Choose an article from the list to read it here.") },
            )
        }
    }
}

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun ArticleReader(model: AppModel, id: String, onDelete: (String) -> Unit, onOpenWeb: (String) -> Unit) {
    val context = LocalContext.current
    var sent by remember(id) { mutableStateOf(false) }
    val article = remember(id) { model.articles.load(id) }
    LaunchedEffect(id) { model.articles.markRead(id) }
    if (article == null) { EmptyState("This article could not be opened", "It may have been removed from this phone."); return }
    val placed = remember(id) { Highlighter.place(article.blocks, article.highlights) }
    val scale = remember(id) { model.store.readerScale }   // set in Settings → Accessibility
    val density = androidx.compose.ui.platform.LocalDensity.current
    androidx.compose.runtime.CompositionLocalProvider(androidx.compose.ui.platform.LocalDensity provides androidx.compose.ui.unit.Density(density.density, density.fontScale * scale)) {
    ReadingColumn {
      Column(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 40.dp)) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(article.title.ifBlank { article.url }, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                    val meta = listOf(article.byline, article.site).filter { it.isNotBlank() }.joinToString(" · ")
                    if (meta.isNotEmpty()) Text(meta, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
        ActionBar(
            primary = BarAction(Icons.Filled.OpenInBrowser, "Read original") { onOpenWeb(article.url) },
            secondary = listOfNotNull(
                if (article.summary.isNotBlank()) BarAction(Icons.Filled.Share, "Share") { shareText(context, article.title, PageSummary.shareText(article.title, article.summary, article.url)) } else null,
                if (model.pairing != null && article.local) BarAction(Icons.AutoMirrored.Filled.Send, if (sent) "Sent" else "Send to the browser", enabled = !sent) { SendWorker.enqueue(context, article.url); sent = true } else null,
                BarAction(Icons.Filled.Delete, "Delete") { onDelete(id) },
            ),
        )
      }
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
