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
        )
        set(v) = prefs.edit().putBoolean("alarm.on", v.enabled).putInt("alarm.hour", v.hour).putInt("alarm.minute", v.minute)
            .putInt("alarm.days", v.days).putBoolean("alarm.read", v.readAloud).putInt("alarm.snooze", v.snoozeMinutes).putBoolean("alarm.ai", v.useAi).apply()

    /** The briefing prepared before the alarm, as JSON (see [Briefing]). */
    var briefingJson: String?
        get() = prefs.getString("briefing", null)
        set(v) = prefs.edit().apply { if (v == null) remove("briefing") else putString("briefing", v) }.apply()
}
