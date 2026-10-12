package eu.byphil.aishcompanion

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.util.concurrent.TimeUnit

/** The morning alarm. [days] is a bit mask, bit 0 = Monday … bit 6 = Sunday. */
data class AlarmSettings(
    val enabled: Boolean = false,
    val hour: Int = 7,
    val minute: Int = 0,
    val days: Int = ALL_DAYS,
    val readAloud: Boolean = true,
    val snoozeMinutes: Int = 10,
    /** Let the on-device model write the briefing (when it is downloaded). */
    val useAi: Boolean = false,
    /** Leave out stories about war, crime, disasters and death. */
    val goodNewsOnly: Boolean = false,
    /** Ask the cloud AI for one extra item (a fun fact, or [extraPrompt]); only that prompt is sent, never your feeds. */
    val extraOn: Boolean = false,
    val extraPrompt: String = "",
) {
    companion object { const val ALL_DAYS = 0b1111111 }
}

object AlarmTime {
    /** The next time after [now] that falls on one of [days] at [hour]:[minute] in [zone]; null when no day is chosen. */
    fun next(now: Long, zone: ZoneId, hour: Int, minute: Int, days: Int): Long? {
        if ((days and AlarmSettings.ALL_DAYS) == 0) return null
        val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        for (offset in 0L..7L) {
            val day = today.plusDays(offset)
            if ((days and (1 shl (day.dayOfWeek.value - 1))) == 0) continue
            val at = day.atTime(hour, minute).atZone(zone).toInstant().toEpochMilli()   // a skipped hour (daylight saving) moves forward
            if (at > now) return at
        }
        return null
    }
}

/**
 * Sets the system alarm clock (AlarmManager.setAlarmClock: shown in the status bar, survives battery saving, needs no special permission)
 * and, 20 minutes before it, a background job that refreshes the feeds and prepares the briefing.
 */
object AlarmScheduler {
    const val ACTION_RING = "eu.byphil.aishcompanion.RING"
    private const val REQ_ALARM = 1001
    private const val REQ_SHOW = 1002
    private const val REQ_SOON = 1003
    private const val PREPARE_LEAD_MS = 20L * 60_000

    private fun ringIntent(app: Context, request: Int, at: Long): PendingIntent =
        PendingIntent.getBroadcast(app, request, Intent(app, AlarmReceiver::class.java).setAction(ACTION_RING).putExtra("at", at), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun showIntent(app: Context): PendingIntent =
        PendingIntent.getActivity(app, REQ_SHOW, Intent(app, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    /** The time of the next regular ring, or null when the alarm is off. */
    fun nextRing(app: Context, now: Long = System.currentTimeMillis()): Long? {
        val s = Store(app).alarm
        return if (s.enabled) AlarmTime.next(now, ZoneId.systemDefault(), s.hour, s.minute, s.days) else null
    }

    /** Makes the system alarm and the preparation job match the saved settings. Safe to call any time. */
    fun reschedule(context: Context) {
        val app = context.applicationContext
        val am = app.getSystemService(AlarmManager::class.java)
        val now = System.currentTimeMillis()
        val at = nextRing(app, now)
        if (at == null) {
            am.cancel(ringIntent(app, REQ_ALARM, 0))
            WorkManager.getInstance(app).cancelUniqueWork("prepare-briefing")
            return
        }
        am.setAlarmClock(AlarmManager.AlarmClockInfo(at, showIntent(app)), ringIntent(app, REQ_ALARM, at))
        val delay = (at - PREPARE_LEAD_MS - now).coerceAtLeast(0)
        WorkManager.getInstance(app).enqueueUniqueWork("prepare-briefing", ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<BriefingWorker>().setInitialDelay(delay, TimeUnit.MILLISECONDS).build())
    }

    /** One extra ring after [seconds] (snooze and the test button). It does not touch the regular alarm. */
    fun ringIn(context: Context, seconds: Long) {
        val app = context.applicationContext
        val at = System.currentTimeMillis() + seconds * 1000
        app.getSystemService(AlarmManager::class.java).setAlarmClock(AlarmManager.AlarmClockInfo(at, showIntent(app)), ringIntent(app, REQ_SOON, at))
    }
}

/** Fires when the alarm time comes: starts the ringing service. */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != AlarmScheduler.ACTION_RING) return
        AlarmScheduler.reschedule(context)   // the next day's alarm
        context.startForegroundService(Intent(context, AlarmService::class.java))
    }
}

