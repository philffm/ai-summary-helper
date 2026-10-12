package eu.byphil.aishcompanion

import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.material.icons.filled.WbSunny
import androidx.compose.material.icons.filled.RssFeed
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.FilledTonalButton
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.SelectAll
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.MarkEmailUnread
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.material.icons.filled.Headphones
import androidx.compose.material.icons.filled.PlayArrow
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
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.material.icons.filled.Mood
import kotlinx.coroutines.launch

/** "all", "folder:<tag>" (a tag of the feed in the extension) or "feed:<url>". */
private fun matches(source: String, e: FeedEntryRef): Boolean = when {
    source == "all" -> true
    source.startsWith("folder:") -> source.removePrefix("folder:") in e.feed.tags
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
    var showBriefing by remember { mutableStateOf(false) }
    var unreadOnly by remember { mutableStateOf(false) }
    var moodFilter by remember { mutableStateOf("any") }   // any, pos (positive only), nonneg (hide heavy)
    var favOnly by remember { mutableStateOf(false) }
    var searching by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    val searchFocus = remember { FocusRequester() }
    var picked by remember { mutableStateOf(setOf<String>()) }   // selection keys of the items chosen for an action
    val context = LocalContext.current

    LaunchedEffect(Unit) { if (model.feeds.isNotEmpty()) model.refreshAll(force = false) }
    LaunchedEffect(model.message) { model.message?.let { snackbar.showSnackbar(it); model.consumeMessage() } }

    LaunchedEffect(searching) { if (searching) searchFocus.requestFocus() }
    val searchActive = searching && query.isNotBlank()
    // a search looks through everything; the source and the other filters apply when not searching
    val visible = if (searchActive) model.entries.filter { FeedSearch.matches(it, query) } else model.entries.filter {
        matches(source, it) && (!unreadOnly || !it.stored.read) && (!favOnly || it.stored.fav) &&
            when (moodFilter) { "pos" -> Mood.of(it.stored.sent) == "pos"; "nonneg" -> Mood.of(it.stored.sent) != "neg"; else -> true }
    }
    val anyRated = model.entries.any { it.stored.sent != null }
    val current = visible.firstOrNull { selectionKey(it.feed.url, it.stored.item.id) == selected }
        ?: model.entries.firstOrNull { selectionKey(it.feed.url, it.stored.item.id) == selected }

    androidx.activity.compose.BackHandler(enabled = picked.isNotEmpty()) { picked = emptySet() }
    val chosen = visible.filter { selectionKey(it.feed.url, it.stored.item.id) in picked }
    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            if (picked.isNotEmpty()) TopAppBar(
                title = { Text("${picked.size} selected") },
                navigationIcon = { IconButton(onClick = { picked = emptySet() }) { Icon(Icons.Filled.Close, contentDescription = "Cancel selection") } },
                actions = {
                    IconButton(onClick = { picked = visible.map { selectionKey(it.feed.url, it.stored.item.id) }.toSet() }) { Icon(Icons.Filled.SelectAll, contentDescription = "Select all") }
                    val allFav = chosen.isNotEmpty() && chosen.all { it.stored.fav }
                    IconButton(onClick = { val keys = picked; picked = emptySet(); scope.launch { model.setFavoriteMany(keys, !allFav) } }) {
                        Icon(if (allFav) Icons.Filled.StarBorder else Icons.Filled.Star, contentDescription = if (allFav) "Remove from favorites" else "Add to favorites")
                    }
                    val allRead = chosen.isNotEmpty() && chosen.all { it.stored.read }
                    IconButton(onClick = { val keys = picked; picked = emptySet(); scope.launch { model.markReadMany(keys, !allRead) } }) {
                        Icon(if (allRead) Icons.Filled.MarkEmailUnread else Icons.Filled.DoneAll, contentDescription = if (allRead) "Mark as unread" else "Mark as read")
                    }
                    IconButton(onClick = {
                        val links = chosen.map { it.stored.item.link }.filter { it.isNotEmpty() }
                        if (links.isNotEmpty()) shareText(context, "Links from AISH", chosen.filter { it.stored.item.link.isNotEmpty() }.joinToString("\n\n") { it.stored.item.title + "\n" + it.stored.item.link })
                    }) { Icon(Icons.Filled.Share, contentDescription = "Share links") }
                    if (model.pairing != null) IconButton(onClick = {
                        val links = chosen.map { it.stored.item.link }.filter { it.isNotEmpty() }.distinct()
                        links.forEach { SendWorker.enqueue(context, it) }
                        picked = emptySet()
                        scope.launch { snackbar.showSnackbar(if (links.isEmpty()) "These items have no link." else if (links.size == 1) "Queued for the browser." else "${links.size} links queued for the browser.") }
                    }) { Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send to browser") }
                },
            ) else TopAppBar(
                title = {
                    if (searching) TextField(
                        value = query, onValueChange = { query = it }, singleLine = true, placeholder = { Text("Search all feeds") },
                        colors = TextFieldDefaults.colors(focusedContainerColor = androidx.compose.ui.graphics.Color.Transparent, unfocusedContainerColor = androidx.compose.ui.graphics.Color.Transparent, focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent, unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent),
                        modifier = Modifier.fillMaxWidth().focusRequester(searchFocus),
                    )
                    else Text(sourceLabel(source, model), maxLines = 1, overflow = TextOverflow.Ellipsis)
                },
                navigationIcon = {
                    if (!isWide() && current != null) IconButton(onClick = { onSelect("") }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
                actions = {
                    if (searching) {
                        IconButton(onClick = { searching = false; query = "" }) { Icon(Icons.Filled.Close, contentDescription = "Close search") }
                    } else IconButton(onClick = { searching = true }) { Icon(Icons.Filled.Search, contentDescription = "Search") }
                    IconButton(onClick = { scope.launch { val n = model.refreshAll(); snackbar.showSnackbar(if (n == 0) "No new items." else "$n new items.") } }, enabled = !model.refreshing) {
                        Icon(Icons.Filled.Refresh, contentDescription = "Refresh")
                    }
                    IconButton(onClick = { showBriefing = true }) { Icon(Icons.Filled.WbSunny, contentDescription = "Today's briefing") }
                    IconButton(onClick = { scope.launch { snackbar.showSnackbar(model.rateMood()) } }, enabled = !model.rating) {
                        Icon(Icons.Filled.Mood, contentDescription = "Rate by mood with the on-device AI")
                    }
                    IconButton(onClick = { showSources = true }) { Icon(Icons.Filled.RssFeed, contentDescription = "Manage feeds") }
                },
            )
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
                                FilterChip(selected = favOnly, onClick = { favOnly = !favOnly }, label = { Text("Favorites") }, leadingIcon = { Icon(if (favOnly) Icons.Filled.Star else Icons.Filled.StarBorder, null, Modifier.size(18.dp)) })
                                if (anyRated) {
                                    FilterChip(selected = moodFilter == "pos", onClick = { moodFilter = if (moodFilter == "pos") "any" else "pos" }, label = { Text("😊 Positive only") })
                                    FilterChip(selected = moodFilter == "nonneg", onClick = { moodFilter = if (moodFilter == "nonneg") "any" else "nonneg" }, label = { Text("Hide 😟") })
                                }
                                if (source != "all") FilterChip(selected = false, onClick = { onSource("all") }, label = { Text("All feeds") })
                                if (visible.any { !it.stored.read }) FilterChip(selected = false, onClick = { scope.launch { model.markAllRead(visible.map { it.feed.url }.distinct()) } }, label = { Text("Mark all read") }, leadingIcon = { Icon(Icons.Filled.DoneAll, null, Modifier.size(18.dp)) })
                            }
                            if (model.rating) androidx.compose.material3.LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 16.dp))
                            if (model.feeds.isEmpty()) {
                                EmptyState("No feeds yet", "Add a feed, or switch on feed sync in Settings to get the ones from your browser extension.")
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) { FilledTonalButton(onClick = { showAdd = true }) { Icon(Icons.Filled.Add, null, Modifier.size(18.dp)); Text("  Add feed") } }
                            }
                            else if (visible.isEmpty()) EmptyState(
                                if (searchActive) "No matches" else if (favOnly) "No favorites yet" else if (unreadOnly) "All read" else "Nothing here yet",
                                if (searchActive) "Nothing in your feeds matches that." else if (favOnly) "Tap the star on an item to keep it here." else if (unreadOnly) "Turn off the Unread filter to see older items." else "Pull down to refresh.",
                            )
                            else LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                if (!searchActive && source == "all") item(key = "recap") {
                                    RecapCard(model) { scope.launch { model.refreshRecap()?.let { snackbar.showSnackbar(it) } } }
                                }
                                items(visible, key = { selectionKey(it.feed.url, it.stored.item.id) }) { e ->
                                    val key = selectionKey(e.feed.url, e.stored.item.id)
                                    ItemCard(
                                        e, selected = key == selected, picked = key in picked, selecting = picked.isNotEmpty(),
                                        onFav = { scope.launch { model.setFavorite(e.feed.url, e.stored.item.id, !e.stored.fav) } },
                                        onLong = { picked = if (key in picked) picked - key else picked + key },
                                    ) {
                                        if (picked.isNotEmpty()) picked = if (key in picked) picked - key else picked + key
                                        else {
                                            onSelect(key)
                                            scope.launch { model.markRead(e.feed.url, e.stored.item.id) }
                                        }
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

    if (showAdd) AddFeedDialog(model, onDismiss = { showAdd = false }, onAdded = { showAdd = false; scope.launch { snackbar.showSnackbar("Feed added.") } })
    if (showBriefing) BriefingDialog(model) { showBriefing = false }
    if (showSources) SourcesSheet(model, source, onAdd = { showSources = false; showAdd = true }, onPick = { onSource(it); onSelect(""); showSources = false }, onDismiss = { showSources = false })
}

/** A light tint behind rated items: green for good news through red for heavy news, stronger with the score (as in the extension). */
private fun moodTint(sent: Double?, base: androidx.compose.ui.graphics.Color): androidx.compose.ui.graphics.Color {
    if (sent == null || Mood.of(sent) == "neu") return base
    val a = (0.07 + 0.10 * kotlin.math.abs(sent).coerceAtMost(1.0)).toFloat() * 1.6f
    return androidx.compose.ui.graphics.Color.hsv(Mood.hue(sent), 0.75f, 0.85f).copy(alpha = a).compositeOver(base)
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ItemCard(e: FeedEntryRef, selected: Boolean, picked: Boolean, selecting: Boolean, onFav: () -> Unit, onLong: () -> Unit, onClick: () -> Unit) {
    val unread = !e.stored.read
    val item = e.stored.item
    Card(
        modifier = Modifier.fillMaxWidth().combinedClickable(onClick = onClick, onLongClick = onLong), shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = if (picked || selected) MaterialTheme.colorScheme.secondaryContainer else moodTint(e.stored.sent, MaterialTheme.colorScheme.surfaceVariant)),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (selecting) Icon(if (picked) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                if (unread) Box(Modifier.size(8.dp).background(MaterialTheme.colorScheme.primary, CircleShape))
                Text(listOf(e.feed.name, relativeTime(item.published)).filter { it.isNotBlank() }.joinToString(" · "), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                when (Mood.of(e.stored.sent)) { "pos" -> Text("😊"); "neg" -> Text("😟"); else -> {} }
                androidx.compose.foundation.layout.Spacer(Modifier.weight(1f))
                if (item.audio.isNotEmpty()) {
                    val ctx = LocalContext.current
                    IconButton(onClick = { PodcastPlayer.play(ctx, Episode(item.audio, item.title, e.feed.name)) }, modifier = Modifier.size(32.dp)) {
                        Icon(if (PodcastPlayer.episode?.url == item.audio && PodcastPlayer.playing) Icons.Filled.Headphones else Icons.Filled.PlayArrow, contentDescription = "Play episode", tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(22.dp))
                    }
                }
                IconButton(onClick = onFav, modifier = Modifier.size(32.dp)) {
                    Icon(if (e.stored.fav) Icons.Filled.Star else Icons.Filled.StarBorder, contentDescription = if (e.stored.fav) "Remove from favorites" else "Add to favorites",
                        tint = if (e.stored.fav) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp))
                }
            }
            Text(item.title, style = MaterialTheme.typography.titleMedium, fontWeight = if (unread) FontWeight.Bold else FontWeight.Normal, maxLines = 3, overflow = TextOverflow.Ellipsis)
            if (item.summary.isNotBlank() && item.summary != item.title) Text(item.summary, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
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
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (item.audio.isNotEmpty()) Button(onClick = { PodcastPlayer.play(context, Episode(item.audio, item.title, e.feed.name)) }) {
                    Icon(Icons.Filled.PlayArrow, null, Modifier.size(18.dp)); Text("  Play" + (if (item.duration > 0) " · " + PodcastTime.format(item.duration * 1000) else ""))
                }
                if (item.link.isNotEmpty() && item.audio.isNotEmpty()) {
                    OutlinedButton(onClick = { onOpenWeb(item.link) }) { Text("Read page") }
                } else if (item.link.isNotEmpty()) {
                    Button(onClick = { onOpenWeb(item.link) }) { Text("Read page") }
                }
                OutlinedButton(onClick = { scope.launch { model.setFavorite(e.feed.url, item.id, !e.stored.fav) } }) {
                    Icon(if (e.stored.fav) Icons.Filled.Star else Icons.Filled.StarBorder, null, Modifier.size(18.dp)); Text(if (e.stored.fav) "  Favorited" else "  Favorite")
                }
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

/** Tags (shown as folders; a feed with several tags appears under each) and feeds: pick a source, rename, edit tags, remove. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SourcesSheet(model: AppModel, source: String, onAdd: () -> Unit, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var menuFor by remember { mutableStateOf<String?>(null) }
    var renaming by remember { mutableStateOf<Feed?>(null) }
    var moving by remember { mutableStateOf<Feed?>(null) }
    val folders = model.feeds.flatMap { it.tags }.distinct().sorted()
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
            SyncCard(model, onAdd)
            SourceRow("All feeds", model.entries.count { !it.stored.read }, source == "all") { onPick("all") }
            for (folder in folders) {
                SourceRow(folder, model.entries.count { folder in it.feed.tags && !it.stored.read }, source == "folder:$folder", bold = true) { onPick("folder:$folder") }
                for (f in model.feeds.filter { folder in it.tags }) FeedRow(model, f, source, menuFor, { menuFor = it }, onPick, { renaming = it }, { moving = it }, scope)
            }
            val loose = model.feeds.filter { it.tags.isEmpty() }
            if (loose.isNotEmpty() && folders.isNotEmpty()) Text("No tag", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 24.dp, top = 12.dp, bottom = 4.dp))
            for (f in loose) FeedRow(model, f, source, menuFor, { menuFor = it }, onPick, { renaming = it }, { moving = it }, scope)
        }
    }
    renaming?.let { f -> FieldDialog("Rename feed", "Name", f.name, confirm = "Save", onDismiss = { renaming = null }, onConfirm = { a, _ -> scope.launch { model.rename(f.url, a) }; renaming = null }) }
    moving?.let { f -> FieldDialog("Edit tags", "Tags, separated by commas (empty for none)", f.tags.joinToString(", "), confirm = "Save", onDismiss = { moving = null }, onConfirm = { a, _ -> scope.launch { model.setTags(f.url, a) }; moving = null }) }
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
                DropdownMenuItem(text = { Text("Edit tags") }, onClick = { setMenu(null); move(f) })
                DropdownMenuItem(text = { Text("Remove") }, onClick = { setMenu(null); scope.launch { model.removeFeed(f.url) } })
            }
        }
    }
}

/** Top of the feed management sheet: whether the list follows the extension, and the Add feed action. */
@Composable
private fun SyncCard(model: AppModel, onAdd: () -> Unit) {
    val scope = rememberCoroutineScope()
    val canSync = model.pairing?.canSync == true
    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(if (canSync) "Synced with your extension" else "Not synced with the extension", style = MaterialTheme.typography.titleSmall)
            Text(
                if (canSync) "Feeds you add, rename, tag or remove here appear in the browser extension, and the other way round." + (if (model.lastSyncAt > 0) " Last sync " + relativeTime(model.lastSyncAt) + "." else "")
                else "Switch on feed sync in the extension and scan its code in Settings to share your feed list.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilledTonalButton(onClick = onAdd) { Icon(Icons.Filled.Add, null, Modifier.size(18.dp)); Text("  Add feed") }
                if (canSync) OutlinedButton(onClick = { scope.launch { model.syncFeeds() } }, enabled = !model.syncing) { Icon(Icons.Filled.Sync, null, Modifier.size(18.dp)); Text(if (model.syncing) "  Syncing…" else "  Sync now") }
            }
        }
    }
}

/** "Today in your feeds": the recap written on the phone, with a refresh button. Old recaps stay until the user refreshes. */
@Composable
private fun RecapCard(model: AppModel, onRefresh: () -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val text = model.recapText
    val today = java.time.Instant.ofEpochMilli(model.recapAt).atZone(java.time.ZoneId.systemDefault()).toLocalDate() == java.time.LocalDate.now()
    Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Today in your feeds", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                if (model.recapBusy) androidx.compose.material3.CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                else IconButton(onClick = onRefresh) { Icon(Icons.Filled.Refresh, contentDescription = "Refresh the recap") }
            }
            if (text.isBlank()) Text(if (model.recapBusy) "Writing it on this phone… up to a minute." else "Tap refresh to have the on-device model recap today's stories.", style = MaterialTheme.typography.bodyMedium)
            else {
                Text(text, style = MaterialTheme.typography.bodyMedium, maxLines = if (expanded) Int.MAX_VALUE else 6, overflow = TextOverflow.Ellipsis)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        (if (today) "Updated " else "From ") + relativeTime(model.recapAt) + " · " + model.recapCount + " stories" + (if (today) "" else ". Refresh for today."),
                        style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f),
                    )
                    TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) "Less" else "More") }
                }
            }
        }
    }
}
