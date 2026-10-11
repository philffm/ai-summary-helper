package eu.byphil.aishcompanion

import android.content.Context

/** Pairing and the last delivery problem, in app-private storage. Holds the write token and message key only (never the read token). */
class Store(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("aish", Context.MODE_PRIVATE)

    var pairing: Pairing?
        get() = prefs.getString("pairing", null)?.let { Pairing.parse(it) }
        set(v) = prefs.edit().apply { if (v == null) remove("pairing") else putString("pairing", "aish-inbox://v1?i=${v.inboxId}&k=${v.encKey}&w=${v.writeToken}") }.apply()

    var lastError: String?
        get() = prefs.getString("lastError", null)
        set(v) = prefs.edit().apply { if (v == null) remove("lastError") else putString("lastError", v) }.apply()
}
