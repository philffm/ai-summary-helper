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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.text.input.PasswordVisualTransformation
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
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
    androidx.compose.runtime.LaunchedEffect(a) { Guard.end(context, "alarm") }   // drawn fine with these settings

    SettingsGroup {
        ToggleRow("⏰ Morning alarm", "Wakes you and reads your feed briefing. No AI needed, so it also works offline.", a.enabled) { on ->
            update(a.copy(enabled = on))
            if (on && Build.VERSION.SDK_INT >= 33) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        model.alarmError?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
    }
    if (a.enabled) {
        val is24 = DateFormat.is24HourFormat(context)
        SettingsCaption("When")
        SettingsGroup {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Time", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                OutlinedButton(onClick = { pickTime = true }) { Text(formatTime(a.hour, a.minute, is24), style = MaterialTheme.typography.titleMedium) }
            }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Days", style = MaterialTheme.typography.bodyLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (i in 0..6) {
                        FilterChip(
                            selected = (a.days and (1 shl i)) != 0,
                            onClick = { update(a.copy(days = a.days xor (1 shl i))) },
                            label = { Text(DayOfWeek.of(i + 1).getDisplayName(TextStyle.SHORT, Locale.getDefault())) },
                        )
                    }
                }
                val next = AlarmScheduler.nextRing(context)
                Text(
                    if (next == null) "Pick at least one day." else "Next alarm: " + java.time.format.DateTimeFormatter.ofPattern("EEE d MMM, HH:mm", Locale.getDefault()).format(Instant.ofEpochMilli(next).atZone(ZoneId.systemDefault())) +
                        ". The briefing is prepared about 20 minutes before.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (!fullScreenAllowed) {
                Text("To show the alarm over the lock screen, allow full-screen alerts for this app.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                TextButton(onClick = { context.startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${context.packageName}"))) }) { Text("Allow full-screen alerts") }
            }
        }

        SettingsCaption("Sound")
        val ringtones = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
            val picked: Uri? = r.data?.let { d -> if (android.os.Build.VERSION.SDK_INT >= 33) d.getParcelableExtra(android.media.RingtoneManager.EXTRA_RINGTONE_PICKED_URI, Uri::class.java) else @Suppress("DEPRECATION") d.getParcelableExtra(android.media.RingtoneManager.EXTRA_RINGTONE_PICKED_URI) }
            if (r.resultCode == android.app.Activity.RESULT_OK && picked != null) {
                // the phone's default alarm stays "default", so it follows the system setting
                update(a.copy(sound = if (picked == android.provider.Settings.System.DEFAULT_ALARM_ALERT_URI) "" else picked.toString()))
            }
        }
        val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri != null) {
                runCatching { context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
                update(a.copy(sound = uri.toString()))
            }
        }
        SettingsGroup {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Wake-up sound", style = MaterialTheme.typography.bodyLarge)
                Text(soundName(context, a.sound), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = {
                        val current = if (a.sound.isBlank()) android.media.RingtoneManager.getActualDefaultRingtoneUri(context, android.media.RingtoneManager.TYPE_ALARM) else Uri.parse(a.sound)
                        ringtones.launch(Intent(android.media.RingtoneManager.ACTION_RINGTONE_PICKER)
                            .putExtra(android.media.RingtoneManager.EXTRA_RINGTONE_TYPE, android.media.RingtoneManager.TYPE_ALARM)
                            .putExtra(android.media.RingtoneManager.EXTRA_RINGTONE_TITLE, "Wake-up sound")
                            .putExtra(android.media.RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true)
                            .putExtra(android.media.RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false)
                            .putExtra(android.media.RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, current))
                    }) { Text("Alarm sounds") }
                    OutlinedButton(onClick = { picker.launch(arrayOf("audio/*")) }) { Text("Music file…") }
                    if (a.sound.isNotBlank()) TextButton(onClick = { update(a.copy(sound = "")) }) { Text("Phone default") }
                }
            }
            ToggleRow("Fade in the sound", "Starts quietly and rises for about 45 seconds. Then the briefing is spoken while the music plays softer. Stop ends both.", a.fadeIn) { update(a.copy(fadeIn = it)) }
        }

        SettingsCaption("Briefing")
        SettingsGroup {
            ToggleRow("Read the briefing aloud", "After Stop, or over the music when the sound fades in.", a.readAloud) { update(a.copy(readAloud = it)) }
            if (a.fadeIn && !a.readAloud) Text("Switch on reading aloud to hear the briefing over the music.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            ChoiceRow(
                "News in the briefing",
                when (a.newsMode) {
                    NewsMode.ALL -> "Everything new from your feeds."
                    NewsMode.NO_BAD -> "Leaves out war, crime, disasters and death; everything else stays."
                    NewsMode.GOOD -> "Only stories rated positive. Works best with the on-device AI rating."
                },
                listOf(NewsMode.ALL.name to "All news", NewsMode.NO_BAD.name to "No bad news", NewsMode.GOOD.name to "Good only"),
                a.newsMode.name,
            ) { update(a.copy(newsMode = NewsMode.of(it))) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { preview = buildBriefingNow(context) }) { Text("Preview briefing") }
                OutlinedButton(onClick = { AlarmScheduler.ringIn(context, 10); model.message = "The alarm will ring in 10 seconds." }) { Text("Test ring") }
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

/** The name of the chosen sound file, or a label for the phone's alarm sound. */
private fun soundName(context: android.content.Context, sound: String): String {
    if (sound.isBlank()) return "Phone alarm sound"
    runCatching { android.media.RingtoneManager.getRingtone(context, Uri.parse(sound))?.getTitle(context) }.getOrNull()?.takeIf { it.isNotBlank() && !it.startsWith("content:") }?.let { return it }
    return runCatching {
        context.contentResolver.query(Uri.parse(sound), arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
    }.getOrNull() ?: "Chosen sound"
}

private fun formatTime(hour: Int, minute: Int, is24: Boolean): String =
    if (is24) "%02d:%02d".format(hour, minute) else "%d:%02d %s".format(if (hour % 12 == 0) 12 else hour % 12, minute, if (hour < 12) "AM" else "PM")

/** Settings card for the cloud extra: a fun fact of the day or your own prompt, added to the end of the briefing. */
@Composable
fun ExtrasCard(model: AppModel) {
    val a = model.alarm
    val scope = rememberCoroutineScope()
    val saved = model.license
    var license by remember(saved) { mutableStateOf(saved) }
    var prompt by remember { mutableStateOf(a.extraPrompt) }
    var busy by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf<String?>(null) }

    fun checkLicense(key: String) {
        status = "Checking…"
        scope.launch { status = Account.describe(withContext(Dispatchers.IO) { Account.check(key) }) }
    }
    androidx.compose.runtime.LaunchedEffect(saved) { if (saved.isNotBlank()) checkLicense(saved) else status = null }

    SettingsGroup {
        ToggleRow("✨ Extra from the cloud AI", "A fun fact of the day, or anything you ask for, added to the end of your briefing.", a.extraOn) { model.changeAlarm(a.copy(extraOn = it)) }
            OutlinedTextField(license, { license = it }, Modifier.fillMaxWidth(), label = { Text("Pro license key (from the extension code or pasted)") }, singleLine = true, visualTransformation = PasswordVisualTransformation())
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedButton(enabled = license.isNotBlank() && license.trim() != saved, onClick = { model.saveLicense(license) }) { Text("Save key") }
                status?.let { Text(it, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f)) }
            }
            if (a.extraOn) {
                Text("Only the prompt below, today's date and your language are sent, with your Pro license key, to api.byphil.eu. Your feeds and reading list never leave the phone. The cloud AI cannot look things up, so ask for facts and stories, not live data.", style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(prompt, { prompt = it.take(CloudExtra.MAX_PROMPT) }, Modifier.fillMaxWidth(), label = { Text("What should it say? (empty: a fun fact)") }, maxLines = 3)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { model.changeAlarm(a.copy(extraPrompt = prompt.trim())) }) { Text("Save prompt") }
                    OutlinedButton(enabled = !busy && license.isNotBlank(), onClick = {
                        busy = true; model.saveLicense(license)
                        scope.launch {
                            val text = withContext(Dispatchers.IO) { CloudExtra.fetch(license, prompt, language = SummaryLangs.feedLanguage(model.store.summaryLang)) }
                            if (text != null) model.store.bumpCloud()
                            result = text ?: "No answer. Check the license key, your monthly allowance and the connection."
                            busy = false
                        }
                    }) { Text(if (busy) "Asking…" else "Try it now") }
                }
            }
    }
    result?.let { text ->
        AlertDialog(onDismissRequest = { result = null }, title = { Text("Your extra") }, text = { Text(text) }, confirmButton = { TextButton(onClick = { result = null }) { Text("Close") } })
    }
}
