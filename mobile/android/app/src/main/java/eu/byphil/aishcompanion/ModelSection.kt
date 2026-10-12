package eu.byphil.aishcompanion

import android.text.format.Formatter
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.work.WorkInfo
import androidx.work.WorkManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalTime

/** Settings card for the on-device model: download (Wi-Fi only, resumable), delete, use it for the briefing, try it now. */
@Composable
fun ModelCard(model: AppModel) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val store = remember { ModelStore.of(context) }
    val works by WorkManager.getInstance(context).getWorkInfosForUniqueWorkFlow(ModelDownloadWorker.NAME).collectAsState(emptyList())
    val running = works.any { it.state == WorkInfo.State.RUNNING }
    val waiting = works.any { it.state == WorkInfo.State.ENQUEUED || it.state == WorkInfo.State.BLOCKED }
    var have by remember { mutableLongStateOf(store.downloaded()) }
    var installed by remember { mutableStateOf(store.installed()) }
    var trying by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    val a = model.alarm

    LaunchedEffect(running, waiting, works) {
        do {
            have = store.downloaded(); installed = store.installed()
            delay(1000)
        } while (running)
        have = store.downloaded(); installed = store.installed()
    }

    Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("On-device AI", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(
                "${ModelSpec.NAME} runs on this phone to write your briefing as natural sentences instead of a headline list. Nothing is sent anywhere. " +
                    "Your Fold's built-in Gemini Nano is not available for apps, so the model is downloaded once (${Formatter.formatShortFileSize(context, ModelSpec.SIZE)}).",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            when {
                installed -> {
                    Text("Installed · ${Formatter.formatShortFileSize(context, ModelSpec.SIZE)}", style = MaterialTheme.typography.bodyMedium)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Write the morning briefing with it", Modifier.weight(1f))
                        Switch(checked = a.useAi, onCheckedChange = { model.changeAlarm(a.copy(useAi = it)) })
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(enabled = !trying, onClick = {
                            trying = true
                            scope.launch {
                                val text = withContext(Dispatchers.Default) {
                                    val plain = buildBriefingNow(context)
                                    LocalLlm.narrate(context, plain.items, plain.readingUnread, LocalTime.now().hour)
                                }
                                result = text ?: "The model could not write a briefing now. There may be nothing new in your feeds, or the phone is low on memory."
                                trying = false
                            }
                        }) { Text(if (trying) "Writing… (up to a minute)" else "Try it now") }
                        OutlinedButton(onClick = { confirmDelete = true }) { Text("Delete") }
                    }
                }
                running || waiting -> {
                    LinearProgressIndicator(progress = { (have.toFloat() / ModelSpec.SIZE).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
                    Text(
                        (if (running) "Downloading… " else "Waiting for Wi-Fi… ") + "${Formatter.formatShortFileSize(context, have)} of ${Formatter.formatShortFileSize(context, ModelSpec.SIZE)}",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    OutlinedButton(onClick = { ModelDownloadWorker.cancel(context) }) { Text("Pause") }
                }
                else -> {
                    if (have > 0) Text("Paused at ${Formatter.formatShortFileSize(context, have)} of ${Formatter.formatShortFileSize(context, ModelSpec.SIZE)}.", style = MaterialTheme.typography.bodySmall)
                    Button(onClick = { ModelDownloadWorker.start(context) }) { Text(if (have > 0) "Resume download" else "Download (Wi-Fi only)") }
                    works.firstOrNull { it.state == WorkInfo.State.FAILED }?.let { Text("The last download failed (not enough space or a corrupt file). Free some space and try again.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                }
            }
        }
    }

    result?.let { text ->
        AlertDialog(
            onDismissRequest = { result = null },
            title = { Text("Your briefing") },
            text = { Column(Modifier.verticalScroll(rememberScrollState())) { Text(text) } },
            confirmButton = { TextButton(onClick = { result = null }) { Text("Close") } },
        )
    }
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete the model?") },
            text = { Text("This frees ${Formatter.formatShortFileSize(context, ModelSpec.SIZE)}. Briefings go back to headline lists until you download it again.") },
            confirmButton = { TextButton(onClick = { ModelDownloadWorker.cancel(context); store.delete(); model.changeAlarm(a.copy(useAi = false)); have = 0; installed = false; confirmDelete = false }) { Text("Delete") } },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
        )
    }
}
