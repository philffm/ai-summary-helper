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
    fun session(context: Context, block: (ask: (String, String) -> String?) -> Unit): Boolean = synchronized(this) { sessionLocked(context, block) }   // one model in memory at a time

    private fun sessionLocked(context: Context, block: (ask: (String, String) -> String?) -> Unit): Boolean {
        val store = ModelStore.of(context)
        if (!store.installed()) return false
        var engine: Engine? = null
        Guard.begin(context, "model")   // a native crash cannot be caught; this mark tells the next start what happened
        return try {
            val cache = context.cacheDir.resolve("litert").apply { mkdirs() }
            engine = Engine(EngineConfig(modelPath = store.file.path, backend = Backend.CPU(), cacheDir = cache.path))
            engine.initialize()
            val eng: Engine = engine
            block { system, prompt ->
                try {
                    val conversation = eng.createConversation(ConversationConfig(systemInstruction = Contents.of(system)))
                    try { conversation.sendMessage(prompt).toString() } finally { conversation.close() }
                } catch (_: Exception) { null }
            }
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
