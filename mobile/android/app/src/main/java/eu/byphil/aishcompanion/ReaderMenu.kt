package eu.byphil.aishcompanion

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.PrimaryScrollableTabRow
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** The tabs of the reader's menu, as on the iPhone. */
enum class ReaderPage(val title: String) { SUMMARY("Summary"), TEXT("Text"), LISTEN("Listen"), MORE("More") }

/** One thing the "More" tab can do. [stays] keeps the menu open (the row only changes what it shows). */
class ReaderAction(val icon: ImageVector, val label: String, val stays: Boolean = false, val danger: Boolean = false, val run: () -> Unit)

/** What the summary tab shows and can do. */
class SummaryState(val text: String, val local: Boolean, val busy: Boolean, val note: String, val canSummarize: Boolean, val summarize: () -> Unit)

/** The one menu of the reader: everything that is not the article, behind one button. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReaderMenu(
    model: AppModel, page: ReaderPage, onPage: (ReaderPage) -> Unit, summary: SummaryState, voice: ReadAloud,
    onListen: () -> Unit, onSpeedRead: () -> Unit, actions: List<ReaderAction>, onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState()) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding()) {
            val tabs: @Composable () -> Unit = { ReaderPage.entries.forEach { p -> Tab(selected = p == page, onClick = { onPage(p) }, text = { Text(p.title, maxLines = 1) }) } }
            // with large text the tabs keep their words and scroll
            if (LocalDensity.current.fontScale >= 1.3f) PrimaryScrollableTabRow(page.ordinal, edgePadding = 0.dp, containerColor = Color.Transparent) { tabs() }
            else PrimaryTabRow(page.ordinal, containerColor = Color.Transparent) { tabs() }
            Column(Modifier.fillMaxWidth().heightIn(min = 280.dp).verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                when (page) {
                    ReaderPage.SUMMARY -> {
                        if (summary.text.isNotBlank()) {
                            Text(if (summary.local) "Made on this phone" else "Kaivo summary", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            PlainText(summary.text)
                        } else Text("No summary yet.", style = MaterialTheme.typography.bodyLarge)
                        if (summary.note.isNotEmpty()) Text(summary.note, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                        if (summary.canSummarize) Button(onClick = summary.summarize, enabled = !summary.busy, modifier = Modifier.fillMaxWidth()) {
                            Icon(Icons.Filled.AutoAwesome, null, Modifier.size(18.dp))
                            Text(if (summary.text.isBlank()) "  Summarize on this phone" else "  Summarize again")
                        } else Text("To summarize here, download the on-device model in Settings.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    ReaderPage.TEXT -> ReaderSettings(model)
                    ReaderPage.LISTEN -> {
                        val playing = voice.state == ReadAloud.State.PLAYING
                        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            FilledIconButton(onClick = onListen, modifier = Modifier.size(72.dp), shape = IconButtonDefaults.filledShape) {
                                Icon(if (playing) Icons.Filled.Pause else Icons.Filled.PlayArrow, contentDescription = if (playing) "Pause" else if (voice.state == ReadAloud.State.PAUSED) "Resume" else "Read the article aloud", Modifier.size(36.dp))
                            }
                            Text(if (voice.state == ReadAloud.State.IDLE) "Read the article aloud" else "Sentence ${voice.index + 1} of ${voice.total}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            if (voice.state != ReadAloud.State.IDLE) TextButton(onClick = { voice.stop() }) { Icon(Icons.Filled.Stop, null, Modifier.size(18.dp)); Text("  Stop") }
                        }
                        val rates = listOf(0.8f to "0.8×", 1f to "1×", 1.25f to "1.25×", 1.5f to "1.5×")
                        Choices("Speed", rates.map { it.first.toString() to it.second }, rates.minByOrNull { kotlin.math.abs(it.first - voice.rate) }!!.first.toString()) { voice.changeRate(it.toFloat()) }
                        OutlinedButton(onClick = onSpeedRead, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Filled.Speed, null, Modifier.size(18.dp)); Text("  Speed read") }
                    }
                    ReaderPage.MORE -> Column {
                        actions.forEach { a ->
                            val tint = if (a.danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
                            ListItem(
                                headlineContent = { Text(a.label, color = tint) }, leadingContent = { Icon(a.icon, null, tint = tint) },
                                colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                                modifier = Modifier.fillMaxWidth().clickable { if (!a.stays) onDismiss(); a.run() },
                            )
                        }
                    }
                }
            }
        }
    }
}
