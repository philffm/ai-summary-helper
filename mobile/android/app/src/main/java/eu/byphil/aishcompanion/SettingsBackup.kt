package eu.byphil.aishcompanion

import org.json.JSONObject

/**
 * Settings that move to a new phone. Only preferences listed here: never the pairing (it holds the message key and the
 * tokens), the licence, the account, cached recaps or counters. Pure, unit-tested.
 */
object SettingsBackup {
    const val FORMAT = "aish-settings-v1"
    private val EXACT = setOf("feeds.group", "model.id", "ui.left", "ui.contrast", "ui.motion", "reader.scale", "reader.font", "reader.theme", "reader.spacing", "reader.wpm", "summary.lang", "summary.speak", "summary.ghost", "tts.rate")
    private val PREFIX = listOf("alarm.")
    private val NOT = setOf("alarm.sound")   // a sound URI means nothing on another phone

    fun allowed(key: String): Boolean = key !in NOT && (key in EXACT || PREFIX.any { key.startsWith(it) })

    /** Preferences → backup JSON text. */
    fun export(all: Map<String, *>, now: Long = System.currentTimeMillis()): String {
        val values = JSONObject()
        for ((k, v) in all.toSortedMap()) if (allowed(k) && (v is Boolean || v is Int || v is Long || v is Float || v is String)) values.put(k, v)
        return JSONObject().put("format", FORMAT).put("exportedAt", now).put("values", values).toString(2)
    }

    /** Backup JSON text → the values to write. Anything unknown or of an odd type is skipped; throws when it is not a backup at all. */
    fun parse(text: String): Map<String, Any> {
        val o = JSONObject(text)
        require(o.optString("format") == FORMAT) { "This is not an AISH settings file." }
        val v = o.getJSONObject("values")
        val out = LinkedHashMap<String, Any>()
        for (k in v.keys()) {
            if (!allowed(k)) continue
            when (val x = v.get(k)) {
                is Boolean, is String -> out[k] = x
                is Int -> out[k] = x
                is Long -> out[k] = x
                is Double -> out[k] = x.toFloat()
                is Float -> out[k] = x
                is Number -> out[k] = x.toFloat()
                else -> {}
            }
        }
        return out
    }
}
