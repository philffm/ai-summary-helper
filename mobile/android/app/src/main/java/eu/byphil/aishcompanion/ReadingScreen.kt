package eu.byphil.aishcompanion

import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
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
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Unarchive
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Description
import androidx.compose.material3.AssistChip
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Alarm
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.runtime.mutableIntStateOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** The reading list: articles sent from the browser (Send to phone). Two panes on wide screens. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReadingScreen(model: AppModel, selected: String, onSelect: (String) -> Unit, onOpenWeb: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val canReceive = model.pairing?.canReceive == true
    val current = model.articleList.firstOrNull { it.id == selected }
    var searching by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    var view by rememberSaveable { mutableStateOf(ReadingView.ALL) }
    // Search also looks into the article text; each text is read from disk once per list.
    val texts = remember(model.articleList) { HashMap<String, String>() }
    val shown = remember(model.articleList, query, view, model.readTick) {
        ReadingFilter.apply(model.articleList, query, view, { model.articles.isRead(it) }, { model.articles.isArchived(it) }) { id ->
            texts.getOrPut(id) { model.articles.load(id)?.let { a -> a.summary + " " + a.blocks.joinToString(" ") { b -> b.text } }.orEmpty() }
        }
    }

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

    // Archive instead of delete: the article leaves the list but stays on the phone (Archive filter); Undo brings it back.
    val archiveWithUndo: (String) -> Unit = { id ->
        model.setArchived(id, true)
        if (id == selected) onSelect("")
        scope.launch {
            val result = snackbar.showSnackbar("Archived", actionLabel = "Undo", withDismissAction = true, duration = SnackbarDuration.Short)
            if (result == SnackbarResult.ActionPerformed) model.setArchived(id, false)
        }
    }

    LaunchedEffect(current == null) { if (current == null) model.focusReading = false }
    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text("Reading list") },
                navigationIcon = { if (!isWide() && current != null) IconButton(onClick = { onSelect("") }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
                actions = {
                    if (isWide() && current != null) FocusToggle(model.focusReading) { model.focusReading = !model.focusReading }
                    if (model.articleList.isNotEmpty()) IconButton(onClick = { searching = !searching; if (!searching) query = "" }) {
                        Icon(if (searching) Icons.Filled.Close else Icons.Filled.Search, contentDescription = if (searching) "Close search" else "Search")
                    }
                    if (canReceive) IconButton(onClick = { scope.launch { snackbar.showSnackbar(model.checkArticles()) } }, enabled = !model.checking) { Icon(Icons.Filled.Refresh, contentDescription = "Check for new articles") }
                },
            )
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            ListDetail(
                hasSelection = current != null,
                onBackToList = { onSelect("") },
                focus = model.focusReading, onExitFocus = { model.focusReading = false },
                list = {
                    if (model.articleList.isEmpty()) {
                        EmptyState(
                            "Nothing to read yet",
                            if (canReceive) "In the browser extension open ⋯ → Send to phone on an article. It arrives within about 15 minutes, or tap refresh."
                            else "Switch on Send to phone in the extension (Settings → Phone inbox), then scan the new code in Settings here.",
                        )
                    } else {
                        Column(Modifier.fillMaxSize()) {
                            if (searching) OutlinedTextField(
                                query, { query = it }, Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 8.dp), singleLine = true,
                                placeholder = { Text("Search title, site and text") }, shape = MaterialTheme.shapes.extraLarge,
                                leadingIcon = { Icon(Icons.Filled.Search, null) },
                            )
                            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                FilterChip(shape = PillShape, selected = view == ReadingView.UNREAD, onClick = { view = ReadingView.UNREAD }, label = { Text("Unread") })
                                FilterChip(shape = PillShape, selected = view == ReadingView.ALL, onClick = { view = ReadingView.ALL }, label = { Text("All") })
                                FilterChip(shape = PillShape, selected = view == ReadingView.ARCHIVED, onClick = { view = ReadingView.ARCHIVED }, label = { Text("Archive") })
                            }
                            if (query.isNotBlank() && shown.isNotEmpty()) Text(
                                "${shown.size} ${if (shown.size == 1) "result" else "results"}",
                                style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(horizontal = 20.dp).semantics { liveRegion = LiveRegionMode.Polite },
                            )
                            if (shown.isEmpty()) Box(Modifier.weight(1f).fillMaxWidth()) {
                                EmptyState(
                                    if (query.isNotBlank()) "No match" else if (view == ReadingView.ARCHIVED) "Archive is empty" else if (view == ReadingView.UNREAD) "All read" else "Nothing here",
                                    if (query.isNotBlank()) "Nothing in this view matches “$query”. Try another word, or switch the filter above."
                                    else if (view == ReadingView.ARCHIVED) "Swipe an article to the left to archive it. It stays on the phone, out of the way."
                                    else "Switch the filter above to see the rest.",
                                )
                            } else PullToRefreshBox(isRefreshing = model.checking, onRefresh = { scope.launch { snackbar.showSnackbar(model.checkArticles()) } }, modifier = Modifier.weight(1f).fillMaxWidth()) {
                                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                    items(shown, key = { it.id }) { a ->
                                        val unread = model.readTick >= 0 && !model.articles.isRead(a.id)
                                        val inArchive = view == ReadingView.ARCHIVED
                                        val dismiss = rememberSwipeToDismissBoxState(confirmValueChange = { v ->
                                            when (v) {
                                                SwipeToDismissBoxValue.EndToStart -> { if (inArchive) deleteWithUndo(a.id) else archiveWithUndo(a.id); true }
                                                SwipeToDismissBoxValue.StartToEnd -> { model.toggleRead(a.id); false }
                                                else -> false
                                            }
                                        })
                                        SwipeToDismissBox(
                                            state = dismiss,
                                            modifier = if (LocalReduceMotion.current) Modifier else Modifier.animateItem(),
                                            backgroundContent = {
                                                val right = dismiss.dismissDirection == SwipeToDismissBoxValue.StartToEnd
                                                Box(
                                                    Modifier.fillMaxSize().background(if (right) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.errorContainer, MaterialTheme.shapes.medium).padding(horizontal = 24.dp),
                                                    contentAlignment = if (right) Alignment.CenterStart else Alignment.CenterEnd,
                                                ) {
                                                    if (right) Icon(if (unread) Icons.Filled.DoneAll else Icons.Filled.MarkEmailUnread, contentDescription = if (unread) "Mark as read" else "Mark as unread")
                                                    else if (inArchive) Icon(Icons.Filled.Delete, contentDescription = "Delete", tint = MaterialTheme.colorScheme.onErrorContainer)
                                                    else Icon(Icons.Filled.Archive, contentDescription = "Archive", tint = MaterialTheme.colorScheme.onErrorContainer)
                                                }
                                            },
                                        ) {
                                            AishCard(
                                                onClick = { onSelect(a.id); model.articles.markRead(a.id) },
                                                // The swipe gestures as TalkBack actions (swiping is not reachable without sight or fine motor control).
                                                modifier = Modifier.fillMaxWidth().semantics {
                                                    customActions = listOf(
                                                        CustomAccessibilityAction(if (unread) "Mark as read" else "Mark as unread") { model.toggleRead(a.id); true },
                                                        CustomAccessibilityAction(if (inArchive) "Delete" else "Archive") { if (inArchive) deleteWithUndo(a.id) else archiveWithUndo(a.id); true },
                                                    )
                                                }, 
                                                tone = if (a.id == selected) CardTone.Selected else CardTone.Outlined,
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
                    }
                },
                detail = { current?.let { ArticleReader(model, it.id, onDelete = deleteWithUndo, onArchive = archiveWithUndo, onOpenWeb = onOpenWeb) } },
                empty = { EmptyState("Pick an article", "Choose an article from the list to read it here.") },
            )
        }
    }
}

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun ArticleReader(model: AppModel, id: String, onDelete: (String) -> Unit, onArchive: (String) -> Unit, onOpenWeb: (String) -> Unit) {
    val context = LocalContext.current
    var sent by remember(id) { mutableStateOf(false) }
    var speedReading by remember(id) { mutableStateOf(false) }
    var wpm by remember { mutableStateOf(model.store.readerWpm) }
    var version by remember(id) { mutableIntStateOf(0) }   // bumped when the stored article changes (a summary was added)
    val article = remember(id, version) { model.articles.load(id) }
    var summarizing by remember(id) { mutableStateOf(false) }
    var summaryNote by remember(id) { mutableStateOf("") }
    var remindMenu by remember(id) { mutableStateOf(false) }
    var moreMenu by remember(id) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val notifPermission = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { }
    val voice = remember(id) { ReadAloud(context, model.store.ttsRate) { model.store.ttsRate = it } }
    DisposableEffect(id) { onDispose { voice.shutdown() } }
    val summarize: () -> Unit = {
        if (!summarizing) {
            val a = article
            if (a != null) {
                summarizing = true; summaryNote = "Summarizing on this phone…"
                scope.launch {
                    val page = Page(a.title, a.blocks.map { it.type to it.text }, a.lang)
                    val result = withContext(Dispatchers.Default) {
                        runCatching { PageSummary.summarize(context, page, progress = { i, n -> summaryNote = if (n > 1) "Part $i of $n…" else "Summarizing on this phone…" }) }.getOrNull()
                    }
                    if (result != null && model.articles.setSummary(id, result.text, result.passages)) { version++; summaryNote = "" }
                    else summaryNote = "The model could not summarize this article."
                    summarizing = false
                }
            }
        }
    }
    LaunchedEffect(id) { model.articles.markRead(id) }
    if (article == null) { EmptyState("This article could not be opened", "It may have been removed from this phone."); return }
    var mineTick by remember(id) { mutableIntStateOf(0) }   // bumped when the reader marks or unmarks a paragraph
    val mine = remember(id, mineTick) { model.articles.userHighlights(id).map { Highlight(false, it) } }
    val allHighlights = remember(article, mine) { article.highlights + mine.filter { m -> article.highlights.none { it.text == m.text } } }
    val placed = remember(id, allHighlights) { Highlighter.place(article.blocks, allHighlights) }
    val archived = model.readTick >= 0 && model.articles.isArchived(id)
    val scale = model.readerScale   // set in the reader sheet or Settings → Accessibility
    var sheet by remember(id) { mutableStateOf(false) }
    val look = ReaderLook.colors(model.readerTheme)
    val style = ReaderStyle(ReaderLook.family(model.readerFont), model.readerSpacing)
    val density = androidx.compose.ui.platform.LocalDensity.current
    androidx.compose.runtime.CompositionLocalProvider(
        androidx.compose.ui.platform.LocalDensity provides androidx.compose.ui.unit.Density(density.density, density.fontScale * scale),
        LocalReaderStyle provides style,
    ) {
    androidx.compose.material3.Surface(Modifier.fillMaxSize(), color = look?.first ?: MaterialTheme.colorScheme.surface, contentColor = look?.second ?: MaterialTheme.colorScheme.onSurface) {
    ReadingColumn {
      Column(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 40.dp)) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(article.title.ifBlank { article.url }, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, modifier = Modifier.semantics { heading() })
                    val meta = listOf(article.byline, article.site).filter { it.isNotBlank() }.joinToString(" · ")
                    if (meta.isNotEmpty()) Text(meta, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            item {
                androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    val playing = voice.state != ReadAloud.State.IDLE
                    AssistChip(shape = PillShape, 
                        modifier = Modifier.semantics {
                            stateDescription = when (voice.state) {
                                ReadAloud.State.PLAYING -> "Playing, sentence ${voice.index + 1} of ${voice.total}"
                                ReadAloud.State.PAUSED -> "Paused at sentence ${voice.index + 1} of ${voice.total}"
                                else -> "Not playing"
                            }
                        },
                        onClick = {
                            if (playing) voice.toggle() else voice.start(ReadAloudUnits.article(article.title, article.blocks), article.lang)
                        },
                        label = { Text(when (voice.state) { ReadAloud.State.PLAYING -> "Pause"; ReadAloud.State.PAUSED -> "Resume"; else -> "Listen" }) },
                        leadingIcon = { Icon(if (voice.state == ReadAloud.State.PLAYING) Icons.Filled.Pause else if (voice.state == ReadAloud.State.PAUSED) Icons.Filled.PlayArrow else Icons.Filled.VolumeUp, null) },
                    )
                    if (playing) {
                        AssistChip(shape = PillShape, onClick = { voice.cycleRate() }, label = { Text(if (voice.rate == 1f) "1×" else "${voice.rate}×") }, leadingIcon = { Icon(Icons.Filled.Speed, null) })
                        AssistChip(shape = PillShape, onClick = { voice.stop() }, label = { Text("Stop · ${voice.index + 1}/${voice.total}") }, leadingIcon = { Icon(Icons.Filled.Close, null) })
                    }
                    if (LocalLlm.installed(context)) AssistChip(shape = PillShape, 
                        onClick = { summarize() },
                        label = { Text(if (summarizing) summaryNote else if (article.summary.isBlank()) "Summarize" else "Summarize again", modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) },
                        leadingIcon = { Icon(Icons.Filled.AutoAwesome, null) },
                    )
                    // Everything else lives behind ⋯ so the top of the article stays calm.
                    Box {
                        AssistChip(shape = PillShape, onClick = { moreMenu = true }, label = { Text("More") }, leadingIcon = { Icon(Icons.Filled.MoreVert, null) })
                        DropdownMenu(expanded = moreMenu, onDismissRequest = { moreMenu = false; remindMenu = false }) {
                            if (remindMenu) {
                                for (o in ReminderTimes.options(java.time.ZonedDateTime.now())) DropdownMenuItem(
                                    text = { Text(o.label) },
                                    onClick = {
                                        moreMenu = false; remindMenu = false
                                        Reminders.schedule(context, o.delayMs, article.title, article.url, id)
                                        android.widget.Toast.makeText(context, "I will remind you: ${o.label.lowercase()}", android.widget.Toast.LENGTH_SHORT).show()
                                    },
                                )
                            } else {
                                DropdownMenuItem(text = { Text("Speed read") }, leadingIcon = { Icon(Icons.Filled.Speed, null) }, onClick = { moreMenu = false; voice.stop(); speedReading = true })
                                DropdownMenuItem(text = { Text("Text & layout") }, leadingIcon = { Icon(Icons.Filled.TextIncrease, null) }, onClick = { moreMenu = false; sheet = true })
                                DropdownMenuItem(text = { Text("Copy Markdown") }, leadingIcon = { Icon(Icons.Filled.ContentCopy, null) }, onClick = {
                                    moreMenu = false
                                    val cm = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                                    cm.setPrimaryClip(android.content.ClipData.newPlainText(article.title, ArticleMarkdown.render(article.copy(highlights = allHighlights))))
                                    android.widget.Toast.makeText(context, "Copied as Markdown", android.widget.Toast.LENGTH_SHORT).show()
                                })
                                DropdownMenuItem(text = { Text("Share .md") }, leadingIcon = { Icon(Icons.Filled.Description, null) }, onClick = {
                                    moreMenu = false
                                    shareText(context, ArticleMarkdown.fileName(article.title, article.aid), ArticleMarkdown.render(article.copy(highlights = allHighlights)))
                                })
                                DropdownMenuItem(text = { Text("Remind me") }, leadingIcon = { Icon(Icons.Filled.Alarm, null) }, onClick = {
                                    if (android.os.Build.VERSION.SDK_INT >= 33 && !Reminders.canNotify(context)) notifPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                                    remindMenu = true
                                })
                                DropdownMenuItem(
                                    text = { Text(if (archived) "Unarchive" else "Archive") },
                                    leadingIcon = { Icon(if (archived) Icons.Filled.Unarchive else Icons.Filled.Archive, null) },
                                    onClick = { moreMenu = false; if (archived) model.setArchived(id, false) else onArchive(id) },
                                )
                            }
                        }
                    }
                }
            }
            if (article.summary.isNotBlank()) item {
                AishCard(Modifier.fillMaxWidth(), tone = CardTone.Summary) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(if (article.local) "Summary · made on this phone" else "AISH summary", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                        PlainText(article.summary)
                    }
                }
            }
            item { HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant) }
            items(article.blocks.size) { i ->
                val block = article.blocks[i]
                BlockView(block, placed[i] ?: emptyList(), onLongPress = {
                    val on = model.articles.toggleHighlight(id, block.text)
                    mineTick++
                    android.widget.Toast.makeText(context, if (on) "Highlighted" else "Highlight removed", android.widget.Toast.LENGTH_SHORT).show()
                })
            }
            if (article.truncated) item { Text("This long article was shortened to fit. Tap Read original for the rest.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            if (allHighlights.isNotEmpty()) item { Highlights(allHighlights) }
            if (allHighlights.isEmpty() && article.blocks.isNotEmpty()) item { Text("Tip: press and hold a paragraph to highlight it.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        ActionBar(
            primary = BarAction(Icons.Filled.OpenInBrowser, "Read original") { onOpenWeb(article.url) },
            secondary = listOfNotNull(
                if (article.summary.isNotBlank() || allHighlights.isNotEmpty()) BarAction(Icons.Filled.Share, "Share") { shareText(context, article.title, PageSummary.shareText(article.title, article.summary, article.url, allHighlights.map { it.text })) } else null,
                if (model.pairing != null && article.local) BarAction(Icons.AutoMirrored.Filled.Send, if (sent) "Sent" else "Send to the browser", enabled = !sent) { SendWorker.enqueue(context, article.url); sent = true } else null,
                BarAction(Icons.Filled.Delete, "Delete") { onDelete(id) },
            ),
        )
      }
    }
    }
    }
    if (sheet) ReaderSheet(model) { sheet = false }
    if (speedReading) SpeedReadDialog(
        words = remember(id) { Rsvp.words(article.blocks) }, wpm = wpm,
        onWpm = { wpm = it.coerceIn(Rsvp.MIN_WPM, Rsvp.MAX_WPM); model.store.readerWpm = wpm },
        onClose = { speedReading = false },
    )
}

@Composable
private fun Highlights(list: List<Highlight>) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 16.dp)) {
        Text("Highlights", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
        for (h in list) {
            val (bg, fg) = if (h.ghost) MaterialTheme.colorScheme.secondaryContainer to MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.tertiaryContainer to MaterialTheme.colorScheme.onTertiaryContainer
            Card(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.medium, colors = CardDefaults.cardColors(containerColor = bg, contentColor = fg)) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(if (h.ghost) "AI highlight" else "Your highlight", style = MaterialTheme.typography.labelSmall)
                    Text(h.text, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}
