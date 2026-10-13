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

/** One downloadable model: an exact revision of a public repository, size and SHA-256 checked after the download. */
data class ModelOption(
    val id: String, val name: String, val file: String, val size: Long, val sha256: String, val url: String,
    /** 1 (small) to 4 (best): used to pick the best model a phone can run well. */
    val quality: Int, val blurb: String,
    /** Gigabytes actually read for every word written: less than the file when part of it is a lookup table (Gemma's per-layer embeddings). */
    val activeGb: Double = size / 1e9,
) {
    val gb: Double get() = size / 1e9
    /** Memory the model needs while it works: the file itself plus the working memory (context and runtime). */
    val needGb: Double get() = gb * 1.2 + 0.6
}

/** The models the phone can use. Gemma 4 E2B stays the default; the others are chosen after a quick check of the phone. */
object Models {
    val DEFAULT = ModelOption("gemma-4-e2b", ModelSpec.NAME, ModelSpec.FILE, ModelSpec.SIZE, ModelSpec.SHA256, ModelSpec.URL, 3, "Balanced: good summaries, runs on most recent phones with 8 GB of memory.", 1.4)
    val ALL: List<ModelOption> = listOf(
        ModelOption("qwen3-0.6b", "Qwen3 0.6B", "Qwen3-0.6B.litertlm", 614_236_160L, "555579ff2f4fd13379abe69c1c3ab5200f7338bc92471557f1d6614a6e5ab0b4",
            "https://huggingface.co/litert-community/Qwen3-0.6B/resolve/a3c5d805ae362dff7f580bc25f2dfb9a5a7eaa76/Qwen3-0.6B.litertlm", 1, "Tiny and fast, for phones with little memory. Shorter, simpler summaries.", 0.45),
        DEFAULT,
        ModelOption("phi-4-mini", "Phi-4 mini", "Phi-4-mini-instruct_multi-prefill-seq_q8_ekv4096.litertlm", 3_910_090_752L, "7764d4deb53800578307be33039476b38a6c370fff71bedb3c0552563e23ab02",
            "https://huggingface.co/litert-community/Phi-4-mini-instruct/resolve/8cd368be75fdb94d5a6f6f5b40f1ab22a6c2543e/Phi-4-mini-instruct_multi-prefill-seq_q8_ekv4096.litertlm", 3, "Strong at reasoning, mostly English. Large and slower."),
        ModelOption("gemma-4-e4b", "Gemma 4 E4B", "gemma-4-E4B-it.litertlm", 3_659_530_240L, "0b2a8980ce155fd97673d8e820b4d29d9c7d99b8fa6806f425d969b145bd52e0",
            "https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/2eee7ac325f20eb8c9ac1d0e972f7c84663062da/gemma-4-E4B-it.litertlm", 4, "The best summaries and the most languages. Needs a phone with 12 GB of memory.", 2.2),
    )
    fun byId(id: String): ModelOption = ALL.firstOrNull { it.id == id } ?: DEFAULT
    fun selected(context: Context): ModelOption = byId(Store(context).modelId)
}

/** Where the model file lives (app-private, so removing the app removes it) and how far the download is. */
class ModelStore(val dir: File, private val size: Long = ModelSpec.SIZE, name: String = ModelSpec.FILE) {
    val file = File(dir, name)
    val part = File(dir, "$name.part")
    fun installed(): Boolean = file.isFile && file.length() == size
    fun downloaded(): Long = if (installed()) size else part.length()
    fun delete() { file.delete(); part.delete() }
    val total: Long get() = size

    companion object {
        /** The store of the chosen model (or of [option]); each model has its own file, so several can be on the phone. */
        fun of(context: Context, option: ModelOption = Models.selected(context)) = ModelStore(File(context.applicationContext.filesDir, "model"), option.size, option.file)
    }
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
        val option = Models.selected(applicationContext)
        when (ModelDownloader.download(ModelStore.of(applicationContext, option), option.url, option.sha256, cancelled = { isStopped })) {
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
