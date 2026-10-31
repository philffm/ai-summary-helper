package eu.byphil.aishcompanion

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Alarm
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/**
 * Receives "Share → AISH". A link opens a small sheet with the things to do with it: send it to the browser extension, summarize it on this phone
 * (opens the page in the app and starts the on-device summary), remind yourself, or keep it as a note. Text without a link can be kept as a note.
 */
class ShareActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val shared = intent?.getStringExtra(Intent.EXTRA_TEXT).orEmpty().trim()
        val link = LinkExtractor.firstLink(shared)
        if (shared.isEmpty()) {
            Toast.makeText(this, R.string.toast_no_link, Toast.LENGTH_SHORT).show()
            finish(); return
        }
        val subject = intent?.getStringExtra(Intent.EXTRA_SUBJECT).orEmpty()
        val paired = Store(this).pairing != null
        setContent {
            AishTheme(highContrast = Store(this).highContrast, reduceMotion = Store(this).reduceMotion, themeMode = Store(this).themeMode, dynamicColor = Store(this).dynamicColor) {
                ShareSheet(
                    link = link, text = shared, canSend = paired,
                    onNote = {
                        val saved = eu.byphil.aishcompanion.sync.NotesRepo(libraryOf(this)).add(shared, url = link.orEmpty(), title = subject)
                        if (saved != null) { syncLibrarySoon(this); Toast.makeText(this, "Saved as a note", Toast.LENGTH_SHORT).show() }
                        finish()
                    },
                    onSend = { link?.let { SendWorker.enqueue(this, it) }; Toast.makeText(this, R.string.toast_queued, Toast.LENGTH_SHORT).show(); finish() },
                    onSummarize = {
                        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            .putExtra(MainActivity.EXTRA_OPEN_URL, link.orEmpty()).putExtra(MainActivity.EXTRA_SUMMARIZE, true))
                        finish()
                    },
                    onRemind = { delayMs, label ->
                        Reminders.schedule(this, delayMs, link.orEmpty(), link.orEmpty())
                        Toast.makeText(this, "I will remind you: ${label.lowercase()}", Toast.LENGTH_SHORT).show(); finish()
                    },
                    onDismiss = { finish() },
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ShareSheet(link: String?, text: String, canSend: Boolean, onNote: () -> Unit, onSend: () -> Unit, onSummarize: () -> Unit, onRemind: (Long, String) -> Unit, onDismiss: () -> Unit) {
    val remind = androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    val context = androidx.compose.ui.platform.LocalContext.current
    val permission = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 24.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("AI Summary Helper", style = MaterialTheme.typography.titleMedium)
            Text(link ?: text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 3, overflow = TextOverflow.Ellipsis)
            if (link == null) { Button(onClick = onNote, modifier = Modifier.fillMaxWidth()) { Text("Save as a note") }; return@Column }
            Button(onClick = onSummarize, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Filled.AutoAwesome, null, Modifier.size(18.dp)); Text("  Summarize on this phone") }
            if (canSend) OutlinedButton(onClick = onSend, modifier = Modifier.fillMaxWidth()) { Icon(Icons.AutoMirrored.Filled.Send, null, Modifier.size(18.dp)); Text("  Send to browser") }
            OutlinedButton(onClick = onNote, modifier = Modifier.fillMaxWidth()) { Text("Save as a note") }
            OutlinedButton(onClick = {
                if (android.os.Build.VERSION.SDK_INT >= 33 && !Reminders.canNotify(context)) permission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                remind.value = !remind.value
            }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Filled.Alarm, null, Modifier.size(18.dp)); Text("  Remind me") }
            if (remind.value) for (o in ReminderTimes.options(java.time.ZonedDateTime.now())) OutlinedButton(onClick = { onRemind(o.delayMs, o.label) }, modifier = Modifier.fillMaxWidth()) { Text(o.label) }
            if (!canSend) Text("Pair this phone in Settings to also send links to your browser.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