/** Alarms are forgotten when the phone restarts, the app is updated, or the clock or time zone changes. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) { AlarmScheduler.reschedule(context) }
}

/** Plays the alarm sound and vibrates until stopped (or for five minutes), with a full-screen notification that opens [RingActivity]. */
class AlarmService : Service() {
    private var player: MediaPlayer? = null
    private val handler = Handler(Looper.getMainLooper())

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { stopRinging(); return START_NOT_STICKY }
        val channel = NotificationChannel(CHANNEL, "Alarm", NotificationManager.IMPORTANCE_HIGH).apply {
            setSound(null, null); lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        val open = PendingIntent.getActivity(this, 0, Intent(this, RingActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1, Intent(this, AlarmService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("Good morning").setContentText("Tap to stop the alarm and hear your briefing")
            .setCategory(NotificationCompat.CATEGORY_ALARM).setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true).setContentIntent(open).setFullScreenIntent(open, true)
            .addAction(0, "Stop", stop).build()
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        startRinging()
        handler.removeCallbacksAndMessages(null)
        handler.postDelayed({ stopRinging() }, 5 * 60_000)
        return START_NOT_STICKY
    }

    private fun startRinging() {
        if (player != null) return
        runCatching {
            val uri = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            player = MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                setDataSource(this@AlarmService, uri)
                isLooping = true
                prepare(); start()
            }
        }
        runCatching { getSystemService(Vibrator::class.java).vibrate(VibrationEffect.createWaveform(longArrayOf(0, 600, 600), 0)) }
    }

    private fun stopRinging() {
        handler.removeCallbacksAndMessages(null)
        runCatching { player?.stop() }; runCatching { player?.release() }; player = null
        runCatching { getSystemService(Vibrator::class.java).cancel() }
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() { runCatching { player?.release() }; player = null; handler.removeCallbacksAndMessages(null); super.onDestroy() }

    companion object {
        const val ACTION_STOP = "eu.byphil.aishcompanion.STOP"
        private const val CHANNEL = "alarm"
        private const val NOTIFICATION_ID = 42

        fun stop(context: Context) { context.startService(Intent(context, AlarmService::class.java).setAction(ACTION_STOP)) }
    }
}

/** Builds the briefing from what is on the phone now. */
fun buildBriefingNow(context: Context, now: Long = System.currentTimeMillis()): Briefing {
    val app = context.applicationContext
    val articles = ArticleStore(app)
    val unread = articles.list().count { !articles.isRead(it.id) }
    return BriefingBuilder.build(FeedStore(File(app.filesDir, "feeds")).everything(), unread, now, Store(app).alarm.goodNewsOnly)
}

/** The prepared briefing if it is recent (the job ran before the alarm), else one built right now. Never throws. */
fun loadBriefing(context: Context, now: Long = System.currentTimeMillis()): Briefing {
    val saved = Briefing.fromJson(Store(context).briefingJson)
    return if (saved != null && now - saved.builtAt in 0..3 * 3600_000L) saved else buildBriefingNow(context, now)
}

/** Runs shortly before the alarm: fetches the feeds (up to four minutes; offline is fine) and stores the briefing. */
class BriefingWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        runCatching { withTimeoutOrNull(240_000) { AppModel(applicationContext).refreshAll(force = true) } }
        val store = Store(applicationContext)
        var plain = runCatching { buildBriefingNow(applicationContext) }.getOrNull() ?: return Result.success()
        store.briefingJson = plain.toJson()   // saved first: the alarm has a briefing even if the model is slow or fails
        val settings = store.alarm
        if (settings.goodNewsOnly && LocalLlm.installed(applicationContext)) {
            // Rate the new stories by mood first, so "good news only" goes by the model's judgement and not just the word list.
            val feedStore = FeedStore(File(applicationContext.filesDir, "feeds"))
            val rated = withContext(Dispatchers.Default) { runCatching { MoodRater.rate(applicationContext, feedStore, feedStore.everything()) }.getOrDefault(0) }
            if (rated > 0) { plain = buildBriefingNow(applicationContext); store.briefingJson = plain.toJson() }
        }
        var current = plain
        if (settings.extraOn) {
            val extra = withContext(Dispatchers.IO) { CloudExtra.fetch(store.license, settings.extraPrompt) }
            if (extra != null) { current = current.copy(extra = extra); store.briefingJson = current.toJson() }
        }
        if (settings.useAi && LocalLlm.installed(applicationContext)) {
            val text = withContext(Dispatchers.Default) { LocalLlm.narrate(applicationContext, plain.items, plain.readingUnread, java.time.LocalTime.now().hour, settings.goodNewsOnly) }
            if (text != null) store.briefingJson = current.copy(narration = text, builtAt = System.currentTimeMillis()).toJson()
        }
        return Result.success()
    }
}
