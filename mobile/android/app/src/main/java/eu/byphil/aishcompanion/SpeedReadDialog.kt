package eu.byphil.aishcompanion

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FastForward
import androidx.compose.material.icons.filled.FastRewind
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.delay

/**
 * Speed reading (RSVP), like the extension's Speed-Read (Figma AISH-036, variant C): the word with its anchor letter in the
 * accent colour, the sentence it belongs to above it. Pausing shows the paragraph; tap a sentence to read from there.
 * Same timing as the extension (Rsvp.kt ↔ plugin/src/modules/rsvp.js). Starts paused (nothing moves until you press play).
 */
@Composable
fun SpeedReadDialog(text: Rsvp.Built, wpm: Int, onWpm: (Int) -> Unit, onClose: () -> Unit) {
    val words = text.words
    var index by remember { mutableIntStateOf(0) }
    var playing by remember { mutableStateOf(false) }
    LaunchedEffect(playing, wpm) {
        while (playing && index < words.size) {
            val w = words[index]
            delay(Rsvp.delayMs(w.w, wpm, index, text.sentences.getOrNull(w.s)?.heading == true))
            if (index < words.size - 1) index++ else playing = false
        }
    }
    val current = words.getOrNull(index)
    val sentence = current?.let { text.sentences.getOrNull(it.s) }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
            Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.SpaceBetween) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    IconButton(onClick = onClose) { Icon(Icons.Filled.Close, contentDescription = "Close") }
                }
                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    val boxMod = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(12.dp)).padding(12.dp)
                    if (!playing && current != null) {
                        // paused: the paragraph around the word (the sentence before, this one, the one after)
                        val para = text.paragraphs.firstOrNull { current.s in it } ?: listOf(current.s)
                        val pos = para.indexOf(current.s)
                        Column(boxMod, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            for (si in para.subList((pos - 1).coerceAtLeast(0), (pos + 2).coerceAtMost(para.size))) {
                                Text(
                                    text.sentences[si].text,
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = if (si == current.s) FontWeight.SemiBold else FontWeight.Normal,
                                    color = if (si == current.s) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.fillMaxWidth().clickable { index = text.sentences[si].first; playing = true },
                                )
                            }
                            Text("Tap a sentence to read from there", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    } else if (sentence != null && current != null) {
                        // reading: the sentence above, the current word marked
                        val accent = MaterialTheme.colorScheme.primary
                        Text(
                            buildAnnotatedString {
                                sentence.text.split(' ').filter { it.isNotEmpty() }.forEachIndexed { k, w ->
                                    if (k > 0) append(' ')
                                    if (sentence.first + k == index) withStyle(SpanStyle(color = accent, fontWeight = FontWeight.SemiBold)) { append(w) } else append(w)
                                }
                            },
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, modifier = boxMod,
                        )
                    }
                    Box(Modifier.fillMaxWidth().padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
                        val w = current?.w.orEmpty()
                        val p = Rsvp.pivot(w).coerceIn(0, (w.length - 1).coerceAtLeast(0))
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Text(w.take(p), Modifier.weight(1f), textAlign = TextAlign.End, fontSize = 40.sp, fontWeight = FontWeight.SemiBold)
                            Text(if (w.isEmpty()) "" else w[p].toString(), fontSize = 40.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary)
                            Text(if (w.length > p + 1) w.substring(p + 1) else "", Modifier.weight(1f), fontSize = 40.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    LinearProgressIndicator(progress = { if (words.isEmpty()) 0f else (index + 1f) / words.size }, modifier = Modifier.fillMaxWidth())
                    Text(
                        "Sentence ${(current?.s ?: 0) + 1} of ${text.sentences.size} · ${Rsvp.secondsLeft(text, index, wpm)} s left",
                        style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center,
                    )
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
                        OutlinedButton(onClick = { onWpm(wpm - Rsvp.STEP_WPM) }) { Text("−") }
                        IconButton(onClick = { index = Rsvp.sentenceStart(text, index, -1) }) { Icon(Icons.Filled.FastRewind, contentDescription = "Previous sentence") }
                        FilledIconButton(onClick = { if (index >= words.size - 1) index = 0; playing = !playing }) {
                            Icon(if (playing) Icons.Filled.Pause else Icons.Filled.PlayArrow, contentDescription = if (playing) "Pause" else "Play")
                        }
                        IconButton(onClick = { index = Rsvp.sentenceStart(text, index, 1) }) { Icon(Icons.Filled.FastForward, contentDescription = "Next sentence") }
                        OutlinedButton(onClick = { onWpm(wpm + Rsvp.STEP_WPM) }) { Text("+") }
                    }
                    Text("$wpm WPM", style = MaterialTheme.typography.titleMedium, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
                }
            }
        }
    }
}
