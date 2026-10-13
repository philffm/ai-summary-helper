package eu.byphil.aishcompanion

import android.media.AudioAttributes
import android.os.Bundle
import android.speech.tts.TextToSpeech
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * What you see when the alarm rings (also over the lock screen). Stop silences it and, if switched on, reads the briefing aloud;
 * Snooze rings again later. The briefing text is shown as well, so it can be read instead of listened to.
 */
class RingActivity : ComponentActivity() {
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var pendingParts: List<String>? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val settings = Store(this).alarm
        val briefing = loadBriefing(this)
        val parts = briefing.spokenParts(LocalTime.now().hour)
        val voice = if (briefing.narration.isNotBlank()) SummaryLangs.feedLocale(Store(this).summaryLang) else java.util.Locale.getDefault()   // the written briefing is in the chosen language; the plain list is read as the phone speaks
        tts = TextToSpeech(applicationContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
                ttsReady = true
                runCatching { tts?.language = voice }
                tts?.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                pendingParts?.let { speak(it); pendingParts = null }
            }
        }
        setContent {
            AishTheme {
                Surface(Modifier.fillMaxSize()) {
                    RingScreen(
                        lines = if (briefing.narration.isNotBlank()) BriefingPrompt.chunks(briefing.narration, 600) else briefing.lines(),
                        numbered = briefing.narration.isBlank(),
                        extra = briefing.extra,
                        snoozeMinutes = settings.snoozeMinutes,
                        onStop = { AlarmService.stop(this); if (settings.readAloud && !settings.fadeIn) readOut(parts) },   // with the fade-in the briefing was already read over the music
                        onSnooze = { AlarmService.stop(this); AlarmScheduler.ringIn(this, settings.snoozeMinutes * 60L); finish() },
                        onRead = { readOut(parts) },
                        onSilence = { tts?.stop() },
                        onClose = { finish() },
                    )
                }
            }
        }
    }

    private fun readOut(parts: List<String>) { if (ttsReady) speak(parts) else pendingParts = parts }

    private fun speak(parts: List<String>) {
        val t = tts ?: return
        t.stop()
        parts.forEachIndexed { i, text -> t.speak(text, TextToSpeech.QUEUE_ADD, null, "part-$i") }
    }

    override fun onDestroy() { tts?.stop(); tts?.shutdown(); tts = null; super.onDestroy() }
}

@Composable
private fun RingScreen(lines: List<String>, numbered: Boolean, extra: String, snoozeMinutes: Int, onStop: () -> Unit, onSnooze: () -> Unit, onRead: () -> Unit, onSilence: () -> Unit, onClose: () -> Unit) {
    var stopped by remember { mutableStateOf(false) }
    val time = remember { LocalTime.now().format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)) }
    BackHandler(enabled = !stopped) { /* the alarm is stopped with its buttons, not by accident */ }
    Column(Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(time, fontSize = 64.sp, fontWeight = FontWeight.Light)
        if (!stopped) {
            Text("Good morning", style = MaterialTheme.typography.titleLarge)
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                lines.forEach { Text(it, style = MaterialTheme.typography.bodyLarge) }
            }
            Button(onClick = { stopped = true; onStop() }, Modifier.fillMaxWidth()) { Text("Stop") }
            OutlinedButton(onClick = onSnooze, Modifier.fillMaxWidth()) { Text("Snooze $snoozeMinutes min") }
        } else {
            Text("Your briefing", style = MaterialTheme.typography.titleLarge)
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (lines.isEmpty()) Text("Nothing new in your feeds.", style = MaterialTheme.typography.bodyLarge)
                lines.forEachIndexed { i, l -> Text(if (numbered) "${i + 1}. $l" else l, style = MaterialTheme.typography.bodyLarge) }
                if (extra.isNotBlank()) Text(extra, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.primary)
            }
            Button(onClick = onRead, Modifier.fillMaxWidth()) { Text("Read aloud again") }
            OutlinedButton(onClick = onSilence, Modifier.fillMaxWidth()) { Text("Stop reading") }
            OutlinedButton(onClick = onClose, Modifier.fillMaxWidth()) { Text("Close") }
        }
    }
}
