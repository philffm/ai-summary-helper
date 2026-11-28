package eu.byphil.aishcompanion

import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import android.text.format.DateUtils
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.FullscreenExit
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Width of the window in dp. It changes when a foldable is opened or closed, or the app is resized (the activity handles those changes itself, so nothing restarts). */
@Composable
fun windowWidthDp(): Int = LocalConfiguration.current.screenWidthDp

/** Material 3 window width classes: compact < 600 dp, medium 600–839 dp, expanded ≥ 840 dp. */
enum class WidthClass { Compact, Medium, Expanded }

@Composable
fun widthClass(): WidthClass = windowWidthDp().let { if (it >= 840) WidthClass.Expanded else if (it >= 600) WidthClass.Medium else WidthClass.Compact }

/** From the medium class up (the Fold's inner screen, tablets, landscape): navigation rail and list + detail side by side. */
@Composable
fun isWide(): Boolean = widthClass() != WidthClass.Compact

/**
 * List and detail. Wide: side by side with a divider. Narrow: the list, and the detail on top once something is selected
 * (system back returns to the list). The selection lives with the caller, so folding or unfolding keeps the open item.
 */
@Composable
fun ListDetail(hasSelection: Boolean, onBackToList: () -> Unit, list: @Composable () -> Unit, detail: @Composable () -> Unit, empty: @Composable () -> Unit, focus: Boolean = false, onExitFocus: () -> Unit = {}) {
    val wide = isWide()
    // Folding or unfolding crosses the 600 dp line: one light tick, and the list slides in beside the open item instead of the layout just jumping.
    // `seenWide` is null on the very first composition (app start on a wide screen): no tick and no animation then.
    val haptic = androidx.compose.ui.platform.LocalHapticFeedback.current
    val reduceMotion = LocalReduceMotion.current
    var seenWide by remember { mutableStateOf<Boolean?>(null) }
    androidx.compose.runtime.LaunchedEffect(wide) {
        if (seenWide != null && seenWide != wide) haptic.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.TextHandleMove)
        seenWide = wide
    }
    if (wide) {
        // Focus (reading full screen): the list steps aside and the open item gets the whole width; back or the toggle brings the list back.
        val focused = focus && hasSelection
        BackHandler(enabled = focused, onBack = onExitFocus)
        // The list pane animates in only right after a fold/unfold (seenWide == false), never at start-up or when the user asked for less motion.
        val listIn = remember { androidx.compose.animation.core.MutableTransitionState(seenWide != false || reduceMotion) }
        androidx.compose.runtime.SideEffect { listIn.targetState = true }
        Row(Modifier.fillMaxSize()) {
            if (!focused) {
                androidx.compose.animation.AnimatedVisibility(
                    visibleState = listIn,
                    enter = androidx.compose.animation.expandHorizontally(androidx.compose.animation.core.tween(260), expandFrom = Alignment.Start) +
                        androidx.compose.animation.fadeIn(androidx.compose.animation.core.tween(260)),
                    exit = androidx.compose.animation.ExitTransition.None,
                ) {
                    Row(Modifier.fillMaxHeight()) {
                        Box(Modifier.width(if (widthClass() == WidthClass.Expanded) 400.dp else 340.dp).fillMaxHeight()) { list() }
                        VerticalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
            }
            Box(Modifier.weight(1f).fillMaxHeight()) { if (hasSelection) detail() else empty() }
        }
    } else {
        BackHandler(enabled = hasSelection, onBack = onBackToList)
        // Fade-through between list and detail (no motion when the user asked for less).
        val reduce = LocalReduceMotion.current
        androidx.compose.animation.AnimatedContent(
            targetState = hasSelection, label = "list-detail",
            transitionSpec = {
                if (reduce) androidx.compose.animation.ContentTransform(androidx.compose.animation.EnterTransition.None, androidx.compose.animation.ExitTransition.None)
                else androidx.compose.animation.ContentTransform(
                    targetContentEnter = androidx.compose.animation.fadeIn(androidx.compose.animation.core.tween(210, delayMillis = 90)) +
                        androidx.compose.animation.scaleIn(androidx.compose.animation.core.tween(210, delayMillis = 90), initialScale = 0.94f),
                    initialContentExit = androidx.compose.animation.fadeOut(androidx.compose.animation.core.tween(90)),
                )
            },
        ) { showDetail -> if (showDetail) detail() else list() }
    }
}

/** The toggle for reading full screen, shown in the top bar of a wide screen while an item is open. */
@Composable
fun FocusToggle(focus: Boolean, onToggle: () -> Unit) {
    androidx.compose.material3.IconButton(onClick = onToggle) {
        androidx.compose.material3.Icon(
            if (focus) Icons.Filled.FullscreenExit else Icons.Filled.Fullscreen,
            contentDescription = if (focus) "Show the list again" else "Read full screen",
        )
    }
}

/** A centred reading column: wide screens do not stretch lines across the whole display. */
@Composable
fun ReadingColumn(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Box(Modifier.widthIn(max = 680.dp).fillMaxSize()) { content() }
    }
}

