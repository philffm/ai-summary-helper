package eu.byphil.aishcompanion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.PlaybackParams
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/** An episode from a feed's audio enclosure. [url] is https. */
data class Episode(val url: String, val title: String, val feed: String)

/** Small pure helpers, unit-tested. */
object PodcastTime {
    /** 83_000 → "1:23", 3_723_000 → "1:02:03". */
    fun format(ms: Int): String {
        val s = (ms.coerceAtLeast(0) / 1000)
        val h = s / 3600; val m = (s % 3600) / 60; val sec = s % 60
        return if (h > 0) "%d:%02d:%02d".format(h, m, sec) else "%d:%02d".format(m, sec)
    }

    /** Where to resume: the saved spot, unless it is within the last 10 seconds (then start again) or nothing is known. */
    fun resumeAt(savedMs: Int, durationMs: Int): Int = if (savedMs <= 0 || (durationMs > 0 && savedMs > durationMs - 10_000)) 0 else savedMs

    /** "12 min" left, rounded up; "under 1 min" at the end. */
    fun sleepLeft(remainingMs: Long): String { val m = ((remainingMs + 59_999) / 60_000).toInt(); return if (remainingMs <= 0) "now" else if (m <= 1) "under 1 min" else "$m min" }

    val SLEEP_MINUTES = listOf(15, 30, 45, 60)

    val SPEEDS = listOf(1f, 1.25f, 1.5f, 2f, 0.8f)
    fun nextSpeed(current: Float): Float = SPEEDS[(SPEEDS.indexOfFirst { it == current } + 1) % SPEEDS.size]
}

/**
 * Plays one podcast episode at a time (streamed from the feed's audio address), keeps the spot per episode, and runs a foreground
 * service with a media notification while an episode is loaded so playback goes on with the screen off. State is Compose state for the mini player.
 */
object PodcastPlayer {
    var episode by mutableStateOf<Episode?>(null); private set
    var playing by mutableStateOf(false); private set
    var loading by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    var speed by mutableFloatStateOf(1f); private set
    var positionMs by mutableIntStateOf(0); private set
    var durationMs by mutableIntStateOf(0); private set

    /** When the sleep timer pauses playback (epoch ms), 0 when it is off. */
    var sleepAtMs by mutableLongStateOf(0L); private set

    private val handler = Handler(Looper.getMainLooper())
    private val sleepRunnable = Runnable { sleepAtMs = 0; fadeOutAndPause() }

    private var player: MediaPlayer? = null
    private var app: Context? = null
    private var focus: AudioFocusRequest? = null
    private var lastSaved = 0L

    /** Pauses after [minutes] (0 turns the timer off). The sound fades out over the last few seconds. */
    fun setSleepTimer(minutes: Int) {
        handler.removeCallbacks(sleepRunnable)
        if (minutes <= 0) { sleepAtMs = 0; return }
        sleepAtMs = System.currentTimeMillis() + minutes * 60_000L
        handler.postDelayed(sleepRunnable, minutes * 60_000L)
    }

    private fun fadeOutAndPause() {
        val mp = player
        if (mp == null || !playing) { pause(); return }
        val steps = 10
        for (i in 1..steps) handler.postDelayed({ if (player === mp) runCatching { val v = 1f - i / steps.toFloat(); mp.setVolume(v, v) } }, i * 300L)
        handler.postDelayed({ if (player === mp) { pause(); runCatching { mp.setVolume(1f, 1f) } } }, (steps + 1) * 300L)
    }

    private fun prefs(c: Context) = c.getSharedPreferences("podcast", Context.MODE_PRIVATE)
    private fun key(url: String) = "pos." + PodcastDownloads.hash(url)

    fun savedPosition(context: Context, url: String): Int = prefs(context.applicationContext).getInt(key(url), 0)
    private fun save(ms: Int) { val c = app ?: return; val e = episode ?: return; prefs(c).edit().putInt(key(e.url), ms).apply() }

    /** Starts [ep], or pauses / resumes when it is the one already loaded. */
    fun play(context: Context, ep: Episode) {
        val c = context.applicationContext; app = c
        if (episode?.url == ep.url && player != null) { toggle(); return }
        release(saveSpot = true)
        episode = ep; loading = true; error = null; positionMs = 0; durationMs = 0
        try {
            val mp = MediaPlayer()
            player = mp
            mp.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            mp.setDataSource(PodcastDownloads.local(c, ep.url)?.absolutePath ?: ep.url)   // a saved copy plays without a connection
            mp.setOnPreparedListener {
                if (player !== mp) return@setOnPreparedListener
                loading = false
                durationMs = mp.duration.coerceAtLeast(0)
                val at = PodcastTime.resumeAt(savedPosition(c, ep.url), durationMs)
                if (at > 0) mp.seekTo(at)
                positionMs = at
                start()
            }
            mp.setOnCompletionListener { if (player === mp) { prefs(c).edit().remove(key(ep.url)).apply(); playing = false; positionMs = 0; abandonFocus(); PodcastService.refresh(c) } }
            mp.setOnErrorListener { _, _, _ -> if (player === mp) { loading = false; playing = false; error = "This episode could not be played."; PodcastService.refresh(c) }; true }
            mp.prepareAsync()
        } catch (_: Exception) {
            loading = false; error = "This episode could not be played."
        }
        PodcastService.refresh(c)
    }

