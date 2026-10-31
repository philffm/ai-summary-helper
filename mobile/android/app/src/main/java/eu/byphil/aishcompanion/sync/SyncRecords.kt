package eu.byphil.aishcompanion.sync

import org.json.JSONObject
import java.io.File
import java.security.SecureRandom

/** The hybrid logical clock of this device and its id: stamps are never below anything this device has made or seen. */
class SyncClock(var t: Long = 0, val device: String = newDeviceId()) {
    fun tick(now: Long): Long { t = maxOf(now, t + 1); return t }
    fun observe(seen: Long) { if (seen > t) t = seen }
    companion object { fun newDeviceId() = "d_" + ByteArray(8).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) } }
}

/**
 * The records of the places this phone syncs: { rev: { t, d }, f: { field: { t, h } }, values: { field: value }, deleted?: true }, keyed by
 * "article:<id>", "hl:<id>", "coll:<id>", "note:<id>". For notes this IS the phone's note data; for everything else it is what the browser sent,
 * kept as the sync format so the merge works, and turned into reading-list articles by the materializer.
 */
interface RecordStore {
    fun keys(prefix: String = ""): List<String>
    fun get(key: String): JSONObject?
    fun put(key: String, rec: JSONObject)
    fun remove(key: String)
    fun ledger(placeId: String): JSONObject
    fun saveLedger(placeId: String, ledger: JSONObject)
}

class MemoryRecordStore : RecordStore {
    private val recs = LinkedHashMap<String, String>(); private val ledgers = HashMap<String, String>()
    override fun keys(prefix: String) = recs.keys.filter { it.startsWith(prefix) }
    override fun get(key: String) = recs[key]?.let { JSONObject(it) }
    override fun put(key: String, rec: JSONObject) { recs[key] = rec.toString() }
    override fun remove(key: String) { recs.remove(key) }
    override fun ledger(placeId: String) = ledgers[placeId]?.let { JSONObject(it) } ?: JSONObject()
    override fun saveLedger(placeId: String, ledger: JSONObject) { ledgers[placeId] = ledger.toString() }
}

/** One small file per record in app-private storage. Keys become file names, so only plain characters are accepted. */
class FileRecordStore(private val dir: File) : RecordStore {
    private val recs = File(dir, "records").apply { mkdirs() }
    private fun file(key: String): File { require(KEY.matches(key)) { "bad key" }; return File(recs, key.replace(':', '~') + ".json") }
    override fun keys(prefix: String) = (recs.listFiles { f -> f.extension == "json" } ?: emptyArray()).map { it.nameWithoutExtension.replace('~', ':') }.filter { it.startsWith(prefix) }.sorted()
    override fun get(key: String) = file(key).takeIf { it.exists() }?.let { runCatching { JSONObject(it.readText()) }.getOrNull() }
    override fun put(key: String, rec: JSONObject) { val f = file(key); val tmp = File(f.path + ".tmp"); tmp.writeText(rec.toString()); tmp.renameTo(f) }
    override fun remove(key: String) { file(key).delete() }
    override fun ledger(placeId: String) = File(dir, "ledger-$placeId.json").takeIf { it.exists() }?.let { runCatching { JSONObject(it.readText()) }.getOrNull() } ?: JSONObject()
    override fun saveLedger(placeId: String, ledger: JSONObject) { File(dir, "ledger-$placeId.json").writeText(ledger.toString()) }
    companion object { val KEY = Regex("^(article|hl|coll|note):[A-Za-z0-9_.:-]{1,200}$") }
}
