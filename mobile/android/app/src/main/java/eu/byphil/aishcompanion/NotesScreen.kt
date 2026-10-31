package eu.byphil.aishcompanion

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import eu.byphil.aishcompanion.sync.Note
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant

/**
 * Notes of this phone and of the browser, newest first. Writing works offline: a note is saved at once and goes to the library with the next
 * sync (right away when a library is joined and there is a network). A trailing #tag becomes a tag, like in the browser.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotesScreen(model: AppModel) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var notes by remember { mutableStateOf(model.notes.list()) }
    var draft by remember { mutableStateOf("") }
    var editing by remember { mutableStateOf("") }
    var editText by remember { mutableStateOf("") }
    var deleting by remember { mutableStateOf("") }
    var syncing by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf<String?>(null) }
    val connected = model.library.isConnected()

    fun reload() { notes = model.notes.list() }
    fun syncQuietly() {
        if (!connected) return
        syncLibrarySoon(context)
    }
    fun syncNow() {
        syncing = true; status = null
        scope.launch {
            status = try { withContext(Dispatchers.IO) { val s = model.library.syncNow(); if (s.errors.isEmpty()) null else s.errors.first() } } catch (e: Exception) { e.message ?: "Could not sync." }
            reload(); syncing = false
        }
    }

    Column(Modifier.fillMaxSize().imePadding()) {
        TopAppBar(title = { Text("Notes") }, actions = {
            if (connected) IconButton(onClick = { syncNow() }, enabled = !syncing) { Icon(Icons.Filled.Sync, contentDescription = "Sync now") }
        })
        val sub = when {
            syncing -> "Syncing…"
            !connected -> "Saved on this phone. Join your library in Settings → Library sync to share them with the browser."
            model.library.lastSyncAt() > 0 -> "Synced ${relativeTime(model.library.lastSyncAt())}."
            else -> "Not synced yet."
        }
        Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp))
        status?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp)) }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (notes.isEmpty()) item { Text("No notes yet. Write one below, or share text from any app to AISH.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(notes, key = { it.id }) { n ->
                NoteCard(n, editing = editing == n.id, editText = editText, confirmDelete = deleting == n.id,
                    onEditText = { editText = it },
                    onEdit = { editing = n.id; editText = (listOf(n.text) + n.tags.map { "#$it" }).joinToString(" ") },
                    onSave = { if (model.notes.update(n.id, editText)) { editing = ""; reload(); syncQuietly() } },
                    onCancel = { editing = "" },
                    onDelete = { if (deleting == n.id) { model.notes.delete(n.id); deleting = ""; reload(); syncQuietly() } else deleting = n.id },
                    onKeep = { deleting = "" })
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(draft, { draft = it }, Modifier.weight(1f), placeholder = { Text("Write a note… end with #tags") }, maxLines = 5)
            Button(onClick = { if (model.notes.add(draft) != null) { draft = ""; reload(); syncQuietly() } }, enabled = draft.isNotBlank()) { Text("Add") }
        }
    }
}

@Composable
private fun NoteCard(
    n: Note, editing: Boolean, editText: String, confirmDelete: Boolean, onEditText: (String) -> Unit,
    onEdit: () -> Unit, onSave: () -> Unit, onCancel: () -> Unit, onDelete: () -> Unit, onKeep: () -> Unit,
) {
    AishCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (editing) {
                OutlinedTextField(editText, onEditText, Modifier.fillMaxWidth(), maxLines = 8)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { Button(onClick = onSave, enabled = editText.isNotBlank()) { Text("Save") }; OutlinedButton(onClick = onCancel) { Text("Cancel") } }
            } else {
                Text(n.text, style = MaterialTheme.typography.bodyLarge)
                if (n.quote.isNotBlank()) Text("“${n.quote}”", style = MaterialTheme.typography.bodyMedium.copy(fontStyle = androidx.compose.ui.text.font.FontStyle.Italic), color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (n.title.isNotBlank()) Text(n.title, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (n.tags.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { for (t in n.tags) AssistChip(onClick = {}, label = { Text("#$t") }) }
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(whenOf(n.created), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row {
                        if (confirmDelete) { TextButton(onClick = onDelete) { Text("Delete for good", color = MaterialTheme.colorScheme.error) }; TextButton(onClick = onKeep) { Text("Keep") } }
                        else { TextButton(onClick = onEdit) { Text("Edit") }; TextButton(onClick = onDelete) { Text("Delete") } }
                    }
                }
            }
        }
    }
}

private fun whenOf(iso: String): String = runCatching { relativeTime(Instant.parse(iso).toEpochMilli()) }.getOrDefault("")
