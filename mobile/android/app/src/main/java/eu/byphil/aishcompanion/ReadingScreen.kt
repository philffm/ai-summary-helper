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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.material3.SegmentedButton
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
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
    // the list has a large title that folds away while scrolling; an open article stands for itself
    val folding = androidx.compose.material3.TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    val large = !isWide() && current == null
    Scaffold(
        modifier = if (large) Modifier.nestedScroll(folding.nestedScrollConnection) else Modifier,
        containerColor = if (large) groupGround() else MaterialTheme.colorScheme.surface,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            FoldingBar(
                large, folding,
                { if (isWide() || current == null) Text("Reading list", fontWeight = FontWeight.Bold) },
                { if (!isWide() && current != null) IconButton(onClick = { onSelect("") }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
                {
                    if (isWide() && current != null) FocusToggle(model.focusReading) { model.focusReading = !model.focusReading }
                    if (model.articleList.isNotEmpty() && (isWide() || current == null)) IconButton(onClick = { searching = !searching; if (!searching) query = "" }) {
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
                            val views = listOf(ReadingView.ALL to "All", ReadingView.UNREAD to "Unread", ReadingView.ARCHIVED to "Archive")
                            androidx.compose.material3.SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                                views.forEachIndexed { i, (v, label) ->
                                    SegmentedButton(selected = view == v, onClick = { view = v }, shape = androidx.compose.material3.SegmentedButtonDefaults.itemShape(i, views.size), icon = {}) { Text(label, maxLines = 1) }
                                }
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
                                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    itemsIndexed(shown, key = { _, a -> a.id }) { row, a ->
                                        val shape = groupShape(row, shown.size)
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
                                                    Modifier.fillMaxSize().background(if (right) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.errorContainer, shape).padding(horizontal = 24.dp),
                                                    contentAlignment = if (right) Alignment.CenterStart else Alignment.CenterEnd,
                                                ) {
                                                    if (right) Icon(if (unread) Icons.Filled.DoneAll else Icons.Filled.MarkEmailUnread, contentDescription = if (unread) "Mark as read" else "Mark as unread")
                                                    else if (inArchive) Icon(Icons.Filled.Delete, contentDescription = "Delete", tint = MaterialTheme.colorScheme.onErrorContainer)
                                                    else Icon(Icons.Filled.Archive, contentDescription = "Archive", tint = MaterialTheme.colorScheme.onErrorContainer)
                                                }
                                            },
                                        ) {
                                            androidx.compose.material3.Surface(
                                                onClick = { onSelect(a.id); model.articles.markRead(a.id) },
                                                // The swipe gestures as TalkBack actions (swiping is not reachable without sight or fine motor control).
                                                modifier = Modifier.fillMaxWidth().semantics {
                                                    customActions = listOf(
                                                        CustomAccessibilityAction(if (unread) "Mark as read" else "Mark as unread") { model.toggleRead(a.id); true },
                                                        CustomAccessibilityAction(if (inArchive) "Delete" else "Archive") { if (inArchive) deleteWithUndo(a.id) else archiveWithUndo(a.id); true },
                                                    )
                                                },
                                                shape = shape, color = if (a.id == selected) MaterialTheme.colorScheme.secondaryContainer else groupRow(),
                                            ) {
                                                Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                                    // the dot keeps its room, so that titles stand in one line
                                                    Box(Modifier.padding(top = 8.dp).size(8.dp).background(if (unread) MaterialTheme.colorScheme.primary else Color.Transparent, CircleShape))
                                                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                                        Text(a.title, style = MaterialTheme.typography.titleMedium, fontFamily = androidx.compose.ui.text.font.FontFamily.Serif, fontWeight = if (unread) FontWeight.Bold else FontWeight.Normal, maxLines = if (LocalDensity.current.fontScale >= 1.5f) 6 else 3, overflow = TextOverflow.Ellipsis)
                                                        Text(listOf(a.site, relativeTime(a.receivedAt), if (a.local) "Saved on this phone" else "").filter { it.isNotBlank() }.joinToString(" · "), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                                    }
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
    var menu by rememberSaveable(id) { mutableStateOf(false) }
    var menuPage by rememberSaveable { mutableStateOf(ReaderPage.SUMMARY) }
    var recommending by remember(id) { mutableStateOf(false) }
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
                    val page = Page(a.title, a.blocks.filter { it.type != "img" }.map { it.type to it.text }, a.lang)
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
    LaunchedEffect(id) { model.articles.markRead(id); model.store.lastArticle = id }
    if (article == null) { EmptyState("This article could not be opened", "It may have been removed from this phone."); return }
    var mineTick by remember(id) { mutableIntStateOf(0) }   // bumped when the reader marks or unmarks a paragraph
    val mine = remember(id, mineTick) { model.articles.userHighlights(id).map { Highlight(false, it) } }
    val allHighlights = remember(article, mine) { article.highlights + mine.filter { m -> article.highlights.none { it.text == m.text } } }
    val placed = remember(id, allHighlights, mineTick) { Highlighter.place(article.blocks, allHighlights, model.articles.highlightAnchors(id)) }
    val archived = model.readTick >= 0 && model.articles.isArchived(id)
    val scale = model.readerScale   // set in the reader sheet or Settings → Accessibility
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
        val list = androidx.compose.foundation.lazy.rememberLazyListState()
        val spots = remember(article, placed) { DepthTrack.spots(article.blocks, placed) }
        // the items above the first block: title, sender, summary, divider
        val leading = 2 + (if (article.summary.isNotBlank()) 1 else 0) + (if (article.recommendation != null) 1 else 0)
        val onScreen by remember(article) {
            androidx.compose.runtime.derivedStateOf {
                val info = list.layoutInfo
                DepthTrack.window(article.blocks, info.visibleItemsInfo.filter { it.size > 0 }.map {
                    Shown(it.index - leading, ((info.viewportStartOffset - it.offset).toFloat() / it.size).coerceIn(0f, 1f), ((info.viewportEndOffset - it.offset).toFloat() / it.size).coerceIn(0f, 1f))
                })
            }
        }
        val scroll = androidx.compose.runtime.rememberCoroutineScope()
        val still = LocalReduceMotion.current
        androidx.compose.foundation.layout.Box(Modifier.weight(1f).fillMaxWidth()) {
        LazyColumn(Modifier.fillMaxSize(), state = list, verticalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(start = 20.dp, end = if (spots.isEmpty()) 20.dp else 36.dp, top = 12.dp, bottom = 104.dp)) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(article.title.ifBlank { article.url }, style = MaterialTheme.typography.headlineMedium, fontFamily = androidx.compose.ui.text.font.FontFamily.Serif, fontWeight = FontWeight.Bold, modifier = Modifier.semantics { heading() })
                    val meta = listOf(article.byline, article.site).filter { it.isNotBlank() }.joinToString(" · ")
                    if (meta.isNotEmpty()) Text(meta, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            article.recommendation?.let { sent -> item { RecommendationCard(sent) } }
            if (article.summary.isNotBlank()) item {
                AishCard(Modifier.fillMaxWidth(), tone = CardTone.Summary) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(if (article.local) "Summary · made on this phone" else "Kaivo summary", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                        PlainText(article.summary)
                    }
                }
            }
            item { HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant) }
            items(article.blocks.size) { i ->
                val block = article.blocks[i]
                val here = placed[i] ?: emptyList()
                if (block.type == "img") ArticleImage(model.articles.picture(id, block.image), block.text)
                else BlockView(block, here, marking = Marking(
                    highlight = { from, to ->
                        Highlighter.wholeWords(block.text, from, to)?.let { words ->
                            // own marks the selection touches become one with it
                            val touched = here.filter { !it.ghost && it.start < words.last + 1 && it.end > words.first }
                            val start = minOf(words.first, touched.minOfOrNull { it.start } ?: words.first)
                            val end = maxOf(words.last + 1, touched.maxOfOrNull { it.end } ?: 0)
                            model.articles.removeHighlights(id, touched.map { block.text.substring(it.start, it.end) })
                            model.articles.addHighlight(id, block.text.substring(start, end), Highlighter.anchorOf(article.blocks, i), start)
                            mineTick++
                        }
                    },
                    remove = { marks ->
                        val texts = marks.map { block.text.substring(it.start, it.end) }
                        // a mark placed by its words may differ from the stored text in spacing
                        model.articles.removeHighlights(id, model.articles.userHighlights(id).filter { stored -> texts.any { it.split(Regex("\\s+")) == stored.split(Regex("\\s+")) } })
                        mineTick++
                    },
                ))
            }
            if (article.truncated) item { Text("This long article was shortened to fit. Tap Read original for the rest.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            if (allHighlights.isNotEmpty()) item { Highlights(allHighlights) }
            if (allHighlights.isEmpty() && article.blocks.isNotEmpty()) item { Text("Tip: press and hold a word, adjust the selection, then choose Highlight.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        if (spots.isNotEmpty()) DepthRail(
            spots, { onScreen },
            // a third of the screen above the block, so that the highlight is not glued to the top edge
            onSpot = { spot -> scroll.launch { val above = -list.layoutInfo.viewportSize.height / 3; if (still) list.scrollToItem(leading + spot.block, above) else list.animateScrollToItem(leading + spot.block, above) } },
            onSeek = { fraction -> DepthTrack.blockAt(article.blocks, fraction)?.let { block -> scroll.launch { list.scrollToItem(leading + block) } } },
            modifier = Modifier.align(Alignment.CenterEnd).fillMaxHeight().padding(top = 12.dp, bottom = 96.dp),
        )
        // one button for everything else, on the thumb's side; while something is read aloud, pause sits above it
        Column(Modifier.align(if (Handed.left) Alignment.BottomStart else Alignment.BottomEnd).padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (voice.state != ReadAloud.State.IDLE) SmallFloatingActionButton(onClick = { voice.toggle() }) {
                Icon(if (voice.state == ReadAloud.State.PLAYING) Icons.Filled.Pause else Icons.Filled.PlayArrow, contentDescription = if (voice.state == ReadAloud.State.PLAYING) "Pause reading" else "Resume reading")
            }
            FloatingActionButton(onClick = { remindMenu = false; menu = true }) { Icon(Icons.Filled.MoreHoriz, contentDescription = "Reader menu") }
        }
        }
      }
    }
    }
    }
    if (menu) {
        val text = { ArticleMarkdown.render(article.copy(highlights = allHighlights)) }
        val actions = if (remindMenu) ReminderTimes.options(java.time.ZonedDateTime.now()).map { o ->
            ReaderAction(Icons.Filled.Alarm, o.label) {
                Reminders.schedule(context, o.delayMs, article.title, article.url, id)
                android.widget.Toast.makeText(context, "I will remind you: ${o.label.lowercase()}", android.widget.Toast.LENGTH_SHORT).show()
            }
        } else listOfNotNull(
            ReaderAction(Icons.Filled.OpenInBrowser, "Read original") { onOpenWeb(article.url) },
            if (article.url.startsWith("http")) ReaderAction(Icons.AutoMirrored.Filled.Send, "Recommend…") { recommending = true } else null,
            if (article.summary.isNotBlank() || allHighlights.isNotEmpty()) ReaderAction(Icons.Filled.Share, "Share") { shareText(context, article.title, PageSummary.shareText(article.title, article.summary, article.url, allHighlights.map { it.text })) } else null,
            ReaderAction(Icons.Filled.ContentCopy, "Copy Markdown") {
                val cm = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                cm.setPrimaryClip(android.content.ClipData.newPlainText(article.title, text()))
                android.widget.Toast.makeText(context, "Copied as Markdown", android.widget.Toast.LENGTH_SHORT).show()
            },
            ReaderAction(Icons.Filled.Description, "Share .md") { shareText(context, ArticleMarkdown.fileName(article.title, article.aid), text()) },
            ReaderAction(Icons.Filled.Alarm, "Remind me", stays = true) {
                if (android.os.Build.VERSION.SDK_INT >= 33 && !Reminders.canNotify(context)) notifPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                remindMenu = true
            },
            if (model.pairing != null && article.local) ReaderAction(Icons.AutoMirrored.Filled.Send, if (sent) "Sent to the browser" else "Send to the browser") { if (!sent) { SendWorker.enqueue(context, article.url); sent = true } } else null,
            ReaderAction(if (archived) Icons.Filled.Unarchive else Icons.Filled.Archive, if (archived) "Unarchive" else "Archive") { if (archived) model.setArchived(id, false) else onArchive(id) },
            ReaderAction(Icons.Filled.Delete, "Delete", danger = true) { onDelete(id) },
        )
        ReaderMenu(
            model, menuPage, { menuPage = it; remindMenu = false },
            SummaryState(article.summary, article.local, summarizing, summaryNote, LocalLlm.installed(context), summarize), voice,
            onListen = { if (voice.state != ReadAloud.State.IDLE) voice.toggle() else voice.start(ReadAloudUnits.article(article.title, article.blocks), article.lang) },
            onSpeedRead = { menu = false; voice.stop(); speedReading = true },
            actions = actions, onDismiss = { menu = false; remindMenu = false },
        )
    }
    // only the reader's own marks go along, never the AI's suggestions
    if (recommending) RecommendSheet(article, remember(article, mine) { allHighlights.filter { !it.ghost }.map { it.text } }) { recommending = false }
    if (speedReading) SpeedReadDialog(
        text = remember(id) { Rsvp.build(article.blocks) }, wpm = wpm,
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
