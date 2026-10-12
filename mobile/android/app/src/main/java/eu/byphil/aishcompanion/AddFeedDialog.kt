package eu.byphil.aishcompanion

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Add feed: an address field, plus the same starter feeds as the browser extension (one tap each). Feeds already followed are left out. */
@Composable
fun AddFeedDialog(model: AppModel, onDismiss: () -> Unit, onAdded: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val address = remember { mutableStateOf("") }
    val tags = remember { mutableStateOf("") }
    val error = remember { mutableStateOf<String?>(null) }
    val busy = remember { mutableStateOf(false) }
    val suggestions = remember { mutableStateOf(SuggestedFeeds.load(context)) }
    LaunchedEffect(Unit) { suggestions.value = withContext(Dispatchers.IO) { SuggestedFeeds.refresh(context) } }

    val have = model.feeds.map { it.url }.toSet()
    val shown = suggestions.value.filter { it.url !in have }

    val add: (String, String) -> Unit = { url, tagText ->
        scope.launch {
            busy.value = true; error.value = null
            val err = model.addFeed(url, tagText)
            busy.value = false
            if (err == null) {
                onAdded(url)
            } else {
                error.value = err
            }
        }
    }

    AlertDialog(
        onDismissRequest = { if (!busy.value) onDismiss() },
        title = { Text("Add feed") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()).heightIn(max = 460.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(address.value, { address.value = it }, label = { Text("Feed or website address") }, singleLine = true, modifier = Modifier.fillMaxWidth(), isError = error.value != null)
                OutlinedTextField(tags.value, { tags.value = it }, label = { Text("Tags (optional, separated by commas)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                val message = error.value
                if (message != null) Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                if (shown.isNotEmpty()) {
                    HorizontalDivider()
                    Text("Suggested", style = MaterialTheme.typography.titleSmall)
                    shown.forEach { f -> SuggestionRow(f, enabled = !busy.value) { add(f.url, f.tags.joinToString(",")) } }
                }
            }
        },
        confirmButton = { TextButton(onClick = { add(address.value, tags.value) }, enabled = !busy.value && address.value.isNotBlank()) { Text(if (busy.value) "Working…" else "Add") } },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy.value) { Text("Cancel") } },
    )
}

@Composable
private fun SuggestionRow(f: SuggestedFeed, enabled: Boolean, onAdd: () -> Unit) {
    val detail = listOf(f.note, f.tags.joinToString(", ")).filter { it.isNotBlank() }.joinToString(" · ")
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(f.icon, style = MaterialTheme.typography.titleLarge)
        Column(Modifier.weight(1f)) {
            Text(f.name, style = MaterialTheme.typography.bodyLarge)
            if (detail.isNotEmpty()) Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
        }
        IconButton(onClick = onAdd, enabled = enabled) { Icon(Icons.Filled.Add, contentDescription = "Add " + f.name) }
    }
}
