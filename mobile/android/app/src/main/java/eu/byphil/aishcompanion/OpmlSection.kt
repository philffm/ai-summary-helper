package eu.byphil.aishcompanion

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** The two OPML actions as plain functions: pick a file to import, or choose where to save the export. Results are reported through [AppModel.message]. */
class OpmlActions(val import: () -> Unit, val export: () -> Unit)

@Composable
fun rememberOpmlActions(model: AppModel): OpmlActions {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) scope.launch {
            val text = withContext(Dispatchers.IO) { runCatching { context.contentResolver.openInputStream(uri)?.use { String(it.readNBytes(2_000_001), Charsets.UTF_8) } }.getOrNull() }
            if (text == null) model.message = "Could not read that file."
            else {
                model.message = model.importOpml(text)
                model.refreshAll(force = false)
            }
        }
    }
    val saver = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/x-opml")) { uri: Uri? ->
        if (uri != null) scope.launch {
            val ok = withContext(Dispatchers.IO) { runCatching { context.contentResolver.openOutputStream(uri)?.use { it.write(model.exportOpml().toByteArray(Charsets.UTF_8)) } != null }.getOrDefault(false) }
            model.message = if (ok) "Saved ${model.feeds.size} feeds." else "Could not save the file."
        }
    }
    return OpmlActions(import = { picker.launch(arrayOf("*/*")) }, export = { saver.launch("aish-feeds.opml") })
}

/** Backup and restore of the feed list, in the format every feed reader understands. */
@Composable
fun OpmlButtons(model: AppModel) {
    val opml = rememberOpmlActions(model)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = opml.import) { Text("Import OPML…") }
        OutlinedButton(onClick = opml.export, enabled = model.feeds.isNotEmpty()) { Text("Export OPML…") }
    }
}
