package eu.byphil.aishcompanion

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bedtime
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Forward30
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay10
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/** Sits above the navigation bar while an episode is loaded: title, progress, play / pause, -10 s, +30 s, speed, close. */
@Composable
fun MiniPlayer() {
    val ep = PodcastPlayer.episode ?: return
    LaunchedEffect(ep.url) { while (true) { PodcastPlayer.tick(); delay(500) } }
    var dragging by remember { mutableStateOf<Float?>(null) }
    val duration = PodcastPlayer.durationMs
    val fraction = if (duration > 0) PodcastPlayer.positionMs.toFloat() / duration else 0f
    Surface(color = MaterialTheme.colorScheme.secondaryContainer, tonalElevation = 3.dp, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(start = 16.dp, end = 4.dp, top = 6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(ep.title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(PodcastPlayer.error ?: ep.feed, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        color = if (PodcastPlayer.error != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Box {
                    var sleepMenu by remember { mutableStateOf(false) }
                    val sleepAt = PodcastPlayer.sleepAtMs
                    TextButton(onClick = { sleepMenu = true }) {
                        Icon(Icons.Filled.Bedtime, contentDescription = "Sleep timer", modifier = Modifier.size(20.dp))
                        if (sleepAt > 0) Text(" " + PodcastTime.sleepLeft(sleepAt - System.currentTimeMillis()), style = MaterialTheme.typography.labelMedium)
                    }
                    DropdownMenu(expanded = sleepMenu, onDismissRequest = { sleepMenu = false }) {
                        for (m in PodcastTime.SLEEP_MINUTES) DropdownMenuItem(text = { Text("Pause in $m minutes") }, onClick = { PodcastPlayer.setSleepTimer(m); sleepMenu = false })
                        if (sleepAt > 0) DropdownMenuItem(text = { Text("Turn sleep timer off") }, onClick = { PodcastPlayer.setSleepTimer(0); sleepMenu = false })
                    }
                }
                IconButton(onClick = { PodcastPlayer.stop() }) { Icon(Icons.Filled.Close, contentDescription = "Close player") }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(0.dp)) {
                IconButton(onClick = { PodcastPlayer.toggle() }) {
                    if (PodcastPlayer.loading) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                    else Icon(if (PodcastPlayer.playing) Icons.Filled.Pause else Icons.Filled.PlayArrow, contentDescription = if (PodcastPlayer.playing) "Pause" else "Play")
                }
                IconButton(onClick = { PodcastPlayer.seekBy(-10_000) }) { Icon(Icons.Filled.Replay10, contentDescription = "Back 10 seconds") }
                IconButton(onClick = { PodcastPlayer.seekBy(30_000) }) { Icon(Icons.Filled.Forward30, contentDescription = "Forward 30 seconds") }
                Slider(
                    value = dragging ?: fraction, onValueChange = { dragging = it },
                    onValueChangeFinished = { dragging?.let { PodcastPlayer.seekTo((it * duration).toInt()) }; dragging = null },
                    enabled = duration > 0, modifier = Modifier.weight(1f),
                )
                TextButton(onClick = { PodcastPlayer.cycleSpeed() }) { Text(PodcastPlayer.speed.toString().removeSuffix(".0") + "×") }
            }
            if (duration > 0) Text(PodcastTime.format(PodcastPlayer.positionMs) + " / " + PodcastTime.format(duration), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 4.dp, bottom = 4.dp))
        }
    }
}
