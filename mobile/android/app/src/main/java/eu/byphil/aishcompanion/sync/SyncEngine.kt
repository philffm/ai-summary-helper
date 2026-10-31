package eu.byphil.aishcompanion.sync

import eu.byphil.aishcompanion.sync.SyncStamps.compareRev
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.Future

/**
 * Two-way sync of one encrypted place: the phone side of the extension's syncEngine.js, same files, same rules.
 *
 *   meta.json (plain) and r/<hmac name>, one encrypted file per record: { aish: "rec/1", key, rev, f, values?, deleted? }
 *
 * A run pulls every file whose etag differs from the ledger, merges it with the record held here and keeps the merge; then it pushes the records
 * this phone owns (its notes) that are newer than what the ledger says the server has. Everything else (articles, highlights, collections) comes
 * from the browser and is only received: this phone never writes it back.
 *
 * Safety (same as the extension): a file that cannot be read is skipped and reported, never overwritten; a missing file is never a deletion; a
 * file whose name does not belong to its record is rejected; a flood of deletions from other devices waits for a yes.
 */
class SyncEngine(
    private val store: SyncStore, private val keys: SyncCrypto.Keys, private val meta: JSONObject, private val records: RecordStore,
    private val clock: SyncClock, private val placeId: String, private val now: () -> Long = { System.currentTimeMillis() },
    private val owned: Set<String> = setOf("note"),
) {
    class Result { var pulled = 0; var pushed = 0; var applied = 0; var needsConfirm = 0; var more = false; var stale = false; val errors = ArrayList<String>(); val changed = LinkedHashSet<String>() }

    companion object {
        const val DIR = "r"; const val TTL_MS = 90L * 24 * 3600 * 1000; const val GUARD_MIN = 10; const val GUARD_SHARE = 0.25
        private val KEY = Regex("^(article|hl|coll|note):[A-Za-z0-9_.:-]{1,200}$")
        private val TYPES = setOf("article", "hl", "coll", "note")
    }
    private fun type(key: String) = key.substringBefore(':')
    private fun status(e: Exception) = (e as? StoreError)?.status ?: 0

    fun run(budgetMs: Long = 150_000, confirmDeletes: Boolean = false, ttlMs: Long = TTL_MS, chunk: Int = 25, threads: Int = 4): Result {
        val out = Result(); val started = now()
        val ledger = records.ledger(placeId)
        if (ledger.optString("salt").isNotEmpty() && ledger.optString("salt") != meta.optString("salt")) throw StoreError(0, "This place was set up again on the server (a different key). Nothing was changed. Remove the place here and add it again to join it.", StoreError.Kind.PERMANENT)
        val items = ledger.optJSONObject("items") ?: JSONObject()
        val dirty = HashSet<String>().apply { ledger.optJSONArray("dirty")?.let { a -> for (i in 0 until a.length()) add(a.getString(i)) } }
        val lastSync = ledger.optLong("lastSync", 0)
        val stale = lastSync > 0 && now() - lastSync > ttlMs; out.stale = stale
        val overBudget = { now() - started > budgetMs }
        val names = HashMap<String, String>()
        fun nameFor(key: String) = names.getOrPut(key) { SyncCrypto.nameOf(keys, type(key), key.substringAfter(':')) }
        fun save(last: Long = lastSync, blocked: Int = out.needsConfirm) = records.saveLedger(placeId, JSONObject().put("joined", 1).put("salt", meta.optString("salt")).put("items", items).put("dirty", JSONArray(dirty.toList())).put("lastSync", last).put("blocked", blocked))
        fun path(name: String) = "$DIR/$name"

        val remote = store.list(DIR).associateBy { it.path.removePrefix("$DIR/") }
        val known = HashMap<String, String>()   // name → key
        for (k in records.keys()) known[nameFor(k)] = k
        for (k in items.keys()) known[items.getJSONObject(k).optString("n")] = k

        class Got(val name: String, val etag: String, val rec: JSONObject)
        fun read(name: String): Got? {
            val f = store.get(path(name)) ?: return null
            val rec = try { JSONObject(SyncCrypto.decrypt(keys, f.bytes)) } catch (e: Exception) { throw IllegalStateException("${name.take(8)}…: ${e.message}") }
            val key = rec.optString("key")
            if (rec.optString("aish") != "rec/1" || !KEY.matches(key) || type(key) !in TYPES || !rec.has("rev") || rec.optJSONObject("f") == null) throw IllegalStateException("${name.take(8)}…: not a record")
            if (nameFor(key) != name) throw IllegalStateException("${name.take(8)}…: the file name does not belong to its record")
            return Got(name, f.etag, rec)
        }

        val live = records.keys().count { records.get(it)?.optBoolean("deleted", false) == false }
        val deleteBudget = if (ledger.optInt("blocked") > 0 && !confirmDeletes) 0 else maxOf(GUARD_MIN, Math.ceil(live * GUARD_SHARE).toInt())
        var deletesApplied = 0

        fun ingest(files: List<Got>) {
            for (g in files) {
                val key = g.rec.getString("key"); val local = records.get(key)
                val r = SyncMerge.mergeRecord(local, g.rec)
                clock.observe(g.rec.getJSONObject("rev").optLong("t"))
                if (r.merged.optBoolean("deleted", false) && local != null && !local.optBoolean("deleted", false) && r.changedLocal && !confirmDeletes) {
                    if (deletesApplied >= deleteBudget) { out.needsConfirm++; continue }
                    deletesApplied++
                }
                if (r.changedLocal) { records.put(key, r.merged); out.changed.add(key); out.applied++ }
                items.put(key, JSONObject().put("n", g.name).put("e", g.etag).put("t", g.rec.getJSONObject("rev").optLong("t")))
                if (r.changedRemote && type(key) in owned) dirty.add(key)
                known[g.name] = key
            }
        }

        // 1) pull
        val toPull = remote.entries.filter { (name, f) -> val k = known[name]; k == null || !items.has(k) || items.getJSONObject(k).optString("e") != f.etag }.map { it.key }
        val pool = Executors.newFixedThreadPool(threads)
        try {
            var i = 0
            while (i < toPull.size) {
                if (overBudget()) { out.more = true; break }
                val part = toPull.subList(i, minOf(i + chunk, toPull.size)); i += chunk
                val futures: List<Future<Pair<Got?, String?>>> = part.map { name -> pool.submit<Pair<Got?, String?>> { try { read(name) to null } catch (e: Exception) { null to (e.message ?: "unreadable") } } }
                val got = ArrayList<Got>()
                for (f in futures) { val (g, err) = f.get(); if (g != null) got.add(g); if (err != null) out.errors.add(err) }
                ingest(got); out.pulled += got.size; save()
            }
        } finally { pool.shutdown() }
        if (out.more) { save(); return out }

        // 2) push what this phone owns (after a long absence only what changed since)
        val pending = records.keys().filter { type(it) in owned }.filter { k ->
            val rec = records.get(k) ?: return@filter false
            val t = rec.optJSONObject("rev")?.optLong("t") ?: 0
            (k in dirty || !items.has(k) || items.getJSONObject(k).optLong("t") < t) && (!stale || t > lastSync)
        }
        fun push(key: String, retry: Boolean = true) {
            val rec = records.get(key) ?: return
            val name = nameFor(key)
            val file = JSONObject().put("aish", "rec/1").put("key", key).put("rev", rec.getJSONObject("rev")).put("f", rec.optJSONObject("f") ?: JSONObject())
            if (rec.optBoolean("deleted", false)) file.put("deleted", true) else file.put("values", rec.optJSONObject("values") ?: JSONObject())
            val have = items.optJSONObject(key)?.optString("e").orEmpty()
            try {
                val etag = store.put(path(name), SyncCrypto.encrypt(keys, file.toString()), ifMatch = have.ifEmpty { null }, ifNoneMatch = if (have.isEmpty()) "*" else null)
                items.put(key, JSONObject().put("n", name).put("e", etag).put("t", rec.getJSONObject("rev").optLong("t"))); dirty.remove(key); out.pushed++
            } catch (e: StoreError) {
                if (e.status != 412 || !retry) throw e
                val got = try { read(name) } catch (_: Exception) { throw IllegalStateException("the server copy cannot be read, not overwriting it") }   // changed (or gone) since we looked: merge with it, then once more
                if (got != null) { ingest(listOf(got)); out.pulled++ } else items.remove(key)
                push(key, false)
            }
        }
        for ((n, key) in pending.withIndex()) {
            if (overBudget()) { out.more = true; break }
            try { push(key) } catch (e: Exception) { out.errors.add("$key: ${e.message}") }
            if (n % chunk == chunk - 1) save()
        }
        save(if (out.errors.isEmpty() && !out.more) now() else lastSync)
        return out
    }
}
