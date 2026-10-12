package eu.byphil.aishcompanion

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
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
    var address by remember { mutableStateOf("") }
    var tags by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var suggestions by remember { mutableStateOf(SuggestedFeeds.load(context)) }
    LaunchedEffect(Unit) { suggestions = withContext(Dispatchers.IO) { SuggestedFeeds.refresh(context) } }

    val have = model.feeds.map { it.url }.toSet()
    val shown = suggestions.filter { it.url !in have }

    fun add(url: String, tagText: String) {
        scope.launch {
            busy = true; error = null
            val err = model.addFeed(url, tagText)
            busy = false
            if (err == null) onAdded(url) else error = err
        }
    }

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Add feed") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()).heightIn(max = 460.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(address, { address = it }, label = { Text("Feed or website address") }, singleLine = true, modifier = Modifier.fillMaxWidth(), isError = error != null)
                OutlinedTextField(tags, { tags = it }, label = { Text("Tags (optional, separated by commas)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                if (error != null) Text(error!!, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                if (shown.isNotEmpty()) {
                    HorizontalDivider()
                    Text("Suggested", style = MaterialTheme.typography.titleSmall)
                    shown.forEach { f ->
                        ListItem(
                            colors = ListItemDefaults.colors(containerColor = androidx.compose.ui.graphics.Color.Transparent),
                            leadingContent = { Text(f.icon, style = MaterialTheme.typography.titleLarge) },
                            headlineContent = { Text(f.name) },
                            supportingContent = { Text(listOf(f.note, f.tags.joinToString(", ")).filter { it.isNotBlank() }.joinToString(" · "), maxLines = 2) },
                            trailingContent = { IconButton(onClick = { add(f.url, f.tags.joinToString(",")) }, enabled = !busy) { Icon(Icons.Filled.Add, contentDescription = "Add ${f.name}") } },
                        )
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { add(address, tags) }, enabled = !busy && address.isNotBlank()) { Text(if (busy) "Working…" else "Add") } },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("Cancel") } },
    )
}
