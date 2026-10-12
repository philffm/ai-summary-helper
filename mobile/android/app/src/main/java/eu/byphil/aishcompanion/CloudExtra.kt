package eu.byphil.aishcompanion

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import java.util.Locale

/**
 * One optional extra for the briefing from the cloud AI behind the AISH backend (the same chat endpoint the extension uses, billed
 * to your Pro allowance): a fun fact of the day, or whatever [prompt] asks for. Only the prompt text, today's date and the phone's
 * language are sent. Your feeds, titles and reading list never leave the phone. The model is the server's default (a server setting).
 */
object CloudExtra {
    const val URL_CHAT = "https://api.byphil.eu/v1/projects/ai_summary_helper/chat"
    const val DEFAULT_PROMPT = "Tell me one surprising, true fun fact."
    const val MAX_PROMPT = 300
    const val MAX_REPLY = 700

    fun system(date: LocalDate, language: String): String =
        "You write one short item for a spoken morning briefing. Today is $date. Answer in $language. " +
            "At most 60 words, plain sentences, no markdown, no lists, no emojis. Start directly with the content. " +
            "Be accurate: if you are not sure of a fact, choose another one. You cannot look anything up, so do not claim live data."

    fun body(prompt: String, date: LocalDate, language: String): String = JSONObject()
        .put("messages", JSONArray()
            .put(JSONObject().put("role", "system").put("content", system(date, language)))
            .put(JSONObject().put("role", "user").put("content", prompt.ifBlank { DEFAULT_PROMPT }.take(MAX_PROMPT))))
        .toString()

    /** The reply text from an OpenAI-style response, cleaned for speaking; null when missing or unusable. */
    fun parse(json: String): String? = runCatching {
        val text = JSONObject(json).getJSONArray("choices").getJSONObject(0).getJSONObject("message").getString("content")
        BriefingPrompt.cleanReply(text)?.take(MAX_REPLY)
    }.getOrNull()

    /** Blocking; null on any problem (no key, offline, quota used up, server error), so the briefing simply goes without it. */
    fun fetch(license: String, prompt: String, today: LocalDate = LocalDate.now(), language: String = Locale.getDefault().getDisplayLanguage(Locale.ENGLISH)): String? {
        if (license.isBlank()) return null
        return try {
            val c = URL(URL_CHAT).openConnection() as HttpURLConnection
            c.requestMethod = "POST"; c.connectTimeout = 15_000; c.readTimeout = 45_000; c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json"); c.setRequestProperty("Authorization", "Bearer ${license.trim()}")
            c.outputStream.use { it.write(body(prompt, today, language).toByteArray()) }
            if (c.responseCode != 200) { c.disconnect(); return null }
            val text = c.inputStream.use { it.readBytes().take(200_000).toByteArray().toString(Charsets.UTF_8) }
            c.disconnect()
            parse(text)
        } catch (e: Exception) { null }
    }
}