@Composable
fun EmptyState(title: String, body: String) {
    Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
    }
}

fun relativeTime(millis: Long): String =
    if (millis <= 0) "" else DateUtils.getRelativeTimeSpanString(millis, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS, DateUtils.FORMAT_ABBREV_RELATIVE).toString()

/** Small dialog with one or two text fields. [onConfirm] gets the values; the dialog closes itself. */
@Composable
fun FieldDialog(title: String, label: String, initial: String = "", label2: String? = null, initial2: String = "", confirm: String, error: String? = null, busy: Boolean = false, onDismiss: () -> Unit, onConfirm: (String, String) -> Unit) {
    var a by remember { mutableStateOf(initial) }
    var b by remember { mutableStateOf(initial2) }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(a, { a = it }, label = { Text(label) }, singleLine = true, modifier = Modifier.fillMaxWidth(), isError = error != null)
                if (label2 != null) OutlinedTextField(b, { b = it }, label = { Text(label2) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                if (error != null) Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = { TextButton(onClick = { onConfirm(a, b) }, enabled = !busy && a.isNotBlank()) { Text(if (busy) "Working…" else confirm) } },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("Cancel") } },
    )
}

/** A screen's top bar: large and folding away while scrolling where [large], else the plain one. */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun FoldingBar(
    large: Boolean, folding: androidx.compose.material3.TopAppBarScrollBehavior, title: @Composable () -> Unit,
    navigationIcon: @Composable () -> Unit = {}, actions: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = {},
) {
    if (large) androidx.compose.material3.LargeTopAppBar(title = title, navigationIcon = navigationIcon, actions = actions, scrollBehavior = folding,
        colors = androidx.compose.material3.TopAppBarDefaults.topAppBarColors(containerColor = groupGround(), scrolledContainerColor = groupGround()))
    else androidx.compose.material3.TopAppBar(title = title, navigationIcon = navigationIcon, actions = actions)
}

// ── lists: rows that belong together ──

/** A row's shape within its group: round at the group's two ends, barely between. */
fun groupShape(index: Int, count: Int): androidx.compose.ui.graphics.Shape {
    val top = if (index == 0) 20.dp else 4.dp
    val bottom = if (index == count - 1) 20.dp else 4.dp
    return RoundedCornerShape(topStart = top, topEnd = top, bottomStart = bottom, bottomEnd = bottom)
}

/** The ground of a screen of grouped rows, and the rows on it: the rows are the lighter of the two in light and in dark. */
@Composable
fun groupGround(): Color = if (MaterialTheme.colorScheme.surface.luminance() < 0.5f) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.surfaceContainer

@Composable
fun groupRow(): Color = if (MaterialTheme.colorScheme.surface.luminance() < 0.5f) MaterialTheme.colorScheme.surfaceContainerHigh else MaterialTheme.colorScheme.surfaceContainerLowest

// ── reading: text with highlights ──