    private fun start() {
        val mp = player ?: return
        if (!requestFocus()) return
        runCatching { mp.playbackParams = PlaybackParams().setSpeed(speed) }
        mp.start(); playing = true
        app?.let { PodcastService.refresh(it) }
    }

    fun pause() {
        val mp = player ?: return
        if (mp.isPlaying) mp.pause()
        playing = false; tick(); save(positionMs); abandonFocus()
        app?.let { PodcastService.refresh(it) }
    }

    fun toggle() { if (playing) pause() else if (player != null && !loading) start() }

    fun seekBy(ms: Int) { seekTo(positionMs + ms) }

    fun seekTo(ms: Int) {
        val mp = player ?: return
        if (loading) return
        val to = ms.coerceIn(0, if (durationMs > 0) durationMs else Int.MAX_VALUE)
        mp.seekTo(to); positionMs = to
    }

    fun cycleSpeed() {
        speed = PodcastTime.nextSpeed(speed)
        val mp = player ?: return
        if (playing) runCatching { mp.playbackParams = PlaybackParams().setSpeed(speed) }   // applying it while paused would start playback on some phones
    }

    /** Called about twice a second by the mini player while it is on screen; also saves the spot every 5 seconds. */
    fun tick() {
        val mp = player ?: return
        if (loading) return
        runCatching { positionMs = mp.currentPosition; if (durationMs <= 0) durationMs = mp.duration.coerceAtLeast(0) }
        val now = System.currentTimeMillis()
        if (playing && now - lastSaved > 5000) { lastSaved = now; save(positionMs) }
    }

    /** Closes the player and the notification. */
    fun stop() {
        setSleepTimer(0)
        release(saveSpot = true); episode = null; playing = false; loading = false; error = null
        app?.let { PodcastService.refresh(it) }
    }

    private fun release(saveSpot: Boolean) {
        val mp = player ?: return
        if (saveSpot && !loading) { tick(); save(positionMs) }
        player = null
        runCatching { mp.setOnPreparedListener(null); mp.setOnCompletionListener(null); mp.setOnErrorListener(null); mp.release() }
        playing = false
        abandonFocus()
    }

    private fun requestFocus(): Boolean {
        val c = app ?: return true
        val am = c.getSystemService(AudioManager::class.java)
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            .setOnAudioFocusChangeListener { change -> if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) pause() }
            .build()
        focus = req
        return am.requestAudioFocus(req) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    private fun abandonFocus() {
        val c = app ?: return
        focus?.let { c.getSystemService(AudioManager::class.java).abandonAudioFocusRequest(it) }
        focus = null
    }
}

/** Foreground service with the media notification (title, play / pause, close) while an episode is loaded. */
class PodcastService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_TOGGLE -> PodcastPlayer.toggle()
            ACTION_CLOSE -> PodcastPlayer.stop()
        }
        val ep = PodcastPlayer.episode
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Podcasts", NotificationManager.IMPORTANCE_LOW).apply { setSound(null, null) })
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        fun action(a: String, code: Int) = PendingIntent.getService(this, code, Intent(this, PodcastService::class.java).setAction(a), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(ep?.title ?: "Podcast").setContentText(ep?.feed ?: "")
            .setContentIntent(open).setOngoing(PodcastPlayer.playing).setOnlyAlertOnce(true).setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT).setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(0, if (PodcastPlayer.playing) "Pause" else "Play", action(ACTION_TOGGLE, 1))
            .addAction(0, "Close", action(ACTION_CLOSE, 2))
            .build()
        ServiceCompat.startForeground(this, NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        if (ep == null) { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() }
        else if (!PodcastPlayer.playing) stopForeground(STOP_FOREGROUND_DETACH)   // paused: the notification stays, the phone may stop the service
        return START_NOT_STICKY
    }

    companion object {
        const val ACTION_TOGGLE = "eu.byphil.aishcompanion.PODCAST_TOGGLE"
        const val ACTION_CLOSE = "eu.byphil.aishcompanion.PODCAST_CLOSE"
        private const val CHANNEL = "podcast"
        private const val NOTIFICATION_ID = 43

        fun refresh(context: Context) {
            try { ContextCompat.startForegroundService(context, Intent(context, PodcastService::class.java)) } catch (_: Exception) { /* app in background: the notification is skipped, playback is unaffected */ }
        }
    }
}
