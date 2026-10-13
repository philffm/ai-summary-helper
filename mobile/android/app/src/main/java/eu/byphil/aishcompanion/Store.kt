package eu.byphil.aishcompanion

import android.content.Context

/** Pairing and the last delivery problem, in app-private storage. Holds the message key, the write token, and the read token of the extension→phone inbox (never the read token of the phone→extension inbox). */
class Store(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("aish", Context.MODE_PRIVATE)

    var pairing: Pairing?
        get() = prefs.getString("pairing", null)?.let { Pairing.parse(it) }
        set(v) = prefs.edit().apply { if (v == null) remove("pairing") else putString("pairing", v.toCode()) }.apply()

    var lastError: String?
        get() = prefs.getString("lastError", null)
        set(v) = prefs.edit().apply { if (v == null) remove("lastError") else putString("lastError", v) }.apply()

    /** The morning alarm settings. */
    var alarm: AlarmSettings
        get() = AlarmSettings(
            prefs.getBoolean("alarm.on", false), prefs.getInt("alarm.hour", 7), prefs.getInt("alarm.minute", 0),
            prefs.getInt("alarm.days", AlarmSettings.ALL_DAYS), prefs.getBoolean("alarm.read", true), prefs.getInt("alarm.snooze", 10), prefs.getBoolean("alarm.ai", false),
            NewsMode.of(prefs.getString("alarm.mode", null) ?: if (prefs.getBoolean("alarm.good", false)) "GOOD" else "ALL"), prefs.getBoolean("alarm.extra", false), prefs.getString("alarm.extraPrompt", "") ?: "",
            prefs.getString("alarm.sound", "") ?: "", prefs.getBoolean("alarm.fade", false),
        )
        set(v) = prefs.edit().putBoolean("alarm.on", v.enabled).putInt("alarm.hour", v.hour).putInt("alarm.minute", v.minute)
            .putInt("alarm.days", v.days).putBoolean("alarm.read", v.readAloud).putInt("alarm.snooze", v.snoozeMinutes).putBoolean("alarm.ai", v.useAi)
            .putString("alarm.mode", v.newsMode.name).putBoolean("alarm.extra", v.extraOn).putString("alarm.extraPrompt", v.extraPrompt.take(300)).putString("alarm.sound", v.sound).putBoolean("alarm.fade", v.fadeIn).apply()

    /** The Pro license key, used only for the cloud extra (sent to api.byphil.eu as a bearer token, nowhere else). */
    var license: String
        get() = prefs.getString("license", "") ?: ""
        set(v) = prefs.edit().putString("license", v.trim().take(200)).apply()

    /** The first-run card on the empty Feeds screen was finished or skipped. */
    var onboarded: Boolean
        get() = prefs.getBoolean("onboarded", false)
        set(v) = prefs.edit().putBoolean("onboarded", v).apply()

    /** The email of the signed-in account (the code sign-in), empty when signed out. */
    var accountEmail: String
        get() = prefs.getString("account.email", "") ?: ""
        set(v) = prefs.edit().putString("account.email", v.trim().take(200)).apply()

    /** Language of summaries and recaps made on the phone: a code from [SummaryLangs], "" = the language of the page. */
    var summaryLang: String
        get() = prefs.getString("summary.lang", "") ?: ""
        set(v) = prefs.edit().putString("summary.lang", v).apply()

    /** Stack items about the same story in the Feeds list. */
    /** The on-device model in use (an id from [Models]). */
    var modelId: String
        get() = prefs.getString("model.id", Models.DEFAULT.id) ?: Models.DEFAULT.id
        set(v) = prefs.edit().putString("model.id", v).apply()

    /** How often this month the on-device model ran, and how often this phone called the cloud AI (the briefing extra). Local runs are free and never reach the server. */
    private fun month() = java.time.LocalDate.now().toString().take(7)
    val localRuns: Int get() = prefs.getInt("use.local." + month(), 0)
    val cloudCalls: Int get() = prefs.getInt("use.cloud." + month(), 0)
    fun bumpLocal() { prefs.edit().putInt("use.local." + month(), localRuns + 1).apply() }
    fun bumpCloud() { prefs.edit().putInt("use.cloud." + month(), cloudCalls + 1).apply() }

    /** Which hand holds the phone: the main actions sit on that side. */
    var leftHanded: Boolean
        get() = prefs.getBoolean("ui.left", false)
        set(v) = prefs.edit().putBoolean("ui.left", v).apply()

    var groupSimilar: Boolean
        get() = prefs.getBoolean("feeds.group", true)
        set(v) = prefs.edit().putBoolean("feeds.group", v).apply()

    /** Text size factor in the article reader (A− / A+). */
    var readerScale: Float
        get() = prefs.getFloat("reader.scale", 1f)
        set(v) = prefs.edit().putFloat("reader.scale", v).apply()

    /** Read the summary aloud while the model writes it. */
    var speakSummary: Boolean
        get() = prefs.getBoolean("summary.speak", true)
        set(v) = prefs.edit().putBoolean("summary.speak", v).apply()

    /** Whether summaries made on the phone also get AI "ghost" highlights (key passages marked in the text, as for articles sent from the browser). */
    var ghostMarks: Boolean
        get() = prefs.getBoolean("summary.ghost", true)
        set(v) = prefs.edit().putBoolean("summary.ghost", v).apply()

    /** The day recap at the top of Feeds: text, when it was written, how many stories went in. */
    var recapText: String
        get() = prefs.getString("recap.text", "") ?: ""
        set(v) = prefs.edit().putString("recap.text", v).apply()
    var recapAt: Long
        get() = prefs.getLong("recap.at", 0)
        set(v) = prefs.edit().putLong("recap.at", v).apply()
    var recapCount: Int
        get() = prefs.getInt("recap.count", 0)
        set(v) = prefs.edit().putInt("recap.count", v).apply()

    /** The briefing prepared before the alarm, as JSON (see [Briefing]). */
    var briefingJson: String?
        get() = prefs.getString("briefing", null)
        set(v) = prefs.edit().apply { if (v == null) remove("briefing") else putString("briefing", v) }.apply()
}
