package eu.byphil.aishcompanion

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay10
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.delay

/** Speed reading (RSVP): one word at a time, the anchor letter in the accent colour so the eye does not move. */
@Composable
fun SpeedReadDialog(words: List<String>, wpm: Int, onWpm: (Int) -> Unit, onClose: () -> Unit) {
    var index by remember { mutableIntStateOf(0) }
    var playing by remember { mutableStateOf(false) }
    LaunchedEffect(playing, wpm) {
        while (playing && index < words.size) {
            delay(Rsvp.delayMs(words[index], wpm))
            if (index < words.size - 1) index++ else playing = false
        }
    }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
            Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.SpaceBetween) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    IconButton(onClick = onClose) { Icon(Icons.Filled.Close, contentDescription = "Close") }
                }
                Box(Modifier.fillMaxWidth().padding(vertical = 24.dp), contentAlignment = Alignment.Center) {
                    val w = words.getOrNull(index).orEmpty()
                    val p = Rsvp.pivot(w).coerceIn(0, (w.length - 1).coerceAtLeast(0))
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(w.take(p), Modifier.weight(1f), textAlign = TextAlign.End, fontSize = 36.sp, fontFamily = FontFamily.Monospace)
                        Text(if (w.isEmpty()) "" else w[p].toString(), fontSize = 36.sp, fontFamily = FontFamily.Monospace, color = MaterialTheme.colorScheme.primary)
                        Text(if (w.length > p + 1) w.substring(p + 1) else "", Modifier.weight(1f), fontSize = 36.sp, fontFamily = FontFamily.Monospace)
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Slider(value = index.toFloat(), onValueChange = { index = it.toInt().coerceIn(0, (words.size - 1).coerceAtLeast(0)) }, valueRange = 0f..(words.size - 1).coerceAtLeast(1).toFloat())
                    Text(
                        "${index + 1} / ${words.size} · about ${Rsvp.minutesLeft(words.size - index, wpm)} min left",
                        style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center,
                    )
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
                        OutlinedButton(onClick = { onWpm(wpm - 25) }) { Text("−25") }
                        IconButton(onClick = { index = (index - 10).coerceAtLeast(0) }) { Icon(Icons.Filled.Replay10, contentDescription = "Back 10 words") }
                        FilledIconButton(onClick = { if (index >= words.size - 1) index = 0; playing = !playing }) {
                            Icon(if (playing) Icons.Filled.Pause else Icons.Filled.PlayArrow, contentDescription = if (playing) "Pause" else "Play")
                        }
                        Text("$wpm wpm", style = MaterialTheme.typography.titleMedium)
                        OutlinedButton(onClick = { onWpm(wpm + 25) }) { Text("+25") }
                    }
                }
            }
        }
    }
}
