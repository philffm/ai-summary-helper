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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.material3.TextButton
import androidx.compose.foundation.layout.Row
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * What you see when the alarm rings (also over the lock screen). Stop silences it and, if switched on, reads the briefing aloud;
 * Snooze rings again later. The text is shown as well, so it can be read instead of listened to.
 * With an article or a highlight to wake with, [WakeScreen] shows those instead of the briefing.
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
        val shown = androidx.compose.runtime.mutableStateOf(briefing)   // replaced when the ringing service has fetched fresher feeds
        // the ringing service may still be choosing: until then the screen has Stop and Snooze and nothing else
        val waiting = Wake(settings.wake, 0, title = "Getting ready…")
        val chosen = androidx.compose.runtime.mutableStateOf(freshWake(this) ?: if (settings.wake == WakeMode.BRIEFING) Wake.briefing(0) else waiting)
        val voice = if (briefing.narration.isNotBlank()) SummaryLangs.feedLocale(Store(this).summaryLang) else java.util.Locale.getDefault()   // the written briefing is in the chosen language; the plain list is read as the phone speaks
        fun spoken(b: Briefing) = if (chosen.value.mode == WakeMode.BRIEFING) b.spokenParts(LocalTime.now().hour) else chosen.value.parts
        tts = TextToSpeech(applicationContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
                ttsReady = true
                runCatching { tts?.language = if (chosen.value.mode == WakeMode.BRIEFING) voice else wakeLocale(chosen.value) }
                tts?.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                pendingParts?.let { speak(it); pendingParts = null }
            }
        }
        setContent {
            AishTheme(highContrast = Store(this).highContrast, reduceMotion = Store(this).reduceMotion, themeMode = Store(this).themeMode, dynamicColor = Store(this).dynamicColor) {
                androidx.compose.runtime.LaunchedEffect(Unit) {
                    repeat(60) {
                        if (chosen.value !== waiting) return@repeat
                        kotlinx.coroutines.delay(250)
                        freshWake(this@RingActivity)?.let { chosen.value = it; if (it.mode != WakeMode.BRIEFING) runCatching { tts?.language = wakeLocale(it) } }
                    }
                    if (chosen.value === waiting) chosen.value = Wake.briefing(0)   // nothing came: show the briefing
                }
                androidx.compose.runtime.LaunchedEffect(Unit) {
                    repeat(30) {
                        kotlinx.coroutines.delay(2000)
                        Briefing.fromJson(Store(this@RingActivity).briefingJson)?.let { if (it != shown.value) shown.value = it }
                    }
                }
                Surface(Modifier.fillMaxSize()) {
                    val b = shown.value
                    val wake = chosen.value
                    val snooze = { AlarmService.stop(this); AlarmScheduler.ringIn(this, settings.snoozeMinutes * 60L); finish() }
                    val stop = { AlarmService.stop(this); if (settings.readAloud && !settings.fadeIn) readOut(spoken(shown.value)) }   // with the fade-in it was already read over the music
                    if (wake.mode != WakeMode.BRIEFING) WakeScreen(
                        wake, settings.snoozeMinutes, onStop = stop, onSnooze = snooze,
                        onRead = { readOut(wake.parts) }, onSilence = { tts?.stop() }, onClose = { finish() },
                        onAnswer = { knew -> val store = Store(this); store.memos = store.memos + (wake.key to Recall.answer(store.memos[wake.key], knew, today())); finish() },
                        onOpen = { openArticle(wake.articleId) },
                    ) else RingScreen(
                        lines = if (b.narration.isNotBlank()) BriefingPrompt.chunks(b.narration, 600) else b.lines(),
                        numbered = b.narration.isBlank(),
                        note = b.note,
                        extra = b.extra,
                        snoozeMinutes = settings.snoozeMinutes,
                        onStop = stop,
                        onSnooze = snooze,
                        onRead = { readOut(spoken(shown.value)) },
                        onSilence = { tts?.stop() },
                        onClose = { finish() },
                    )
                }
            }
        }
    }

    /** The article in the app. Over a locked screen the phone asks to be unlocked first. */
    private fun openArticle(id: String) {
        AlarmService.stop(this); tts?.stop()
        startActivity(android.content.Intent(this, MainActivity::class.java).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra(MainActivity.EXTRA_OPEN_ARTICLE, id))
        finish()
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
private fun RingScreen(lines: List<String>, numbered: Boolean, note: String, extra: String, snoozeMinutes: Int, onStop: () -> Unit, onSnooze: () -> Unit, onRead: () -> Unit, onSilence: () -> Unit, onClose: () -> Unit) {
    var stopped by remember { mutableStateOf(false) }
    val time = remember { LocalTime.now().format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)) }
    BackHandler(enabled = !stopped) { /* the alarm is stopped with its buttons, not by accident */ }
    RingPanes(
        text = {
            Text(time, fontSize = 64.sp, fontWeight = FontWeight.Light)
            Text(if (stopped) "Your briefing" else "Good morning", style = MaterialTheme.typography.titleLarge)
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(if (stopped) 10.dp else 8.dp)) {
                if (!stopped) lines.forEach { Text(it, style = MaterialTheme.typography.bodyLarge) }
                else {
                    if (lines.isEmpty()) { Text("Nothing new in your feeds.", style = MaterialTheme.typography.bodyLarge); if (note.isNotBlank()) Text(note, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    lines.forEachIndexed { i, l -> Text(if (numbered) "${i + 1}. $l" else l, style = MaterialTheme.typography.bodyLarge) }
                    if (extra.isNotBlank()) Text(extra, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.primary)
                }
            }
        },
        buttons = {
            if (!stopped) {
                Button(onClick = { stopped = true; onStop() }, Modifier.fillMaxWidth()) { Text("Stop") }
                OutlinedButton(onClick = onSnooze, Modifier.fillMaxWidth()) { Text("Snooze $snoozeMinutes min") }
            } else {
                Button(onClick = onRead, Modifier.fillMaxWidth()) { Text("Read aloud again") }
                OutlinedButton(onClick = onSilence, Modifier.fillMaxWidth()) { Text("Stop reading") }
                OutlinedButton(onClick = onClose, Modifier.fillMaxWidth()) { Text("Close") }
            }
        },
    )
}

