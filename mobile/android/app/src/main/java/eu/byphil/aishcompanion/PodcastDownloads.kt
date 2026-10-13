package eu.byphil.aishcompanion

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.setValue
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/** Episodes saved on the phone so they play without a connection. Files live in filesDir/podcasts, named by a hash of the episode address. */
object PodcastDownloads {
    const val MAX_BYTES = 400L * 1024 * 1024
    private const val SPACE_MARGIN = 200L * 1024 * 1024

    /** Episodes being fetched: address → fraction done (0..1), or -1 while the size is not known yet. */
    val active = mutableStateMapOf<String, Float>()
    /** Bumped when a file appears or disappears, so lists redraw. */
    var version by mutableIntStateOf(0); private set

    fun hash(url: String): String = MessageDigest.getInstance("SHA-1").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }.take(20)
    private fun dir(c: Context) = File(c.applicationContext.filesDir, "podcasts")
    fun fileFor(c: Context, url: String) = File(dir(c), hash(url) + ".audio")
    private fun partFor(c: Context, url: String) = File(dir(c), hash(url) + ".part")

    fun has(c: Context, url: String): Boolean { version; return fileFor(c, url).isFile }
    fun local(c: Context, url: String): File? = fileFor(c, url).takeIf { it.isFile && it.length() > 0 }
    fun totalBytes(c: Context): Long = sizeOf(dir(c))
    fun count(c: Context): Int = dir(c).listFiles()?.count { it.name.endsWith(".audio") } ?: 0

    fun delete(c: Context, url: String) {
        cancel(c, url); fileFor(c, url).delete(); partFor(c, url).delete(); version++
    }
    fun deleteAll(c: Context) { dir(c).listFiles()?.forEach { it.delete() }; active.clear(); version++ }

    fun start(c: Context, url: String) {
        if (!url.startsWith("https://") || has(c, url)) return
        active[url] = active[url] ?: -1f
        val request = OneTimeWorkRequestBuilder<PodcastDownloadWorker>()
            .setInputData(Data.Builder().putString("url", url).build())
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).setRequiresStorageNotLow(true).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
        WorkManager.getInstance(c.applicationContext).enqueueUniqueWork("podcast-" + hash(url), ExistingWorkPolicy.KEEP, request)
    }

    fun cancel(c: Context, url: String) {
        WorkManager.getInstance(c.applicationContext).cancelUniqueWork("podcast-" + hash(url)); active.remove(url)
    }

    internal fun finished(url: String) { active.remove(url); version++ }

    /** null when the file is saved, else "no-space", "too-big", "http-<code>", "network", "cancelled". Continues a partial file. */
    fun download(c: Context, url: String, cancelled: () -> Boolean): String? {
        val dir = dir(c); dir.mkdirs()
        val file = fileFor(c, url); val part = partFor(c, url)
        if (file.isFile) return null
        var have = part.length()
        try {
            var target = URL(url)
            var conn: HttpURLConnection? = null
            for (hop in 0..5) {
                if (target.protocol != "https") return "network"
                val h = target.openConnection() as HttpURLConnection
                h.instanceFollowRedirects = false; h.connectTimeout = 20_000; h.readTimeout = 30_000
                if (have > 0) h.setRequestProperty("Range", "bytes=$have-")
                val code = h.responseCode
                if (code in intArrayOf(301, 302, 303, 307, 308)) {
                    val loc = h.getHeaderField("Location"); h.disconnect()
                    target = URL(target, loc ?: return "network"); continue
                }
                conn = h; break
            }
            val h = conn ?: return "network"
            val code = h.responseCode
            if (code == 416) { part.delete(); h.disconnect(); return "network" }
            if (code != 200 && code != 206) { h.disconnect(); return "http-$code" }
            val append = code == 206 && have > 0
            if (!append) have = 0
            val len = h.contentLengthLong
            val total = if (len > 0) len + have else -1L
            if (total > MAX_BYTES) { h.disconnect(); part.delete(); return "too-big" }
            if (total > 0 && dir.usableSpace < total - have + SPACE_MARGIN) { h.disconnect(); return "no-space" }
            h.inputStream.use { input ->
                FileOutputStream(part, append).use { out ->
                    val buf = ByteArray(64 * 1024)
                    var lastPublished = 0L
                    while (true) {
                        if (cancelled()) return "cancelled"
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n); have += n
                        if (have > MAX_BYTES) { part.delete(); return "too-big" }
                        val now = System.currentTimeMillis()
                        if (now - lastPublished > 300) { lastPublished = now; active[url] = if (total > 0) (have.toFloat() / total).coerceIn(0f, 1f) else -1f }
                    }
                }
            }
            if (total > 0 && part.length() != total) return "network"
        } catch (e: IOException) {
            return "network"   // the partial file stays; the next try continues from it
        }
        if (!part.renameTo(file)) return "network"
        return null
    }
}

class PodcastDownloadWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val url = inputData.getString("url") ?: return@withContext Result.failure()
        when (PodcastDownloads.download(applicationContext, url) { isStopped }) {
            null -> { PodcastDownloads.finished(url); Result.success() }
            "network", "cancelled" -> Result.retry()
            else -> { PodcastDownloads.finished(url); Result.failure() }
        }
    }
}
