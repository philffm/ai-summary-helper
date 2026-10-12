package eu.byphil.aishcompanion

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** What a successful sign-in hands back: the account's email and its Pro license key (empty on the free plan). */
data class Signed(val email: String, val license: String)

/**
 * The same email-code sign-in as the browser extension (api.byphil.eu): ask for a code, type the four digits from the email.
 * It only identifies the account, so its plan and cloud AI allowance work here. Feeds and articles never go through the account:
 * they stay end-to-end encrypted between the paired devices.
 */
object Login {
    private const val BASE = "https://api.byphil.eu/v1/auth"

    /** The id of the pending code, or an error text for the person. Blocking. */
    fun request(email: String): Pair<String?, String?> {
        val (code, body) = post("$BASE/request-otp", JSONObject().put("email", email.trim()).toString()) ?: return null to "Could not reach the server."
        val json = runCatching { JSONObject(body) }.getOrNull() ?: return null to "The server sent something unexpected."
        if (code !in 200..299) return null to json.optString("error").ifBlank { "Could not send a code." }
        val id = json.optString("otpId")
        return if (id.isBlank()) null to "The server sent no code id." else id to null
    }

    /** The signed-in account, or an error text. Blocking. */
    fun verify(otpId: String, code: String, email: String): Pair<Signed?, String?> {
        val (status, body) = post("$BASE/verify-otp", JSONObject().put("otpId", otpId).put("code", code.trim()).toString()) ?: return null to "Could not reach the server."
        val json = runCatching { JSONObject(body) }.getOrNull() ?: return null to "The server sent something unexpected."
        if (status !in 200..299) return null to json.optString("error").ifBlank { "That code is not right." }
        val rec = json.optJSONObject("record")
        return Signed(rec?.optString("email").orEmpty().ifBlank { email.trim() }, rec?.optString("license_key").orEmpty()) to null
    }

    private fun post(url: String, body: String): Pair<Int, String>? = try {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 15_000; c.readTimeout = 20_000
        c.requestMethod = "POST"; c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json")
        c.outputStream.use { it.write(body.toByteArray()) }
        val status = c.responseCode
        val stream = if (status in 200..299) c.inputStream else c.errorStream
        val text = stream?.use { it.readBytes().take(200_000).toByteArray().toString(Charsets.UTF_8) }.orEmpty()
        c.disconnect()
        status to text
    } catch (e: Exception) { null }
}
