package eu.byphil.aishcompanion

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.RssFeed
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** "all", "folder:<name>" or "feed:<url>". */
private fun matches(source: String, e: FeedEntryRef): Boolean = when {
    source == "all" -> true
    source.startsWith("folder:") -> e.feed.folder == source.removePrefix("folder:")
    source.startsWith("feed:") -> e.feed.url == source.removePrefix("feed:")
    else -> true
}

private fun sourceLabel(source: String, model: AppModel): String = when {
    source.startsWith("folder:") -> source.removePrefix("folder:")
    source.startsWith("feed:") -> model.feeds.firstOrNull { it.url == source.removePrefix("feed:") }?.name ?: "Feeds"
    else -> "Feeds"
}

/** The selected item travels as "<feed url>\n<item id>" so it can be saved across fold changes and process restarts. */
fun selectionKey(feedUrl: String, id: String) = "$feedUrl\n$id"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeedsScreen(
    model: AppModel,
    source: String, onSource: (String) -> Unit,
    selected: String, onSelect: (String) -> Unit,
    onOpenWeb: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var showSources by remember { mutableStateOf(false) }
    var showAdd by remember { mutableStateOf(false) }
    var unreadOnly by remember { mutableStateOf(false) }
    var addError by remember { mutableStateOf<String?>(null) }
    var adding by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { if (model.feeds.isNotEmpty()) model.refreshAll(force = false) }
    LaunchedEffect(model.message) { model.message?.let { snackbar.showSnackbar(it); model.consumeMessage() } }

    val visible = model.entries.filter { matches(source, it) && (!unreadOnly || !it.stored.read) }
    val current = visible.firstOrNull { selectionKey(it.feed.url, it.stored.item.id) == selected }
        ?: model.entries.firstOrNull { selectionKey(it.feed.url, it.stored.item.id) == selected }

    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text(sourceLabel(source, model), maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    if (!isWide() && current != null) IconButton(onClick = { onSelect("") }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
                actions = {
                    IconButton(onClick = { scope.launch { val n = model.refreshAll(); snackbar.showSnackbar(if (n == 0) "No new items." else "$n new items.") } }, enabled = !model.refreshing) {
                        Icon(Icons.Filled.Refresh, contentDescription = "Refresh")
                    }
                    IconButton(onClick = { showSources = true }) { Icon(Icons.Filled.RssFeed, contentDescription = "Sources") }
                },
            )
        },
        floatingActionButton = {
            if (current == null || isWide()) ExtendedFloatingActionButton(onClick = { addError = null; showAdd = true }, icon = { Icon(Icons.Filled.Add, null) }, text = { Text("Add feed") })
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            ListDetail(
                hasSelection = current != null,
                onBackToList = { onSelect("") },
                list = {
                    PullToRefreshBox(isRefreshing = model.refreshing, onRefresh = { scope.launch { model.refreshAll() } }, modifier = Modifier.fillMaxSize()) {
                        Column(Modifier.fillMaxSize()) {
                            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                FilterChip(selected = unreadOnly, onClick = { unreadOnly = !unreadOnly }, label = { Text("Unread") })
                                if (source != "all") FilterChip(selected = false, onClick = { onSource("all") }, label = { Text("All feeds") })
                                if (visible.any { !it.stored.read }) FilterChip(selected = false, onClick = { scope.launch { model.markAllRead(visible.map { it.feed.url }.distinct()) } }, label = { Text("Mark all read") }, leadingIcon = { Icon(Icons.Filled.DoneAll, null, Modifier.size(18.dp)) })
                            }
                            if (model.feeds.isEmpty()) EmptyState("No feeds yet", "Add a feed with the button below. Feeds you add in the browser extension appear here after you switch on feed sync in Settings.")
                            else if (visible.isEmpty()) EmptyState(if (unreadOnly) "All read" else "Nothing here yet", if (unreadOnly) "Turn off the Unread filter to see older items." else "Pull down to refresh.")
                            else LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 96.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                items(visible, key = { selectionKey(it.feed.url, it.stored.item.id) }) { e ->
                                    ItemCard(e, selected = selectionKey(e.feed.url, e.stored.item.id) == selected) {
                                        onSelect(selectionKey(e.feed.url, e.stored.item.id))
                                        scope.launch { model.markRead(e.feed.url, e.stored.item.id) }
                                    }
                                }
                            }
                        }
                    }
                },
                detail = { current?.let { FeedItemDetail(model, it, onOpenWeb) } },
                empty = { EmptyState("Pick an item", "Choose something from the list to read it here.") },
            )
        }
    }

    if (showAdd) FieldDialog(
        title = "Add feed", label = "Feed or website address", label2 = "Folder (optional)", confirm = "Add", error = addError, busy = adding,
        onDismiss = { showAdd = false },
        onConfirm = { url, folder ->
            scope.launch {
                adding = true; addError = null
                val err = model.addFeed(url, folder)
                adding = false
                if (err == null) { showAdd = false; snackbar.showSnackbar("Feed added.") } else addError = err
            }
        },
    )
    if (showSources) SourcesSheet(model, source, onPick = { onSource(it); onSelect(""); showSources = false }, onDismiss = { showSources = false })
}

