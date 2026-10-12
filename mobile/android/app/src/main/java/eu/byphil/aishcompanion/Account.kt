package eu.byphil.aishcompanion

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale

/** What the server says about a license key: whether it has a monthly AI allowance, and how much of it is used. */
data class AccountInfo(val active: Boolean, val usedUsd: Double = 0.0, val limitUsd: Double = 0.0, val percent: Int = 0)

object Account {
    const val USAGE_URL = "https://api.byphil.eu/v1/projects/ai_summary_helper/usage"

    /** A recognised paid license comes with a quota block; without one the key is unknown, revoked or on the free plan. Null: not JSON. */
    fun parse(json: String): AccountInfo? = runCatching {
        val q = JSONObject(json).optJSONObject("quota") ?: return@runCatching AccountInfo(false)
        AccountInfo(true, q.optDouble("used_usd", 0.0), q.optDouble("limit_usd", 0.0), q.optInt("percent", 0))
    }.getOrNull()

    fun describe(info: AccountInfo?): String = when {
        info == null -> "Could not check the license right now."
        info.active -> "Pro active · " + String.format(Locale.US, "%.2f of %.2f", info.usedUsd, info.limitUsd) + " used this month (${info.percent}%)"
        else -> "This key is not recognised, or has no AI allowance."
    }

    /** Blocking; null when the server cannot be reached. */
    fun check(license: String): AccountInfo? {
        if (license.isBlank()) return null
        return try {
            val c = URL(USAGE_URL).openConnection() as HttpURLConnection
            c.connectTimeout = 15_000; c.readTimeout = 20_000
            c.setRequestProperty("Authorization", "Bearer ${license.trim()}")
            if (c.responseCode != 200) { c.disconnect(); return null }
            val text = c.inputStream.use { it.readBytes().take(100_000).toByteArray().toString(Charsets.UTF_8) }
            c.disconnect()
            parse(text)
        } catch (e: Exception) { null }
    }
}
