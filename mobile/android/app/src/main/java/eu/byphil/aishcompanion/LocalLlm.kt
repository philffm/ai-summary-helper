package eu.byphil.aishcompanion

import android.content.Context
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig

/**
 * The only place that talks to the LiteRT-LM runtime. The model is loaded for one request and released right after,
 * so the roughly 3 GB it needs are held only for the seconds it is working. Blocking: call off the main thread.
 */
object LocalLlm {
    fun installed(context: Context): Boolean = ModelStore.of(context).installed()

    /**
     * Loads the model once and lets [block] ask it several questions: `ask(system, prompt)` returns the reply, or null when that
     * question failed. Returns false when the model is missing or could not be loaded. The model is released afterwards.
     */
    fun session(context: Context, block: (ask: (String, String) -> String?) -> Unit): Boolean = synchronized(this) { sessionLocked(context) { ask, _ -> block(ask) } }   // one model in memory at a time

    /** Like [session], and `stream(system, prompt, onText)` also hands the reply over while it is being written ([onText] gets everything so far). Null when it failed. */
    fun sessionWithStream(context: Context, block: (ask: (String, String) -> String?, stream: (String, String, (String) -> Unit) -> String?) -> Unit): Boolean =
        synchronized(this) { sessionLocked(context, block) }

    private fun sessionLocked(context: Context, block: (ask: (String, String) -> String?, stream: (String, String, (String) -> Unit) -> String?) -> Unit): Boolean {
        val store = ModelStore.of(context)
        if (!store.installed()) return false
        var engine: Engine? = null
        Guard.begin(context, "model")   // a native crash cannot be caught; this mark tells the next start what happened
        return try {
            val cache = context.cacheDir.resolve("litert").apply { mkdirs() }
            engine = Engine(EngineConfig(modelPath = store.file.path, backend = Backend.CPU(), cacheDir = cache.path))
            engine.initialize()
            val eng: Engine = engine
            block({ system, prompt ->
                try {
                    val conversation = eng.createConversation(ConversationConfig(systemInstruction = Contents.of(system)))
                    try { clean(conversation.sendMessage(prompt).toString()) } finally { conversation.close() }
                } catch (_: Exception) { null }
            }, { system, prompt, onText ->
                try {
                    val conversation = eng.createConversation(ConversationConfig(systemInstruction = Contents.of(system)))
                    try {
                        val sb = StringBuilder()
                        kotlinx.coroutines.runBlocking {
                            conversation.sendMessageAsync(prompt).collect { chunk -> sb.append(chunk.toString()); onText(clean(sb.toString())) }
                        }
                        clean(sb.toString()).ifBlank { null }
                    } finally { conversation.close() }
                } catch (_: Exception) { null }
            })
            true
        } catch (e: Exception) {
            false
        } catch (e: UnsatisfiedLinkError) {
            false
        } finally {
            runCatching { engine?.close() }
            Guard.end(context, "model")
        }
    }

    /** Some models (Qwen3) think out loud between <think> tags first; that part is never shown or spoken, also while it is still being written. */
    fun clean(reply: String): String {
        var s = reply.replace(Regex("(?s)<think>.*?</think>"), "")
        val open = s.indexOf("<think>")
        if (open >= 0) s = s.substring(0, open)
        return s.trimStart()
    }

    /** Measures the real speed of the installed model with a short fixed task: words per second, or null when it could not run. Blocking. */
    fun speedTest(context: Context): Double? {
        var words = 0; var ms = 0L
        val ran = sessionWithStream(context) { _, stream ->
            val start = System.nanoTime()
            val out = stream("You are a concise assistant.", "Explain in about 80 words why sleep matters for memory.") { }
            ms = (System.nanoTime() - start) / 1_000_000
            words = out?.trim()?.split(Regex("\\s+"))?.size ?: 0
        }
        return if (ran && words > 0 && ms > 0) words * 1000.0 / ms else null
    }

    /** Runs [prompt] (with [system] as the standing instruction) and returns the raw reply, or null when the model is missing or anything fails. */
    fun generate(context: Context, system: String, prompt: String): String? {
        var reply: String? = null
        session(context) { ask -> reply = ask(system, prompt) }
        return reply
    }

    /** The spoken briefing written by the model, or null (no model, failure, or an unusable reply: the caller then uses the plain briefing). */
    fun narrate(context: Context, items: List<BriefingItem>, readingUnread: Int, hour: Int, mode: NewsMode = NewsMode.ALL): String? {
        if (items.isEmpty()) return null
        val reply = generate(context, BriefingPrompt.SYSTEM, BriefingPrompt.user(items, readingUnread, hour, mode)) ?: return null
        return BriefingPrompt.cleanReply(reply)
    }
}
