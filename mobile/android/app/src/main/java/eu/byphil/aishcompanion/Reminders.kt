package eu.byphil.aishcompanion

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.time.Duration
import java.time.ZonedDateTime
import java.util.concurrent.TimeUnit

/** When "Remind me" can fire. Pure, unit-tested. */
object ReminderTimes {
    data class Option(val label: String, val delayMs: Long)

    /** In an hour, this evening (only while it is before 17:00), tomorrow morning. */
    fun options(now: ZonedDateTime): List<Option> {
        val out = ArrayList<Option>()
        out.add(Option("In 1 hour", Duration.ofHours(1).toMillis()))
        val evening = now.withHour(18).withMinute(0).withSecond(0).withNano(0)
        if (now.hour < 17) out.add(Option("This evening, 18:00", Duration.between(now, evening).toMillis()))
        val morning = now.plusDays(1).withHour(8).withMinute(0).withSecond(0).withNano(0)
        out.add(Option("Tomorrow morning, 08:00", Duration.between(now, morning).toMillis()))
        return out
    }
}

/** One notification, one tap: it opens the article (reading list) or the page. */
object Reminders {
    private const val CHANNEL = "reminders"
    const val KEY_TITLE = "title"
    const val KEY_URL = "url"
    const val KEY_ARTICLE = "article"

    fun schedule(context: Context, delayMs: Long, title: String, url: String, articleId: String = "") {
        val data = Data.Builder().putString(KEY_TITLE, title).putString(KEY_URL, url).putString(KEY_ARTICLE, articleId).build()
        val request = OneTimeWorkRequestBuilder<ReminderWorker>().setInitialDelay(delayMs.coerceAtLeast(0), TimeUnit.MILLISECONDS).setInputData(data).build()
        // One reminder per link: setting it again replaces the earlier time.
        val name = "remind-" + (articleId.ifEmpty { url }.hashCode().toUInt().toString(16))
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(name, ExistingWorkPolicy.REPLACE, request)
    }

    fun canNotify(context: Context): Boolean =
        android.os.Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun show(context: Context, title: String, url: String, articleId: String) {
        if (!canNotify(context)) return
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Reminders", NotificationManager.IMPORTANCE_DEFAULT))
        val open = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        if (articleId.isNotEmpty()) open.putExtra(MainActivity.EXTRA_OPEN_ARTICLE, articleId) else if (url.isNotEmpty()) open.putExtra(MainActivity.EXTRA_OPEN_URL, url)
        val pi = PendingIntent.getActivity(context, (articleId.ifEmpty { url }).hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher_foreground).setContentTitle("Time to read").setContentText(title.ifBlank { url })
            .setContentIntent(pi).setAutoCancel(true).setCategory(NotificationCompat.CATEGORY_REMINDER).build()
        nm.notify((articleId.ifEmpty { url }).hashCode(), n)
    }
}

class ReminderWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        Reminders.show(applicationContext, inputData.getString(Reminders.KEY_TITLE).orEmpty(), inputData.getString(Reminders.KEY_URL).orEmpty(), inputData.getString(Reminders.KEY_ARTICLE).orEmpty())
        return Result.success()
    }
}
