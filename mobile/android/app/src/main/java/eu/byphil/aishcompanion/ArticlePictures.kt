package eu.byphil.aishcompanion

/**
 * The pictures the browser saves inside an article's text (data: addresses). Only these kinds, only what really is one of them, and
 * within limits: it all comes from a web page. Nothing is ever loaded from an address. Pure, unit-tested.
 */
class ArticlePictures {
    /** Picture name to its bytes, in the order of the text. */
    val found = LinkedHashMap<String, ByteArray>()
    private var total = 0

    /** Takes the picture of a src attribute. Returns its name, or null where it is no picture the app keeps. */
    fun take(src: String): String? {
        if (found.size >= MOST || !src.startsWith("data:image/", ignoreCase = true)) return null
        val head = KIND.find(src.take(40))?.value ?: return null
        if (src.length - head.length > MAX_BYTES / 3 * 4 + 8) return null
        val data = runCatching { java.util.Base64.getMimeDecoder().decode(src.substring(head.length)) }.getOrNull() ?: return null
        if (data.size > MAX_BYTES || total + data.size > MAX_TOTAL || !isPicture(data)) return null
        val name = found.size.toString()
        found[name] = data
        total += data.size
        return name
    }

    companion object {
        const val MOST = 60
        const val MAX_BYTES = 6_000_000
        const val MAX_TOTAL = 24_000_000
        val NAME = Regex("\\d{1,3}")
        private val KIND = Regex("^data:image/(?:jpe?g|png|gif|webp);base64,", RegexOption.IGNORE_CASE)

        fun isPicture(d: ByteArray): Boolean {
            fun at(i: Int, vararg b: Int) = d.size >= i + b.size && b.indices.all { d[i + it] == b[it].toByte() }
            return at(0, 0xFF, 0xD8, 0xFF) || at(0, 0x89, 0x50, 0x4E, 0x47) || at(0, 0x47, 0x49, 0x46, 0x38) ||
                (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50))
        }
    }
}
