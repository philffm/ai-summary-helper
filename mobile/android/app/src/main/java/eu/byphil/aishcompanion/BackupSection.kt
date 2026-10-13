package eu.byphil.aishcompanion

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

/**
 * Settings to a file and back, so a new phone is quick to set up. The file holds preferences only (alarm, summary language,
 * reader, layout): never the pairing, licence or account. On the new phone: scan the pairing code, then import the file.
 */
@Composable
fun BackupCard(model: AppModel) {
    val context = LocalContext.current
    var status by remember { mutableStateOf<String?>(null) }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) status = runCatching {
            context.contentResolver.openOutputStream(uri)?.use { it.write(model.store.exportSettings().toByteArray()) } ?: error("Could not write the file.")
            "Settings saved."
        }.getOrElse { "Could not save: ${it.message}" }
    }
    val load = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) status = runCatching {
            val text = context.contentResolver.openInputStream(uri)?.use { String(it.readBytes(), Charsets.UTF_8) } ?: error("Could not read the file.")
            val n = model.store.importSettings(text)
            model.reloadSettings()
            "Imported $n settings."
        }.getOrElse { "Could not import: ${it.message}" }
    }
    SettingsGroup {
        Text("Move your settings to another phone", style = MaterialTheme.typography.titleMedium)
        Text(
            "The file has your preferences: alarm, summary language, reader size and speed, layout. It does not contain the pairing, your licence or your account. " +
                "On the new phone scan the pairing code first, then import this file.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { save.launch("aish-settings.json") }, Modifier.fillMaxWidth()) { Text("Export settings") }
            OutlinedButton(onClick = { load.launch(arrayOf("application/json", "text/plain", "*/*")) }, Modifier.fillMaxWidth()) { Text("Import settings") }
        }
        status?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
    }
}
