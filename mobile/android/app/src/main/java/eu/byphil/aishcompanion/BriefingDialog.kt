package eu.byphil.aishcompanion

import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.LocalTime
import java.util.Locale

/**
 * Today's briefing on demand, written by the on-device model from the unread stories (same picking and news mode as the alarm).
 * If the model is missing or fails, the plain briefing is shown instead. Can be read aloud or shared.
 */
@Composable
fun BriefingDialog(model: AppModel, onDismiss: () -> Unit) {
    val context = LocalContext.current
    var text by remember { mutableStateOf<String?>(null) }
    var byAi by remember { mutableStateOf(false) }
    var speaking by remember { mutableStateOf(false) }
    var tts by remember { mutableStateOf<TextToSpeech?>(null) }

    LaunchedEffect(Unit) {
        val (t, ai) = withContext(Dispatchers.Default) {
            val plain = buildBriefingNow(context)
            val hour = LocalTime.now().hour
            val written = if (LocalLlm.installed(context)) LocalLlm.narrate(context, plain.items, plain.readingUnread, hour, model.alarm.newsMode) else null
            (written ?: plain.spokenParts(hour).joinToString("\n\n")) to (written != null)
        }
        text = t; byAi = ai
    }
    DisposableEffect(Unit) {
        val engine = TextToSpeech(context.applicationContext) { status -> if (status != TextToSpeech.SUCCESS) tts = null }
        engine.language = Locale.getDefault()
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String?) {}
            override fun onDone(id: String?) { if (id == "briefing-end") speaking = false }
            @Deprecated("Deprecated in Java") override fun onError(id: String?) { speaking = false }
        })
        tts = engine
        onDispose { engine.stop(); engine.shutdown() }
    }
    fun toggleSpeech() {
        val engine = tts ?: return
        if (speaking) { engine.stop(); speaking = false; return }
        val parts = BriefingPrompt.chunks(text ?: return)
        speaking = true
        parts.forEachIndexed { i, p -> engine.speak(p, TextToSpeech.QUEUE_ADD, null, if (i == parts.lastIndex) "briefing-end" else "briefing-$i") }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Today's briefing") },
        text = {
            val t = text
            if (t == null) Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.padding(4.dp), strokeWidth = 2.dp)
                Text(if (LocalLlm.installed(context)) "Writing it on this phone… up to a minute." else "Putting it together…")
            } else Column(Modifier.verticalScroll(rememberScrollState()).heightIn(max = 420.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(t)
                Text(
                    if (byAi) "Written on this phone by the local model." else if (LocalLlm.installed(context)) "The model could not write it now, so this is the plain version." else "Plain version. Download the on-device model in Settings to have it written for you.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
        dismissButton = {
            if (text != null) Row {
                TextButton(onClick = { toggleSpeech() }) { Text(if (speaking) "Stop" else "Read aloud") }
                TextButton(onClick = { shareText(context, "Today's briefing", text ?: "") }) { Text("Share") }
            }
        },
    )
}
