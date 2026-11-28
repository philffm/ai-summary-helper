package eu.byphil.aishcompanion

import android.content.ClipData
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import java.io.File
import java.util.UUID

/** Writes the page into a folder of its own and hands the words and the file to the system's share sheet. */
fun shareRecommendation(context: Context, r: Recommendation) {
    val words = Recommendation.Words(
        recommendedBy = if (r.from.isEmpty()) "A recommendation for you" else "Recommended by ${r.from}",
        read = "Read the article", hint = "Open this file with Kaivo to save the article with these notes.",
    )
    val root = File(context.cacheDir, "recommend")
    // what was shared before today is of no use any more
    root.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 86_400_000 }?.forEach { it.deleteRecursively() }
    val folder = File(root, UUID.randomUUID().toString()).apply { mkdirs() }
    val file = File(folder, Recommendation.fileName(if (r.from.isEmpty()) "Recommendation" else "Recommendation from ${r.from}"))
    file.writeText(r.page(words))
    val uri = FileProvider.getUriForFile(context, context.packageName + ".files", file)
    // the words first: where an app drops them for the file, the file holds them too
    val send = Intent(Intent.ACTION_SEND).setType("text/html")
        .putExtra(Intent.EXTRA_TEXT, listOf(r.note, r.url).filter { it.isNotEmpty() }.joinToString("\n"))
        .putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    send.clipData = ClipData.newRawUri(file.name, uri)
    context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

@Composable
private fun Choice(label: String, on: Boolean, change: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().toggleable(on, role = Role.Switch, onValueChange = change).padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Switch(on, onCheckedChange = null)
    }
}

/** "Recommend": what goes with the article is chosen here. [marks] are the reader's own, never the AI's suggestions. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RecommendSheet(article: Article, marks: List<String>, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val store = remember { Store(context) }
    var note by rememberSaveable { mutableStateOf("") }
    var withMarks by rememberSaveable { mutableStateOf(true) }
    var withSummary by rememberSaveable { mutableStateOf(false) }
    var withName by rememberSaveable { mutableStateOf(true) }
    var name by rememberSaveable { mutableStateOf(store.recommendName) }
    var failed by remember { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).navigationBarsPadding().imePadding().padding(horizontal = 24.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Recommend", style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
            Text(article.title.ifBlank { article.url }, style = MaterialTheme.typography.titleMedium, fontFamily = FontFamily.Serif)
            OutlinedTextField(note, { note = it }, label = { Text("Your note") }, minLines = 2, maxLines = 6, modifier = Modifier.fillMaxWidth())
            if (marks.isNotEmpty()) Choice("My highlights (${marks.size})", withMarks) { withMarks = it }
            if (article.summary.isNotBlank()) Choice("Summary", withSummary) { withSummary = it }
            Choice("My name", withName) { withName = it }
            if (withName) OutlinedTextField(name, { name = it; store.recommendName = it }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Text("The link and your note go into the message, with a file that anyone can read and Kaivo can save. No account, no id, and not the article's text.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (failed) Text("This article cannot be recommended: it has no web address.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            Button(onClick = {
                val r = Recommendation(
                    url = article.url, title = article.title, note = note, from = if (withName) name.trim() else "",
                    marks = if (withMarks) marks else emptyList(),
                    summary = if (withSummary) article.summary.lines().map { it.trim().removePrefix("- ") }.filter { it.isNotEmpty() } else emptyList(),
                ).checked()
                if (r != null && runCatching { shareRecommendation(context, r) }.isSuccess) onDismiss() else failed = true
            }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.AutoMirrored.Filled.Send, null); Text("  Share…") }
        }
    }
}

/** A recommendation someone sent, looked at before its page is opened. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReceivedSheet(r: Recommendation, onOpen: () -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(horizontal = 24.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(r.title, style = MaterialTheme.typography.titleLarge, fontFamily = FontFamily.Serif, modifier = Modifier.semantics { heading() })
            Text(r.url, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 3)
            RecommendationCard(r, withMarks = true)
            Button(onClick = onOpen, modifier = Modifier.fillMaxWidth()) { Text("Open the article") }
            Text("Nothing is saved yet. You can save it above the article.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** At most one byte more than a recommendation may weigh, so that a larger file is seen to be too large. Null where it cannot be read. */
fun readShared(context: Context, uri: android.net.Uri): ByteArray? {
    if (uri.scheme != "content") return null
    return runCatching {
        context.contentResolver.openInputStream(uri)?.use { input ->
            val out = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (out.size() <= Recommendation.MAX_BYTES) {
                val n = input.read(buffer, 0, minOf(buffer.size, Recommendation.MAX_BYTES + 1 - out.size()))
                if (n < 0) break
                out.write(buffer, 0, n)
            }
            out.toByteArray()
        }
    }.getOrNull()
}

/** What someone sent: who, what they wrote, and what they marked. Name and words are shown as sent. */
@Composable
fun RecommendationCard(r: Recommendation, modifier: Modifier = Modifier, withMarks: Boolean = false) {
    var open by rememberSaveable(r.url) { mutableStateOf(false) }
    AishCard(modifier.fillMaxWidth(), tone = CardTone.Summary) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(if (r.from.isEmpty()) "Recommended to you" else "Recommended by ${r.from}", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.semantics { heading() })
            if (r.note.isNotEmpty()) Text(r.note, style = MaterialTheme.typography.bodyMedium)
            if (withMarks) r.marks.forEach { Text("“$it”", style = MaterialTheme.typography.bodyMedium, fontFamily = FontFamily.Serif) }
            if (r.summary.isNotEmpty()) {
                TextButton(onClick = { open = !open }) { Text(if (open) "Hide the sender's summary" else "Summary from the sender") }
                if (open) r.summary.forEach { Text(it, style = MaterialTheme.typography.bodyMedium) }
            }
            Text("Name and words as sent, not checked.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
