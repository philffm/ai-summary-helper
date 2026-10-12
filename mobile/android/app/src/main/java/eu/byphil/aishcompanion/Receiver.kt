package eu.byphil.aishcompanion

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

/** Result of one collection run. [error] is null on success, else: unreachable, rate-limited, pairing-invalid, error. */
data class ReceiveOutcome(val added: Int, val error: String?)

/**
 * Collects the articles the extension sent: reads the extension→phone inbox with the read token, decrypts, saves each article
 * on the phone, and only then deletes it from the server (so a crash can repeat an item, never lose one).
 */
object Receiver {
    private const val PAGE = 20
    private const val MAX_PAGES = 5

    suspend fun run(context: Context): ReceiveOutcome = withContext(Dispatchers.IO) {
        val store = Store(context)
        val pairing = store.pairing
        val inbox = pairing?.toPhoneInboxId
        val token = pairing?.toPhoneReadToken
        if (pairing == null || inbox == null || token == null) return@withContext ReceiveOutcome(0, "pairing-invalid")
        val articles = ArticleStore(context)
        var added = 0
        try {
            for (page in 0 until MAX_PAGES) {
                val (code, body) = http("GET", "$INBOX_API/$inbox/items?limit=$PAGE", token)
                if (code != 200) return@withContext ReceiveOutcome(added, classify(code))
                val json = JSONObject(body)
                val items = json.getJSONArray("items")
                for (i in 0 until items.length()) {
                    val item = items.getJSONObject(i)
                    val id = item.optString("id")
                    if (!ArticleStore.ID.matches(id)) continue
                    if (!articles.has(id) && item.optInt("v") == 2) {
                        try {
                            val (article, plain) = ArticleCodec.decrypt(inbox, pairing.encKey, item.getString("data"), id)
                            articles.save(article, plain, System.currentTimeMillis())
                            added++
                        } catch (_: Exception) {
                            // unreadable or not for us: nothing to keep; it is removed from the server below
                        }
                    }
                    http("DELETE", "$INBOX_API/$inbox/items/$id", token)   // saved (or unusable): the server copy is not needed any more
                }
                if (!json.optBoolean("hasMore")) break
            }
            store.lastError = null
            ReceiveOutcome(added, null)
        } catch (_: IOException) {
            ReceiveOutcome(added, "unreachable")
        }
    }

    private fun classify(code: Int): String = when {
        code == 429 -> "rate-limited"
        code == 401 || code == 403 || code == 404 -> "pairing-invalid"
        code >= 500 || code == 0 -> "unreachable"
        else -> "error"
    }

    private fun http(method: String, url: String, token: String): Pair<Int, String> {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            conn.setRequestProperty("Authorization", "Bearer $token")
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            return code to (stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: "")
        } finally {
            conn.disconnect()
        }
    }
}

/** Background collection every 15 minutes (the minimum WorkManager allows) while online. Only scheduled when the code carried the second inbox. */
class ReceiveWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val out = Receiver.run(applicationContext)
        return when (out.error) {
            null -> Result.success()
            "unreachable", "rate-limited" -> Result.retry()
            "pairing-invalid" -> { Store(applicationContext).lastError = "Articles from your browser can no longer be received. Pair again in AISH."; Result.failure() }
            else -> Result.failure()
        }
    }

    companion object {
        private const val NAME = "receive-articles"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<ReceiveWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        fun cancel(context: Context) { WorkManager.getInstance(context).cancelUniqueWork(NAME) }
    }
}