@Composable
private fun ItemCard(e: FeedEntryRef, selected: Boolean, onClick: () -> Unit) {
    val unread = !e.stored.read
    val item = e.stored.item
    Card(
        onClick = onClick, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = if (selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (unread) Box(Modifier.size(8.dp).background(MaterialTheme.colorScheme.primary, CircleShape))
                Text(listOf(e.feed.name, relativeTime(item.published)).filter { it.isNotBlank() }.joinToString(" · "), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(item.title, style = MaterialTheme.typography.titleMedium, fontWeight = if (unread) FontWeight.Bold else FontWeight.Normal, maxLines = 3, overflow = TextOverflow.Ellipsis)
            if (item.summary.isNotBlank() && item.summary != item.title) Text(item.summary, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun FeedItemDetail(model: AppModel, e: FeedEntryRef, onOpenWeb: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val item = e.stored.item
    var sent by remember(item.id) { mutableStateOf(false) }
    ReadingColumn {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(item.title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Text(listOf(e.feed.name, item.author, relativeTime(item.published)).filter { it.isNotBlank() }.joinToString(" · "), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (item.link.isNotEmpty()) Button(onClick = { onOpenWeb(item.link) }) { Text("Read page") }
                if (item.link.isNotEmpty() && model.pairing != null) OutlinedButton(onClick = { SendWorker.enqueue(context, item.link); sent = true }, enabled = !sent) {
                    Icon(Icons.AutoMirrored.Filled.Send, null, Modifier.size(18.dp)); Text(if (sent) "  Queued" else "  To browser")
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            if (item.body.isNotBlank()) PlainText(item.body)
            if (item.link.isNotEmpty() && item.body.length < 500) Text("This feed only sends a short teaser. Tap Read page for the full article.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = { scope.launch { model.markRead(e.feed.url, item.id, false) } }) { Text("Mark as unread") }
        }
    }
}

/** Folders and feeds: pick a source, rename, move to a folder, remove. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SourcesSheet(model: AppModel, source: String, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var menuFor by remember { mutableStateOf<String?>(null) }
    var renaming by remember { mutableStateOf<Feed?>(null) }
    var moving by remember { mutableStateOf<Feed?>(null) }
    val folders = model.feeds.map { it.folder }.filter { it.isNotEmpty() }.distinct().sorted()
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
            SourceRow("All feeds", model.entries.count { !it.stored.read }, source == "all") { onPick("all") }
            for (folder in folders) {
                SourceRow(folder, model.entries.count { it.feed.folder == folder && !it.stored.read }, source == "folder:$folder", bold = true) { onPick("folder:$folder") }
                for (f in model.feeds.filter { it.folder == folder }) FeedRow(model, f, source, menuFor, { menuFor = it }, onPick, { renaming = it }, { moving = it }, scope)
            }
            val loose = model.feeds.filter { it.folder.isEmpty() }
            if (loose.isNotEmpty() && folders.isNotEmpty()) Text("No folder", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 24.dp, top = 12.dp, bottom = 4.dp))
            for (f in loose) FeedRow(model, f, source, menuFor, { menuFor = it }, onPick, { renaming = it }, { moving = it }, scope)
        }
    }
    renaming?.let { f -> FieldDialog("Rename feed", "Name", f.name, confirm = "Save", onDismiss = { renaming = null }, onConfirm = { a, _ -> scope.launch { model.rename(f.url, a) }; renaming = null }) }
    moving?.let { f -> FieldDialog("Move to folder", "Folder (empty for none)", f.folder, confirm = "Save", onDismiss = { moving = null }, onConfirm = { a, _ -> scope.launch { model.setFolder(f.url, a) }; moving = null }) }
}

@Composable
private fun SourceRow(label: String, unread: Int, selected: Boolean, bold: Boolean = false, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(if (selected) MaterialTheme.colorScheme.secondaryContainer else androidx.compose.ui.graphics.Color.Transparent).padding(horizontal = 24.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TextButton(onClick = onClick, modifier = Modifier.weight(1f)) {
            Text(label, fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (unread > 0) Text("$unread", color = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
private fun FeedRow(model: AppModel, f: Feed, source: String, menuFor: String?, setMenu: (String?) -> Unit, onPick: (String) -> Unit, rename: (Feed) -> Unit, move: (Feed) -> Unit, scope: kotlinx.coroutines.CoroutineScope) {
    Row(
        Modifier.fillMaxWidth().background(if (source == "feed:${f.url}") MaterialTheme.colorScheme.secondaryContainer else androidx.compose.ui.graphics.Color.Transparent).padding(start = 40.dp, end = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            TextButton(onClick = { onPick("feed:${f.url}") }) {
                Text(f.name, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                val n = model.entries.count { it.feed.url == f.url && !it.stored.read }
                if (n > 0) Text("$n", color = MaterialTheme.colorScheme.primary)
            }
            if (f.error.isNotEmpty()) Text("Could not be fetched last time", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(start = 12.dp))
        }
        Box {
            IconButton(onClick = { setMenu(f.url) }) { Icon(Icons.Filled.MoreVert, contentDescription = "More") }
            DropdownMenu(expanded = menuFor == f.url, onDismissRequest = { setMenu(null) }) {
                DropdownMenuItem(text = { Text("Rename") }, onClick = { setMenu(null); rename(f) })
                DropdownMenuItem(text = { Text("Move to folder") }, onClick = { setMenu(null); move(f) })
                DropdownMenuItem(text = { Text("Remove") }, onClick = { setMenu(null); scope.launch { model.removeFeed(f.url) } })
            }
        }
    }
}
