package eu.byphil.aishcompanion

import android.text.format.Formatter
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** Bytes of a file or of everything under a folder. */
fun sizeOf(f: File): Long = if (f.isFile) f.length() else f.listFiles()?.sumOf { sizeOf(it) } ?: 0L

/** What the app keeps on the phone, and ways to free space: old feed items, models you do not use, the model's working cache. */
@Composable
fun StorageCard(model: AppModel) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var tick by remember { mutableIntStateOf(0) }
    var feedBytes by remember { mutableStateOf(0L) }
    var itemCount by remember { mutableIntStateOf(0) }
    var articleBytes by remember { mutableStateOf(0L) }
    var cacheBytes by remember { mutableStateOf(0L) }
    var podcastBytes by remember { mutableStateOf(0L) }
    var podcastCount by remember { mutableIntStateOf(0) }
    var modelSizes by remember { mutableStateOf(listOf<Pair<ModelOption, Long>>()) }
    var confirm by remember { mutableStateOf<String?>(null) }
    val selected = Models.selected(context)

    LaunchedEffect(tick) {
        withContext(Dispatchers.IO) {
            val app = context.applicationContext
            feedBytes = sizeOf(File(app.filesDir, "feeds"))
            itemCount = FeedStore(File(app.filesDir, "feeds")).let { s -> s.feeds().sumOf { s.items(it.url).size } }
            articleBytes = sizeOf(File(app.filesDir, "articles")) + sizeOf(File(app.filesDir, "articles-trash"))
            cacheBytes = sizeOf(app.cacheDir)
            podcastBytes = PodcastDownloads.totalBytes(app); podcastCount = PodcastDownloads.count(app)
            modelSizes = Models.ALL.map { o -> val st = ModelStore.of(app, o); o to (if (st.file.exists()) st.file.length() else 0L) + (if (st.part.exists()) st.part.length() else 0L) }.filter { it.second > 0 }
        }
    }
    fun size(b: Long) = Formatter.formatShortFileSize(context, b)
    val others = modelSizes.filter { it.first.id != selected.id }
    val total = feedBytes + articleBytes + podcastBytes + cacheBytes + modelSizes.sumOf { it.second }

    SettingsGroup {
        Text("This app uses ${size(total)}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Text("Feeds: $itemCount items · ${size(feedBytes)}", style = MaterialTheme.typography.bodyMedium)
        Text("Reading list: ${model.articleList.size} articles · ${size(articleBytes)}", style = MaterialTheme.typography.bodyMedium)
        if (modelSizes.isEmpty()) Text("On-device models: none downloaded", style = MaterialTheme.typography.bodyMedium)
        else modelSizes.forEach { (o, b) -> Text("${o.name}${if (o.id == selected.id) " (in use)" else ""}: ${size(b)}", style = MaterialTheme.typography.bodyMedium) }
        Text("Podcast episodes: $podcastCount saved · ${size(podcastBytes)}", style = MaterialTheme.typography.bodyMedium)
        Text("Working cache: ${size(cacheBytes)}", style = MaterialTheme.typography.bodyMedium)
    }
    SettingsCaption("Free space")
    SettingsGroup {
        Text("The phone keeps feed items for 30 days so your recap and briefing have something to build on. Older ones are removed automatically.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { confirm = "prune" }, Modifier.fillMaxWidth()) { Text("Remove feed items older than 7 days") }
            if (others.isNotEmpty()) OutlinedButton(onClick = { confirm = "models" }, Modifier.fillMaxWidth()) { Text("Delete other models (${size(others.sumOf { it.second })})") }
            if (podcastCount > 0) OutlinedButton(onClick = { confirm = "podcasts" }, Modifier.fillMaxWidth()) { Text("Delete saved episodes (${size(podcastBytes)})") }
            OutlinedButton(onClick = { confirm = "cache" }, Modifier.fillMaxWidth(), enabled = cacheBytes > 0) { Text("Clear working cache (${size(cacheBytes)})") }
        }
    }

    confirm?.let { which ->
        val (title, text) = when (which) {
            "prune" -> "Remove old feed items?" to "Items older than 7 days are removed, except your favourites. Items a feed still lists come back on the next refresh, as unread."
            "models" -> "Delete other models?" to "Frees ${size(others.sumOf { it.second })}. ${selected.name} stays. You can download the others again."
            "podcasts" -> "Delete saved episodes?" to "Frees ${size(podcastBytes)}. Episodes stream again when you play them online."
            else -> "Clear the cache?" to "Frees ${size(cacheBytes)}. The model rebuilds it the next time it runs, which can take a little longer once."
        }
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(title) }, text = { Text(text) },
            confirmButton = {
                TextButton(onClick = {
                    confirm = null
                    scope.launch {
                        val msg = withContext(Dispatchers.IO) {
                            val app = context.applicationContext
                            when (which) {
                                "prune" -> { val n = FeedStore(File(app.filesDir, "feeds")).pruneOlderThan(7, System.currentTimeMillis()); "Removed $n items." }
                                "models" -> { others.forEach { ModelStore.of(app, it.first).delete() }; "Deleted ${others.size} model" + (if (others.size == 1) "." else "s.") }
                                "podcasts" -> { PodcastDownloads.deleteAll(app); "Saved episodes deleted." }
                                else -> { app.cacheDir.listFiles()?.forEach { it.deleteRecursively() }; "Cache cleared." }
                            }
                        }
                        model.reload(); model.message = msg; tick++
                    }
                }) { Text("Continue") }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Cancel") } },
        )
    }
}
