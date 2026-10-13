package eu.byphil.aishcompanion

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.util.Locale

/** What is read aloud: sentences in reading order. Pure, unit-tested. */
object ReadAloudUnits {
    private fun sentences(text: String) = SpeechChunker.next(text, 0, last = true).first

    /** Title, then the article text (code blocks are skipped: they do not read well). */
    fun article(title: String, blocks: List<Block>): List<String> =
        (if (title.isNotBlank()) listOf(title.trim()) else emptyList()) + blocks.filter { it.type != "pre" }.flatMap { sentences(it.text) }

    fun summary(summary: String): List<String> = sentences(summary)
}

/**
 * Reads a list of sentences with the phone's text-to-speech engine: play, pause (resumes at the same sentence) and speed.
 * State is Compose state, so the UI follows it. [shutdown] when the screen goes away.
 */
class ReadAloud(context: Context, initialRate: Float = 1f, private val onRate: (Float) -> Unit = {}) {
    enum class State { IDLE, PLAYING, PAUSED }

    var state by mutableStateOf(State.IDLE); private set
    var index by mutableIntStateOf(0); private set
    var total by mutableIntStateOf(0); private set
    var rate by mutableFloatStateOf(initialRate); private set

    private var units: List<String> = emptyList()
    private var locale: Locale? = null
    private var ready = false
    private var pending: (() -> Unit)? = null
    private val main = Handler(Looper.getMainLooper())
    private var tts: TextToSpeech? = TextToSpeech(context.applicationContext) { status ->
        ready = status == TextToSpeech.SUCCESS
        if (ready) pending?.invoke() else state = State.IDLE
        pending = null
    }.also { engine ->
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String?) {}
            override fun onDone(id: String?) { main.post { if (state == State.PLAYING && id == "ra-$index") speakAt(index + 1) } }
            @Deprecated("Deprecated in Java") override fun onError(id: String?) { main.post { state = State.IDLE } }
        })
    }

    fun start(sentences: List<String>, language: String = "") {
        units = sentences.filter { it.isNotBlank() }
        total = units.size
        locale = language.takeIf { it.isNotBlank() }?.let { Locale.forLanguageTag(it) }
        if (units.isEmpty()) return
        index = 0; state = State.PLAYING
        val go = { runCatching { tts?.language = locale ?: Locale.getDefault() }; speakAt(0) }
        if (ready) go() else pending = go
    }

    private fun speakAt(i: Int) {
        val engine = tts ?: return
        if (i >= units.size) { state = State.IDLE; index = 0; return }
        index = i
        engine.setSpeechRate(rate)
        engine.speak(units[i], TextToSpeech.QUEUE_FLUSH, null, "ra-$i")
    }

    fun toggle() {
        when (state) {
            State.PLAYING -> { tts?.stop(); state = State.PAUSED }
            State.PAUSED -> { state = State.PLAYING; speakAt(index) }
            State.IDLE -> {}
        }
    }

    /** Next speed in the cycle 1× → 1.25× → 1.5× → 0.8×; a sentence in progress starts again at the new speed. */
    fun cycleRate() {
        val steps = listOf(1f, 1.25f, 1.5f, 0.8f)
        val next = steps[(steps.indexOfFirst { kotlin.math.abs(it - rate) < 0.01f } + 1).mod(steps.size)]
        rate = next; onRate(next)
        if (state == State.PLAYING) speakAt(index)
    }

    fun stop() { tts?.stop(); state = State.IDLE; index = 0 }

    fun shutdown() { runCatching { tts?.stop(); tts?.shutdown() }; tts = null; state = State.IDLE }
}
