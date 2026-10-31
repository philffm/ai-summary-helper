package eu.byphil.aishcompanion.sync

import org.json.JSONObject
import java.security.SecureRandom
import java.util.Base64

/** Small key/value storage (SharedPreferences on the phone, a map in tests). */
interface KeyValue { fun get(key: String): String?; fun put(key: String, value: String?) }

/**
 * The phone's one library place: joins the encrypted place the browser made (WebDAV/Nextcloud or S3), keeps its key on this device and syncs
 * the records into [records]. The phone never creates a library: that is done in the browser, where the articles are. Own notes are the only
 * thing it writes back (see SyncEngine).
 *
 * What is kept here: the server settings and its login, the key derived from the passphrase (so syncing can run in the background), and, only
 * when the passphrase is the suggested kind (random words), the words, so they can be shown again. An own passphrase is never kept.
 */
class LibrarySync(
    private val kv: KeyValue, val records: RecordStore,
    private val storeFactory: (Config) -> SyncStore = { defaultStore(it) },
    private val now: () -> Long = { System.currentTimeMillis() },
) {
    /** Where the library lives. kind: "webdav" (Nextcloud, ownCloud, most NAS) or "s3". */
    data class Config(
        val kind: String, val url: String = "", val username: String = "", val password: String = "", val root: String = "aish-sync",
        val region: String = "us-east-1", val bucket: String = "", val accessKeyId: String = "", val secretKey: String = "",
    ) {
        fun toJson(): String = JSONObject().put("kind", kind).put("url", url).put("username", username).put("password", password).put("root", root)
            .put("region", region).put("bucket", bucket).put("accessKeyId", accessKeyId).put("secretKey", secretKey).toString()
        /** What the screen may show: never the login. */
        fun label(): String = if (kind == "s3") "S3 · $bucket" else runCatching { java.net.URI(url).host }.getOrNull().orEmpty().ifEmpty { url }
        companion object {
            fun parse(json: String) = JSONObject(json).let {
                Config(it.optString("kind", "webdav"), it.optString("url"), it.optString("username"), it.optString("password"), it.optString("root", "aish-sync"),
                    it.optString("region", "us-east-1"), it.optString("bucket"), it.optString("accessKeyId"), it.optString("secretKey"))
            }
        }
    }

    class Summary(val pulled: Int, val pushed: Int, val applied: Int, val needsConfirm: Int, val more: Boolean, val errors: List<String>)

    companion object {
        private const val CFG = "cfg"; private const val MASTER = "master"; private const val WORDS = "words"; private const val LAST = "last"
        private const val ERR = "err"; private const val PLACE = "place"; private const val CLOCK = "clock"; private const val DEVICE = "device"
        fun defaultStore(c: Config): SyncStore = if (c.kind == "s3") S3Store(c.url, c.region, c.bucket, c.accessKeyId, c.secretKey, c.root, SyncHttp())
        else WebdavStore(c.url, c.root, c.username, c.password, SyncHttp())
    }

    fun config(): Config? = kv.get(CFG)?.let { runCatching { Config.parse(it) }.getOrNull() }
    fun isConnected() = config() != null && kv.get(MASTER) != null
    fun lastSyncAt(): Long = kv.get(LAST)?.toLongOrNull() ?: 0
    fun lastError(): String? = kv.get(ERR)
    /** The suggested words this phone kept, or null (an own passphrase is never kept). */
    fun passphrase(): String? = kv.get(WORDS)

    private fun readMeta(store: SyncStore): JSONObject? = store.get("meta.json")?.let { runCatching { JSONObject(String(it.bytes, Charsets.UTF_8)) }.getOrNull() }

    /** Joins the library in that place with its passphrase. Throws StoreError (address, login) or SyncCrypto.WrongKey. */
    fun connect(config: Config, passphrase: String) {
        val store = storeFactory(config)
        store.ping()
        val meta = readMeta(store) ?: throw IllegalStateException("There is no AISH library in that folder yet. Set up sync in the browser first, then join it here.")
        val opened = SyncCrypto.openMeta(meta, SyncPassphrase.canonical(passphrase))
        kv.put(CFG, config.toJson()); kv.put(MASTER, Base64.getEncoder().encodeToString(opened.master))
        kv.put(WORDS, if (SyncPassphrase.isSuggestedWords(passphrase)) SyncPassphrase.canonical(passphrase) else null)
        kv.put(PLACE, "p_" + ByteArray(6).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) })
        kv.put(LAST, null); kv.put(ERR, null); kv.put(CLOCK, null)
    }

    /** One run with the key kept on this device. [confirmDeletes]: apply a flood of deletions the engine held back. */
    fun syncNow(confirmDeletes: Boolean = false): Summary {
        val config = config() ?: throw IllegalStateException("No library is connected.")
        val master = kv.get(MASTER)?.let { Base64.getDecoder().decode(it) } ?: throw IllegalStateException("The key for this library is not on this device. Remove it and join again.")
        val placeId = kv.get(PLACE) ?: "p_phone"
        val clock = SyncClock(kv.get(CLOCK)?.toLongOrNull() ?: 0, kv.get(DEVICE) ?: SyncClock.newDeviceId().also { kv.put(DEVICE, it) })
        try {
            val store = storeFactory(config)
            val meta = readMeta(store) ?: throw IllegalStateException("The library has no meta.json on the server any more. It was removed or set up again.")
            val keys = SyncCrypto.openWithMaster(meta, master)
            val r = SyncEngine(store, keys, meta, records, clock, placeId, now = now).run(confirmDeletes = confirmDeletes)
            kv.put(CLOCK, clock.t.toString())
            if (r.errors.isEmpty() && !r.more) { kv.put(LAST, now().toString()); kv.put(ERR, null) } else kv.put(ERR, r.errors.firstOrNull() ?: "Not finished yet, it continues next time.")
            return Summary(r.pulled, r.pushed, r.applied, r.needsConfirm, r.more, r.errors.toList())
        } catch (e: Exception) { kv.put(ERR, e.message ?: e.javaClass.simpleName); throw e }
    }

    /** Forgets the connection, the key and the words. Records already received stay (they are the phone's copy of the library). */
    fun disconnect() { for (k in listOf(CFG, MASTER, WORDS, LAST, ERR, PLACE, CLOCK)) kv.put(k, null) }
}