/** AI passages sit on the secondary container, the reader's own marks on the tertiary container: both are theme roles, so dark and high contrast follow. */
@Composable
private fun markColors(ghost: Boolean): Pair<Color, Color> =
    if (ghost) MaterialTheme.colorScheme.secondaryContainer to MaterialTheme.colorScheme.onSecondaryContainer
    else MaterialTheme.colorScheme.tertiaryContainer to MaterialTheme.colorScheme.onTertiaryContainer

@Composable
fun markedText(text: String, marks: List<Mark>): AnnotatedString {
    val user = markColors(false); val ghost = markColors(true)
    return buildAnnotatedString {
        var at = 0
        for (m in marks) {
            if (m.start < at || m.end > text.length) continue
            append(text.substring(at, m.start))
            val (bg, fg) = if (m.ghost) ghost else user
            withStyle(SpanStyle(background = bg, color = fg)) { append(text.substring(m.start, m.end)) }
            at = m.end
        }
        append(text.substring(at))
    }
}

/** What the selection menu of a paragraph can do: mark the selected words, or remove the reader's own marks under them. */
class Marking(val highlight: (start: Int, end: Int) -> Unit, val remove: (List<Mark>) -> Unit)

/** One article block. [marks] are the highlights found in this block's text; with [marking] its words can be selected and marked. */
@Composable
fun BlockView(b: Block, marks: List<Mark> = emptyList(), marking: Marking? = null) {
    BlockContent(b, markedText(b.text, marks), marks, marking.takeIf { b.type != "pre" })
}

/** A paragraph in a platform TextView: the system's own selection handles and menu, with "Highlight" added to it. */
@Composable
private fun SelectableText(text: String, marks: List<Mark>, marking: Marking, style: androidx.compose.ui.text.TextStyle, color: Color, modifier: Modifier = Modifier) {
    val user = markColors(false); val ghost = markColors(true)
    val resolver = androidx.compose.ui.platform.LocalFontFamilyResolver.current
    val typeface by resolver.resolve(style.fontFamily, style.fontWeight ?: FontWeight.Normal, style.fontStyle ?: FontStyle.Normal)
    val density = androidx.compose.ui.platform.LocalDensity.current
    val sizeSp = if (style.fontSize.isSp) style.fontSize.value else 17f
    val linePx = with(density) { if (style.lineHeight.isSp) style.lineHeight.roundToPx() else 0 }
    val spanned = remember(text, marks, user, ghost) {
        android.text.SpannableString(text).apply {
            for (m in marks) {
                if (m.start < 0 || m.end > text.length || m.start >= m.end) continue
                val (bg, fg) = if (m.ghost) ghost else user
                setSpan(android.text.style.BackgroundColorSpan(bg.toArgb()), m.start, m.end, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                setSpan(android.text.style.ForegroundColorSpan(fg.toArgb()), m.start, m.end, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            }
        }
    }
    val current = androidx.compose.runtime.rememberUpdatedState(marks to marking)
    androidx.compose.ui.viewinterop.AndroidView(
        modifier = modifier.fillMaxWidth(),
        factory = { context ->
            android.widget.TextView(context).apply {
                setTextIsSelectable(true)
                includeFontPadding = false
                customSelectionActionModeCallback = object : android.view.ActionMode.Callback {
                    private val add = 0x4b41; private val drop = 0x4b42
                    private fun own() = current.value.first.filter { !it.ghost && it.start < selectionEnd && it.end > selectionStart }
                    override fun onCreateActionMode(mode: android.view.ActionMode, menu: android.view.Menu): Boolean {
                        menu.add(android.view.Menu.NONE, add, 0, "Highlight")
                        menu.add(android.view.Menu.NONE, drop, 1, "Remove highlight")
                        return true
                    }
                    override fun onPrepareActionMode(mode: android.view.ActionMode, menu: android.view.Menu): Boolean {
                        menu.findItem(drop)?.isVisible = own().isNotEmpty()
                        return true
                    }
                    override fun onActionItemClicked(mode: android.view.ActionMode, item: android.view.MenuItem): Boolean {
                        val from = minOf(selectionStart, selectionEnd); val to = maxOf(selectionStart, selectionEnd)
                        when (item.itemId) {
                            add -> current.value.second.highlight(from, to)
                            drop -> current.value.second.remove(own())
                            else -> return false
                        }
                        performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS)
                        mode.finish()
                        return true
                    }
                    override fun onDestroyActionMode(mode: android.view.ActionMode) {}
                }
            }
        },
        update = { view ->
            view.typeface = typeface as? android.graphics.Typeface
            view.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, sizeSp)
            view.setTextColor(color.toArgb())
            if (linePx > 0) {
                val natural = view.paint.getFontMetricsInt(null)
                view.setLineSpacing((linePx - natural).toFloat(), 1f)
            }
            // setting the same text again would drop a selection the reader is making
            if (view.tag != spanned) { view.tag = spanned; view.text = spanned }
        },
    )
}

