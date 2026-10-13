package eu.byphil.aishcompanion

import android.text.format.Formatter
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.RadioButton
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
    var optionId by remember { mutableStateOf(model.store.modelId) }
    val option = Models.byId(optionId)
    val store = remember(optionId) { ModelStore.of(context, option) }
    val works by WorkManager.getInstance(context).getWorkInfosForUniqueWorkFlow(ModelDownloadWorker.NAME).collectAsState(emptyList())
    val running = works.any { it.state == WorkInfo.State.RUNNING }
    val waiting = works.any { it.state == WorkInfo.State.ENQUEUED || it.state == WorkInfo.State.BLOCKED }
    var have by remember(optionId) { mutableLongStateOf(store.downloaded()) }
    var installed by remember(optionId) { mutableStateOf(store.installed()) }
    var profile by remember { mutableStateOf<DeviceProfile?>(null) }
    var checking by remember { mutableStateOf(false) }
    var speed by remember { mutableStateOf<String?>(null) }
    var testing by remember { mutableStateOf(false) }
    var trying by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    val a = model.alarm
    val histWorks by WorkManager.getInstance(context).getWorkInfosForUniqueWorkFlow(MoodHistoryWorker.NAME).collectAsState(emptyList())
    val histRunning = histWorks.any { it.state == WorkInfo.State.RUNNING || it.state == WorkInfo.State.ENQUEUED || it.state == WorkInfo.State.BLOCKED }
    val rated = model.entries.count { it.stored.sent != null }
    val unrated = MoodRater.candidates(model.entries, System.currentTimeMillis(), all = true).size
    LaunchedEffect(histRunning) { while (histRunning) { delay(3000); withContext(Dispatchers.IO) { model.reload() } } }

    LaunchedEffect(running, waiting, works, optionId) {
        do {
            have = store.downloaded(); installed = store.installed()
            delay(1000)
        } while (running)
        have = store.downloaded(); installed = store.installed()
    }

    SettingsCard {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("On-device AI", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(
                "${option.name} runs on this phone to write your briefing as natural sentences instead of a headline list. Nothing is sent anywhere. " +
                    "Your Fold's built-in Gemini Nano is not available for apps, so the model is downloaded once (${Formatter.formatShortFileSize(context, option.size)}).",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            val rec = profile?.let { DeviceBench.recommend(it) }
            Text("Model", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            val p = profile
            if (p == null) {
                OutlinedButton(enabled = !checking, onClick = {
                    checking = true
                    scope.launch {
                        val found = withContext(Dispatchers.Default) { DeviceBench.measure(context) }
                        profile = found; checking = false
                    }
                }) { Text(if (checking) "Checking this phone…" else "Check this phone and recommend a model") }
                Text("Takes a few seconds and downloads nothing. It measures your phone's memory and how fast it reads it, which decides how fast a model can write.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                Text("%.0f GB memory · %d cores · memory speed %.0f GB/s. Speeds below are estimates.".format(p.ramGb, p.cores, p.bandwidthGbps), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Models.ALL.forEach { o ->
                val v = p?.let { DeviceBench.verdict(it, o) }
                Row(
                    Modifier.fillMaxWidth().clickable { if (o.id != optionId) { ModelDownloadWorker.cancel(context); model.store.modelId = o.id; optionId = o.id; speed = null } },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(selected = o.id == optionId, onClick = null)
                    Column(Modifier.weight(1f).padding(start = 12.dp, top = 6.dp, bottom = 6.dp)) {
                        Text(o.name + " · " + Formatter.formatShortFileSize(context, o.size) + (if (ModelStore.of(context, o).installed()) " · on this phone" else ""), style = MaterialTheme.typography.bodyLarge)
                        Text(o.blurb + (v?.let { " " + if (it.fit == Fit.NO) it.fit.label + "." else it.fit.label + ", about %.0f words per second.".format(it.wordsPerSecond) } ?: ""), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (rec?.id == o.id) Text("Recommended for this phone", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                    }
                }
            }
            when {
                installed -> {
                    Text("Installed · ${Formatter.formatShortFileSize(context, option.size)}", style = MaterialTheme.typography.bodyMedium)
                    OutlinedButton(enabled = !testing, onClick = {
                        testing = true; speed = null
                        scope.launch {
                            val wps = withContext(Dispatchers.Default) { LocalLlm.speedTest(context) }
                            speed = if (wps == null) "The model could not run the test now." else "Measured: %.1f words per second.".format(wps) + (if (wps < 2.5) " That is slow; a smaller model will feel better." else "")
                            testing = false
                        }
                    }) { Text(if (testing) "Testing… (up to a minute)" else "Test speed") }
                    speed?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Write the morning briefing with it", Modifier.weight(1f))
                        Switch(checked = a.useAi, onCheckedChange = { model.changeAlarm(a.copy(useAi = it)) })
                    }
                    Text("Mood ratings: $rated of ${rated + unrated} stored feed items rated", style = MaterialTheme.typography.bodySmall)
                    if (histRunning) {
                        LinearProgressIndicator(progress = { if (rated + unrated == 0) 0f else rated.toFloat() / (rated + unrated) }, modifier = Modifier.fillMaxWidth())
                        Text("Rating the whole history in the background… $unrated left. It continues if you close the app.", style = MaterialTheme.typography.bodySmall)
                        OutlinedButton(onClick = { MoodHistoryWorker.cancel(context) }) { Text("Stop") }
                    } else if (unrated > 0) {
                        Text("Rating all $unrated unrated items takes roughly ${(unrated / MoodPrompt.BATCH + 1) * 10 / 60 + 1} minutes and uses a lot of battery, so it is best done while charging.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        OutlinedButton(onClick = { MoodHistoryWorker.start(context) }) { Text("Rate the whole feed history") }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(enabled = !trying, onClick = {
                            trying = true
                            scope.launch {
                                val text = withContext(Dispatchers.Default) {
                                    val plain = buildBriefingNow(context)
                                    LocalLlm.narrate(context, plain.items, plain.readingUnread, LocalTime.now().hour, a.newsMode)
                                }
                                result = text ?: "The model could not write a briefing now. There may be nothing new in your feeds, or the phone is low on memory."
                                trying = false
                            }
                        }) { Text(if (trying) "Writing… (up to a minute)" else "Try it now") }
                        OutlinedButton(onClick = { confirmDelete = true }) { Text("Delete") }
                    }
                }
                running || waiting -> {
                    LinearProgressIndicator(progress = { (have.toFloat() / option.size).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
                    Text(
                        (if (running) "Downloading… " else "Waiting for Wi-Fi… ") + "${Formatter.formatShortFileSize(context, have)} of ${Formatter.formatShortFileSize(context, option.size)}",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    OutlinedButton(onClick = { ModelDownloadWorker.cancel(context) }) { Text("Pause") }
                }
                else -> {
                    if (have > 0) Text("Paused at ${Formatter.formatShortFileSize(context, have)} of ${Formatter.formatShortFileSize(context, option.size)}.", style = MaterialTheme.typography.bodySmall)
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
            text = { Text("This frees ${Formatter.formatShortFileSize(context, option.size)}. Briefings go back to headline lists until you download it again.") },
            confirmButton = { TextButton(onClick = { ModelDownloadWorker.cancel(context); store.delete(); model.changeAlarm(a.copy(useAi = false)); have = 0; installed = false; confirmDelete = false }) { Text("Delete") } },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
        )
    }
}
