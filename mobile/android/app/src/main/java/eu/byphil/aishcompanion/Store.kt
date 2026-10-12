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
}