@Composable
private fun BlockContent(b: Block, text: androidx.compose.ui.text.AnnotatedString, marks: List<Mark>, marking: Marking?) {
    val rs = LocalReaderStyle.current
    val body = MaterialTheme.typography.bodyLarge.copy(fontFamily = rs.family ?: MaterialTheme.typography.bodyLarge.fontFamily)
    val line = (27 * rs.spacing).sp
    val plain = androidx.compose.material3.LocalContentColor.current
    @Composable
    fun words(style: androidx.compose.ui.text.TextStyle, modifier: Modifier = Modifier, color: Color = plain) {
        if (marking == null) Text(text, style = style, color = color, modifier = modifier)
        else SelectableText(b.text, marks, marking, style, color, modifier)
    }
    when (b.type) {
        "h1" -> words(MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold), Modifier.semantics { heading() }.padding(top = 12.dp))
        "h2" -> words(MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold), Modifier.semantics { heading() }.padding(top = 10.dp))
        "h3" -> words(MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold), Modifier.semantics { heading() }.padding(top = 6.dp))
        "li" -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("•", style = MaterialTheme.typography.bodyLarge)
            words(body.copy(fontSize = 17.sp, lineHeight = line), Modifier.weight(1f))
        }
        "q" -> Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.width(3.dp).fillMaxHeight().background(MaterialTheme.colorScheme.primary, RoundedCornerShape(2.dp)))
            words(body.copy(fontSize = 17.sp, fontStyle = FontStyle.Italic, lineHeight = line), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        "pre" -> Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.small) {
            Text(b.text, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall, modifier = Modifier.horizontalScroll(rememberScrollState()).padding(12.dp))
        }
        else -> words(body.copy(fontSize = 17.sp, lineHeight = (28 * rs.spacing).sp))
    }
}

/** Plain text from a feed or the AI summary: blank lines separate paragraphs; lines starting with "- " or "• " are list items. */
@Composable
fun PlainText(text: String) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        text.split("\n\n").map { it.trim() }.filter { it.isNotEmpty() }.forEach { para ->
            val lines = para.split("\n")
            if (lines.all { it.startsWith("- ") || it.startsWith("• ") }) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    lines.forEach { l ->
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("•", style = MaterialTheme.typography.bodyLarge)
                            Text(l.substring(2).trim(), style = MaterialTheme.typography.bodyLarge, lineHeight = 26.sp, modifier = Modifier.weight(1f))
                        }
                    }
                }
            } else if (lines.any { it.startsWith("- ") }) {
                // a lead-in line followed by a list
                lines.forEach { l ->
                    if (l.startsWith("- ")) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { Text("•"); Text(l.substring(2).trim(), lineHeight = 26.sp, modifier = Modifier.weight(1f)) }
                    else Text(l, style = MaterialTheme.typography.bodyLarge, lineHeight = 26.sp)
                }
            } else {
                Text(para, style = MaterialTheme.typography.bodyLarge, lineHeight = 26.sp)
            }
        }
    }
}

@Composable
fun InfoCard(title: String, body: String, isError: Boolean = false, content: (@Composable () -> Unit)? = null) {
    Card(
        Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.small,
        colors = CardDefaults.cardColors(containerColor = if (isError) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surface),
        border = androidx.compose.foundation.BorderStroke(1.dp, if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(body, style = MaterialTheme.typography.bodyMedium)
            content?.invoke()
        }
    }
}

