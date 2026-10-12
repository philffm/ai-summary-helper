package eu.byphil.aishcompanion

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
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

/**
 * The on-device language model. One fixed, public file: Gemma 4 E2B in the LiteRT-LM format (Apache-2.0, no sign-in).
 * The address names an exact revision of the repository and the size and SHA-256 are checked after the download,
 * so a changed or tampered file is never used.
 */
object ModelSpec {
    const val NAME = "Gemma 4 E2B"
    const val FILE = "gemma-4-E2B-it.litertlm"
    const val SIZE = 2_588_147_712L
    const val SHA256 = "181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c"
    const val URL = "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/b3ca0d2f076785a8f4b2219ddbd2bdb99954eae1/gemma-4-E2B-it.litertlm"
    const val SPACE_MARGIN = 300L * 1024 * 1024
}

/** Where the model file lives (app-private, so removing the app removes it) and how far the download is. */
class ModelStore(val dir: File, private val size: Long = ModelSpec.SIZE, name: String = ModelSpec.FILE) {
    val file = File(dir, name)
    val part = File(dir, "$name.part")
    fun installed(): Boolean = file.isFile && file.length() == size
    fun downloaded(): Long = if (installed()) size else part.length()
    fun delete() { file.delete(); part.delete() }
    val total: Long get() = size

    companion object { fun of(context: Context) = ModelStore(File(context.applicationContext.filesDir, "model")) }
}

/** Resumable download with a manual redirect loop (https only), then size and SHA-256 check. Blocking: call off the main thread. */
object ModelDownloader {
    /** null when the model is installed, else "no-space", "http-<code>", "corrupt", "network", "cancelled". */
    fun download(store: ModelStore, url: String = ModelSpec.URL, sha256: String = ModelSpec.SHA256, cancelled: () -> Boolean = { false }): String? {
        store.dir.mkdirs()
        if (store.installed()) return null
        var have = store.part.length()
        if (have > store.total) { store.part.delete(); have = 0 }
        if (store.dir.usableSpace < store.total - have + ModelSpec.SPACE_MARGIN) return "no-space"
        try {
            var target = URL(url)
            var conn: HttpURLConnection? = null
            for (hop in 0..5) {
                if (target.protocol != "https") return "network"
                val c = target.openConnection() as HttpURLConnection
                c.instanceFollowRedirects = false; c.connectTimeout = 20_000; c.readTimeout = 30_000
                if (have > 0) c.setRequestProperty("Range", "bytes=$have-")
                val code = c.responseCode
                if (code in intArrayOf(301, 302, 303, 307, 308)) {
                    val loc = c.getHeaderField("Location"); c.disconnect()
                    target = URL(target, loc ?: return "network"); continue
                }
                conn = c; break
            }
            val c = conn ?: return "network"
            val code = c.responseCode
            if (code == 416) { store.part.delete(); c.disconnect(); return "network" }   // our partial file did not fit; start over next time
            if (code != 200 && code != 206) { c.disconnect(); return "http-$code" }
            val append = code == 206 && have > 0
            if (!append) have = 0
            c.inputStream.use { input ->
                FileOutputStream(store.part, append).use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        if (cancelled()) return "cancelled"
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        have += n
                        if (have > store.total) { store.part.delete(); return "corrupt" }
                    }
                }
            }
        } catch (e: IOException) {
            return "network"   // the partial file stays, the next try continues from it
        }
        if (store.part.length() != store.total) return "network"
        if (!sha256Of(store.part).equals(sha256, ignoreCase = true)) { store.part.delete(); return "corrupt" }
        store.file.delete()
        return if (store.part.renameTo(store.file)) null else "corrupt"
    }

    fun sha256Of(f: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { i -> val buf = ByteArray(1 shl 16); while (true) { val n = i.read(buf); if (n < 0) break; md.update(buf, 0, n) } }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}

/** Downloads in the background on unmetered networks (Wi-Fi); a stopped or interrupted download continues from the partial file. */
class ModelDownloadWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        when (ModelDownloader.download(ModelStore.of(applicationContext), cancelled = { isStopped })) {
            null -> Result.success()
            "network", "cancelled" -> Result.retry()
            else -> Result.failure()
        }
    }

    companion object {
        const val NAME = "model-download"
        fun start(context: Context) {
            val request = OneTimeWorkRequestBuilder<ModelDownloadWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.UNMETERED).setRequiresStorageNotLow(true).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
            WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(NAME, ExistingWorkPolicy.KEEP, request)
        }
        fun cancel(context: Context) { WorkManager.getInstance(context.applicationContext).cancelUniqueWork(NAME) }
    }
}