/**
 * The text of a ringing screen and its buttons. Narrow: the buttons under the text. Wide (a foldable's inner display, a
 * tablet): two halves, so that neither lies across the fold.
 */
@Composable
private fun RingPanes(text: @Composable ColumnScope.() -> Unit, buttons: @Composable ColumnScope.() -> Unit) {
    val gap = Arrangement.spacedBy(16.dp)
    if (isWide()) Row(Modifier.fillMaxSize().safeDrawingPadding()) {
        Column(Modifier.weight(1f).fillMaxHeight().padding(24.dp), verticalArrangement = gap, horizontalAlignment = Alignment.CenterHorizontally, content = text)
        Column(Modifier.weight(1f).fillMaxHeight().padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically), horizontalAlignment = Alignment.CenterHorizontally) {
            Column(Modifier.widthIn(max = 420.dp), verticalArrangement = gap, horizontalAlignment = Alignment.CenterHorizontally, content = buttons)
        }
    } else Column(Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp), verticalArrangement = gap, horizontalAlignment = Alignment.CenterHorizontally) {
        text()
        buttons()
    }
}

/** Waking with an article, or with a highlight as a question: Stop and Snooze first, then what can be done with it. */
@Composable
private fun WakeScreen(wake: Wake, snoozeMinutes: Int, onStop: () -> Unit, onSnooze: () -> Unit, onRead: () -> Unit, onSilence: () -> Unit, onClose: () -> Unit, onAnswer: (Boolean) -> Unit, onOpen: () -> Unit) {
    var stopped by remember { mutableStateOf(false) }
    var revealed by remember { mutableStateOf(false) }
    val time = remember { LocalTime.now().format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)) }
    val question = wake.mode == WakeMode.REMEMBER
    BackHandler(enabled = !stopped) { /* the alarm is stopped with its buttons, not by accident */ }
    RingPanes(
        text = {
        Text(time, fontSize = 64.sp, fontWeight = FontWeight.Light)
        Text(if (question) "Remember?" else "From your reading list", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val cloze = wake.cloze
            if (question && cloze != null) {
                // a screen reader says "blank" where the word is missing
                val gap = if (revealed) cloze.answer else "\u2007\u2007\u2007\u2007\u2007\u2007"
                Text(
                    buildAnnotatedString { append(cloze.before); withStyle(SpanStyle(fontWeight = FontWeight.Bold, textDecoration = TextDecoration.Underline)) { append(gap) }; append(cloze.after) },
                    style = MaterialTheme.typography.headlineSmall,
                    modifier = if (revealed) Modifier else Modifier.clearAndSetSemantics { contentDescription = "${cloze.before} blank ${cloze.after}" },
                )
                Text(wake.title, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                Text(wake.title, style = MaterialTheme.typography.headlineSmall)
                if (wake.source.isNotBlank()) Text(wake.source, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                wake.lines.forEach { Text(it, style = MaterialTheme.typography.bodyLarge) }
            }
        }
        },
        buttons = {
        if (!stopped) {
            Button(onClick = { stopped = true; onStop() }, Modifier.fillMaxWidth()) { Text("Stop") }
            OutlinedButton(onClick = onSnooze, Modifier.fillMaxWidth()) { Text("Snooze $snoozeMinutes min") }
        } else {
            if (question && !revealed) Button(onClick = { revealed = true }, Modifier.fillMaxWidth()) { Text("Show the word") }
            if (question && revealed) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { onAnswer(false) }, Modifier.weight(1f)) { Text("Again soon") }
                Button(onClick = { onAnswer(true) }, Modifier.weight(1f)) { Text("I knew it") }
            }
            if (!question) {
                Button(onClick = onRead, Modifier.fillMaxWidth()) { Text("Read from the start") }
                OutlinedButton(onClick = onSilence, Modifier.fillMaxWidth()) { Text("Stop reading") }
            }
            OutlinedButton(onClick = onOpen, Modifier.fillMaxWidth()) { Text("Open the article") }
            TextButton(onClick = onClose) { Text("Close") }
        }
        },
    )
}
