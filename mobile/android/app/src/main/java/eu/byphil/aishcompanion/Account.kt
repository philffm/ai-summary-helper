package eu.byphil.aishcompanion

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale

/** What the server says about a license key: whether it has a monthly AI allowance, and how much of it is used. */
/** One model's share of this month's cloud use. */
data class ModelUse(val model: String, val requests: Int, val costUsd: Double, val tokensIn: Long, val tokensOut: Long)

data class AccountInfo(
    val active: Boolean, val usedUsd: Double = 0.0, val limitUsd: Double = 0.0, val percent: Int = 0,
    val requests: Int = 0, val tokensIn: Long = 0, val tokensOut: Long = 0, val models: List<ModelUse> = emptyList(), val resetAt: String = "", val lastModel: String = "",
)

object Account {
    const val USAGE_URL = "https://api.byphil.eu/v1/projects/ai_summary_helper/usage"

    /** A recognised paid license comes with a quota block; without one the key is unknown, revoked or on the free plan. Null: not JSON. */
    fun parse(json: String): AccountInfo? = runCatching {
        val root = JSONObject(json)
        val q = root.optJSONObject("quota") ?: return@runCatching AccountInfo(false)
        val arr = q.optJSONArray("by_model")
        val models = if (arr == null) emptyList() else (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }.map {
            ModelUse(it.optString("model"), it.optInt("requests"), it.optDouble("cost_usd", 0.0), it.optLong("tokens_in"), it.optLong("tokens_out"))
        }
        AccountInfo(
            true, q.optDouble("used_usd", 0.0), q.optDouble("limit_usd", 0.0), q.optInt("percent", 0),
            q.optInt("requests"), q.optLong("tokens_in"), q.optLong("tokens_out"), models, q.optString("reset_at"),
            root.optJSONObject("account")?.optString("last_model").orEmpty().let { if (it == "null") "" else it },
        )
    }.getOrNull()

    /** 950 → "950", 12_300 → "12.3k", 2_400_000 → "2.4M". */
    fun tokens(n: Long): String = when {
        n >= 1_000_000 -> String.format(Locale.US, "%.1fM", n / 1e6)
        n >= 1_000 -> String.format(Locale.US, "%.1fk", n / 1e3)
        else -> n.toString()
    }

    fun usd(v: Double): String = if (v in 0.0..0.005 && v > 0) "<$0.01" else String.format(Locale.US, "$%.2f", v)

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
