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
import androidx.work.workDataOf
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

const val INBOX_API = "https://api.byphil.eu/v1/projects/ai_summary_helper/inboxes"

/** Encrypts one link and appends it to the inbox. Retries while offline or the server is busy; gives up (and says why) on a pairing problem. */
class SendWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val link = inputData.getString("url") ?: return Result.failure()
        val sentAt = inputData.getLong("sentAt", System.currentTimeMillis())
        val store = Store(applicationContext)
        val pairing = store.pairing ?: return Result.failure()
        val body = "{\"v\":1,\"data\":\"${InboxCrypto.encrypt(pairing, InboxCrypto.messageJson(link, sentAt))}\"}"
        return try {
            val conn = URL("$INBOX_API/${pairing.inboxId}/items").openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.connectTimeout = 15_000
            conn.readTimeout = 15_000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Authorization", "Bearer ${pairing.writeToken}")
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            conn.disconnect()
            when {
                code == 202 -> { store.lastError = null; Result.success() }
                code == 429 || code >= 500 -> Result.retry()
                code == 401 || code == 403 || code == 404 -> { store.lastError = "The pairing is no longer valid. Pair again in AISH."; Result.failure() }
                else -> { store.lastError = "The server refused the link (HTTP $code)."; Result.failure() }
            }
        } catch (_: IOException) {
            Result.retry()
        }
    }

    companion object {
        fun enqueue(context: Context, link: String) {
            val request = OneTimeWorkRequestBuilder<SendWorker>()
                .setInputData(workDataOf("url" to link, "sentAt" to System.currentTimeMillis()))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            // sharing the same link twice in a row queues it once
            WorkManager.getInstance(context).enqueueUniqueWork("send-" + link.hashCode(), ExistingWorkPolicy.KEEP, request)
        }
    }
}
