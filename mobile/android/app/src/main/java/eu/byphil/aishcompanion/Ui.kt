package eu.byphil.aishcompanion

import android.text.format.DateUtils
import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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

/** From 600 dp up (the Fold's inner screen, tablets, landscape): navigation rail and list + detail side by side. */
@Composable
fun isWide(): Boolean = windowWidthDp() >= 600

/**
 * List and detail. Wide: side by side with a divider. Narrow: the list, and the detail on top once something is selected
 * (system back returns to the list). The selection lives with the caller, so folding or unfolding keeps the open item.
 */
@Composable
fun ListDetail(hasSelection: Boolean, onBackToList: () -> Unit, list: @Composable () -> Unit, detail: @Composable () -> Unit, empty: @Composable () -> Unit) {
    if (isWide()) {
        Row(Modifier.fillMaxSize()) {
            Box(Modifier.width(if (windowWidthDp() >= 840) 400.dp else 340.dp).fillMaxHeight()) { list() }
            VerticalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Box(Modifier.weight(1f).fillMaxHeight()) { if (hasSelection) detail() else empty() }
        }
    } else {
        BackHandler(enabled = hasSelection, onBack = onBackToList)
        if (hasSelection) detail() else list()
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

// ── reading: text with highlights ──

@Composable
private fun markColors(ghost: Boolean): Pair<Color, Color> {
    val dark = MaterialTheme.colorScheme.background.red < 0.3f
    return if (ghost) (if (dark) Color(0xFF1E3A8A) else Color(0xFFCFE3FF)) to MaterialTheme.colorScheme.onSurface
    else (if (dark) Color(0xFF854D0E) else Color(0xFFFDE68A)) to MaterialTheme.colorScheme.onSurface
}

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

/** One article block. [marks] are the highlights found in this block's text. */
@Composable
fun BlockView(b: Block, marks: List<Mark> = emptyList()) {
    val text = markedText(b.text, marks)
    when (b.type) {
        "h1" -> Text(text, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp))
        "h2" -> Text(text, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 10.dp))
        "h3" -> Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 6.dp))
        "li" -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("•", style = MaterialTheme.typography.bodyLarge)
            Text(text, style = MaterialTheme.typography.bodyLarge, fontSize = 17.sp, lineHeight = 27.sp, modifier = Modifier.weight(1f))
        }
        "q" -> Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.width(3.dp).fillMaxHeight().background(MaterialTheme.colorScheme.primary, RoundedCornerShape(2.dp)))
            Text(text, style = MaterialTheme.typography.bodyLarge, fontSize = 17.sp, fontStyle = FontStyle.Italic, lineHeight = 27.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        "pre" -> Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(12.dp)) {
            Text(b.text, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall, modifier = Modifier.horizontalScroll(rememberScrollState()).padding(12.dp))
        }
        else -> Text(text, style = MaterialTheme.typography.bodyLarge, fontSize = 17.sp, lineHeight = 28.sp)
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
        shape = RoundedCornerShape(12.dp),
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
