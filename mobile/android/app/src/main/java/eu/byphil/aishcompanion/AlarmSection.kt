package eu.byphil.aishcompanion

import android.Manifest
import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.text.format.DateFormat
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import java.time.DayOfWeek
import java.time.Instant
import java.time.ZoneId
import java.time.format.TextStyle
import java.util.Locale

/** Settings card for the morning alarm: on/off, time, days, read aloud, a preview of the briefing and a test ring. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun AlarmCard(model: AppModel) {
    val context = LocalContext.current
    val a = model.alarm
    var pickTime by remember { mutableStateOf(false) }
    var preview by remember { mutableStateOf<Briefing?>(null) }
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    val fullScreenAllowed = Build.VERSION.SDK_INT < 34 || context.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()

    fun update(next: AlarmSettings) = model.changeAlarm(next)

    Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Morning alarm", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text("Wakes you and reads your feed briefing. No AI, so it also works offline.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked = a.enabled, onCheckedChange = { on ->
                    update(a.copy(enabled = on))
                    if (on && Build.VERSION.SDK_INT >= 33) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                })
            }
            if (a.enabled) {
                val is24 = DateFormat.is24HourFormat(context)
                OutlinedButton(onClick = { pickTime = true }, Modifier.fillMaxWidth()) { Text(formatTime(a.hour, a.minute, is24), style = MaterialTheme.typography.headlineSmall) }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (i in 0..6) {
                        FilterChip(
                            selected = (a.days and (1 shl i)) != 0,
                            onClick = { update(a.copy(days = a.days xor (1 shl i))) },
                            label = { Text(DayOfWeek.of(i + 1).getDisplayName(TextStyle.SHORT, Locale.getDefault())) },
                        )
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Read the briefing aloud after Stop", Modifier.weight(1f))
                    Switch(checked = a.readAloud, onCheckedChange = { update(a.copy(readAloud = it)) })
                }
                val next = AlarmScheduler.nextRing(context)
                Text(
                    if (next == null) "Pick at least one day." else "Next alarm: " + java.time.format.DateTimeFormatter.ofPattern("EEE d MMM, HH:mm", Locale.getDefault()).format(Instant.ofEpochMilli(next).atZone(ZoneId.systemDefault())) +
                        ". The briefing is prepared about 20 minutes before.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (!fullScreenAllowed) {
                    Text("To show the alarm over the lock screen, allow full-screen alerts for this app.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = { context.startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${context.packageName}"))) }) { Text("Allow full-screen alerts") }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { preview = buildBriefingNow(context) }) { Text("Preview briefing") }
                    OutlinedButton(onClick = { AlarmScheduler.ringIn(context, 10); model.message = "The alarm will ring in 10 seconds." }) { Text("Test ring") }
                }
            }
        }
    }

    if (pickTime) {
        val state = rememberTimePickerState(a.hour, a.minute, DateFormat.is24HourFormat(context))
        Dialog(onDismissRequest = { pickTime = false }) {
            Surface(shape = MaterialTheme.shapes.extraLarge, tonalElevation = 6.dp) {
                Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    TimePicker(state = state)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        TextButton(onClick = { pickTime = false }) { Text("Cancel") }
                        TextButton(onClick = { update(a.copy(hour = state.hour, minute = state.minute)); pickTime = false }) { Text("OK") }
                    }
                }
            }
        }
    }

    preview?.let { b ->
        AlertDialog(
            onDismissRequest = { preview = null },
            title = { Text("Your briefing now") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (b.items.isEmpty()) Text("Nothing new in your feeds right now.")
                    b.lines().forEachIndexed { i, l -> Text("${i + 1}. $l") }
                    if (b.readingUnread > 0) Text("${b.readingUnread} unread in your reading list", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            },
            confirmButton = { TextButton(onClick = { preview = null }) { Text("Close") } },
        )
    }
}

private fun formatTime(hour: Int, minute: Int, is24: Boolean): String =
    if (is24) "%02d:%02d".format(hour, minute) else "%d:%02d %s".format(if (hour % 12 == 0) 12 else hour % 12, minute, if (hour < 12) "AM" else "PM")
