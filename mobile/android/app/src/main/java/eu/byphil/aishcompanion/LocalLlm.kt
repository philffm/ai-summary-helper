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

    /** Runs [prompt] (with [system] as the standing instruction) and returns the raw reply, or null when the model is missing or anything fails. */
    fun generate(context: Context, system: String, prompt: String): String? {
        val store = ModelStore.of(context)
        if (!store.installed()) return null
        var engine: Engine? = null
        return try {
            val cache = context.cacheDir.resolve("litert").apply { mkdirs() }
            engine = Engine(EngineConfig(modelPath = store.file.path, backend = Backend.CPU(), cacheDir = cache.path))
            engine.initialize()
            val conversation = engine.createConversation(ConversationConfig(systemInstruction = Contents.of(system)))
            try { conversation.sendMessage(prompt).toString() } finally { conversation.close() }
        } catch (e: Exception) {
            null
        } catch (e: UnsatisfiedLinkError) {
            null
        } finally {
            runCatching { engine?.close() }
        }
    }

    /** The spoken briefing written by the model, or null (no model, failure, or an unusable reply: the caller then uses the plain briefing). */
    fun narrate(context: Context, items: List<BriefingItem>, readingUnread: Int, hour: Int): String? {
        if (items.isEmpty()) return null
        val reply = generate(context, BriefingPrompt.SYSTEM, BriefingPrompt.user(items, readingUnread, hour)) ?: return null
        return BriefingPrompt.cleanReply(reply)
    }
}
