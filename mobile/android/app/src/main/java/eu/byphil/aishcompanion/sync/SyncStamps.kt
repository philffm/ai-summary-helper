package eu.byphil.aishcompanion.sync

import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal

/**
 * Revision stamps, the Kotlin side of the extension's modules/syncStamps.js. The hash of a value must be byte for byte the one the
 * extension computes (sync-vector.json holds the proof), because the merge compares hashes to decide whether a field changed.
 */
object SyncStamps {
    /** A value that is not there (JavaScript's undefined): hashed as "u", and a key holding it is left out of an object. */
    object Undefined

    /** The canonical text of a value: JSON with object keys sorted, undefined values left out. Same rules as JSON.stringify in the extension. */
    fun canonical(v: Any?): String = when (v) {
        Undefined -> "u"
        null, JSONObject.NULL -> "null"
        is String -> quote(v)
        is Boolean -> v.toString()
        is Number -> number(v)
        is JSONArray -> (0 until v.length()).joinToString(",", "[", "]") { canonical(v.opt(it).let { x -> if (x == null) JSONObject.NULL else x }) }
        is List<*> -> v.joinToString(",", "[", "]") { canonical(it) }
        is JSONObject -> v.keys().asSequence().toList().sorted().filter { v.opt(it) != Undefined }.joinToString(",", "{", "}") { quote(it) + ":" + canonical(v.opt(it)) }
        is Map<*, *> -> v.keys.map { it as String }.sorted().filter { v[it] != Undefined }.joinToString(",", "{", "}") { quote(it) + ":" + canonical(v[it]) }
        else -> quote(v.toString())
    }

    /** JSON.stringify for a string: only quote, backslash and control characters are escaped; a lone surrogate becomes \udxxx. */
    private fun quote(s: String): String {
        val b = StringBuilder("\"")
        var i = 0
        while (i < s.length) {
            val c = s[i]
            when {
                c == '"' -> b.append("\\\"")
                c == '\\' -> b.append("\\\\")
                c == '\b' -> b.append("\\b")
                c == '\u000C' -> b.append("\\f")
                c == '\n' -> b.append("\\n")
                c == '\r' -> b.append("\\r")
                c == '\t' -> b.append("\\t")
                c < ' ' -> b.append("\\u").append(String.format("%04x", c.code))
                Character.isHighSurrogate(c) && i + 1 < s.length && Character.isLowSurrogate(s[i + 1]) -> { b.append(c).append(s[i + 1]); i++ }
                Character.isSurrogate(c) -> b.append("\\u").append(String.format("%04x", c.code))
                else -> b.append(c)
            }
            i++
        }
        return b.append('"').toString()
    }

    /** JavaScript's Number to string for the numbers that occur in records (whole numbers, ordinary decimals, very large or small ones). */
    private fun number(n: Number): String {
        if (n is Int || n is Long || n is Short || n is Byte) return n.toLong().toString()
        val d = n.toDouble()
        if (d.isNaN() || d.isInfinite()) return "null"
        if (d == 0.0) return "0"
        val abs = Math.abs(d)
        if (d == Math.rint(d) && abs < 1e21) return BigDecimal(d).toBigInteger().toString()
        val plain = BigDecimal(d.toString()).stripTrailingZeros()
        if (abs >= 1e-6 && abs < 1e21) return plain.toPlainString()
        val digits = plain.unscaledValue().abs().toString(); val exp = digits.length - 1 - plain.scale()
        val mant = if (digits.length > 1) digits[0] + "." + digits.substring(1) else digits
        return (if (d < 0) "-" else "") + mant + "e" + (if (exp >= 0) "+" else "-") + Math.abs(exp)
    }

    /** 53-bit string hash (cyrb53) of the canonical text of a value, in base 36. Change detection, not security. */
    fun hashValue(v: Any?): String {
        val s = canonical(v)
        var h1 = 0xdeadbeef.toInt(); var h2 = 0x41c6ce57
        for (ch in s) {
            val c = ch.code
            h1 = (h1 xor c) * 2654435761L.toInt()
            h2 = (h2 xor c) * 1597334677
        }
        h1 = ((h1 xor (h1 ushr 16)) * 2246822507L.toInt()) xor ((h2 xor (h2 ushr 13)) * 3266489909L.toInt())
        h2 = ((h2 xor (h2 ushr 16)) * 2246822507L.toInt()) xor ((h1 xor (h1 ushr 13)) * 3266489909L.toInt())
        return (4294967296L * (h2.toLong() and 2097151L) + (h1.toLong() and 0xFFFFFFFFL)).toString(36)
    }

    /** Order two record stamps { t, d }: negative when a is older. */
    fun compareRev(a: JSONObject?, b: JSONObject?): Int {
        val ta = a?.optLong("t", 0) ?: 0; val tb = b?.optLong("t", 0) ?: 0
        if (ta != tb) return if (ta < tb) -1 else 1
        return (a?.optString("d", "") ?: "").compareTo(b?.optString("d", "") ?: "").coerceIn(-1, 1)
    }
}