/** Opens the system share sheet (WhatsApp, Signal, mail, ...) with plain text. */
fun shareText(context: android.content.Context, subject: String, text: String) {
    val send = android.content.Intent(android.content.Intent.ACTION_SEND).setType("text/plain")
        .putExtra(android.content.Intent.EXTRA_SUBJECT, subject).putExtra(android.content.Intent.EXTRA_TEXT, text)
    context.startActivity(android.content.Intent.createChooser(send, null).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
}

/** The actions of a screen, at the bottom where the thumb is: a tonal bar that wraps its buttons. */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun BottomActions(content: @Composable androidx.compose.foundation.layout.FlowRowScope.() -> Unit) {
    androidx.compose.material3.Surface(color = MaterialTheme.colorScheme.surfaceContainer, tonalElevation = 2.dp, modifier = Modifier.fillMaxWidth()) {
        androidx.compose.foundation.layout.FlowRow(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, if (Handed.left) Alignment.Start else Alignment.End), verticalArrangement = Arrangement.spacedBy(4.dp),
            content = content,
        )
    }
}

/** Handedness: right-handed puts the main actions at the right of the bottom bars, left-handed at the left. Read wherever a bar is laid out. */
object Handed {
    var left by androidx.compose.runtime.mutableStateOf(false)
}

/** One round button of an [ActionBar]. */
class BarAction(
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val desc: String,
    val enabled: Boolean = true,
    /** Work in progress: a ring around the icon, filling up when [progress] is known (0..1), spinning when null. */
    val busy: Boolean = false,
    val progress: Float? = null,
    /** Finished: a green check instead of the icon. */
    val done: Boolean = false,
    val onClick: () -> Unit,
)

/**
 * The bottom bar of a screen: round icon buttons, the primary action at the thumb's edge (right-handed: far right, left-handed: far left)
 * and the secondary ones beside it, most useful nearest the thumb.
 */
@Composable
fun ActionBar(primary: BarAction?, secondary: List<BarAction>) {
    val left = Handed.left
    // A Material 3 bottom app bar: the container, tonal elevation and height come from the component; no inset padding because
    // the screens sit above the navigation bar already.
    androidx.compose.material3.BottomAppBar(windowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0)) {
        androidx.compose.foundation.layout.Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp, if (left) Alignment.Start else Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val second: @Composable () -> Unit = {
                for (a in if (left) secondary else secondary.reversed()) {
                    androidx.compose.material3.IconButton(onClick = a.onClick, enabled = a.enabled) { Icon(a.icon, contentDescription = a.desc) }
                }
            }
            val first: @Composable () -> Unit = {
                if (primary != null) {
                    val active = primary.enabled || primary.busy
                    androidx.compose.material3.FloatingActionButton(
                        onClick = { if (active) primary.onClick() },
                        containerColor = if (primary.done) MaterialTheme.colorScheme.primaryContainer else if (active) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
                        contentColor = if (active) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                        elevation = androidx.compose.material3.FloatingActionButtonDefaults.bottomAppBarFabElevation(),
                    ) {
                        when {
                            primary.done -> Icon(Icons.Filled.Check, contentDescription = primary.desc)
                            primary.busy -> Box(contentAlignment = Alignment.Center) {
                                val p = primary.progress
                                if (p != null) androidx.compose.material3.CircularProgressIndicator(progress = { p.coerceIn(0.05f, 1f) }, modifier = Modifier.size(32.dp), strokeWidth = 3.dp, color = androidx.compose.material3.LocalContentColor.current)
                                else androidx.compose.material3.CircularProgressIndicator(modifier = Modifier.size(32.dp), strokeWidth = 3.dp, color = androidx.compose.material3.LocalContentColor.current)
                                Icon(primary.icon, contentDescription = primary.desc, modifier = Modifier.size(16.dp))
                            }
                            else -> Icon(primary.icon, contentDescription = primary.desc)
                        }
                    }
                }
            }
            if (left) { first(); second() } else { second(); first() }
        }
    }
}
