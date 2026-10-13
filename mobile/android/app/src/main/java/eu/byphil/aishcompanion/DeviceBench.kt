package eu.byphil.aishcompanion

import android.app.ActivityManager
import android.content.Context
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.min

/** What a quick check of the phone found. */
data class DeviceProfile(val ramGb: Double, val cores: Int, val bandwidthGbps: Double)

/** How well a model should run on a phone. */
enum class Fit(val label: String) { FAST("Fast"), OK("Fine"), SLOW("Slow"), NO("Too big for this phone") }

data class Verdict(val option: ModelOption, val fit: Fit, val wordsPerSecond: Double)

/**
 * A few seconds of measuring before anything is downloaded: the memory of the phone and how fast it reads memory with all cores
 * (generating text with a model is mostly reading its weights over and over, so this predicts the speed well enough to sort models).
 * It is an estimate; "Test speed" measures the real thing once a model is installed.
 */
object DeviceBench {
    private const val BYTES = 64 * 1024 * 1024
    private const val PASSES = 3

    /** Blocking, about 2 to 4 seconds: call off the main thread. */
    fun measure(context: Context): DeviceProfile {
        val info = ActivityManager.MemoryInfo().also { context.getSystemService(ActivityManager::class.java).getMemoryInfo(it) }
        val cores = Runtime.getRuntime().availableProcessors().coerceIn(1, 8)
        val buffers = List(cores) { ByteBuffer.allocateDirect(BYTES / cores).order(ByteOrder.nativeOrder()).asLongBuffer().also { b -> for (i in 0 until b.capacity()) b.put(i, i.toLong()) } }
        var sink = 0L
        val best = (1..PASSES).minOf {
            val start = System.nanoTime()
            val sums = LongArray(cores)
            val threads = buffers.mapIndexed { i, b -> Thread { var s = 0L; for (k in 0 until b.capacity()) s += b.get(k); sums[i] = s }.also { t -> t.start() } }
            threads.forEach { it.join() }
            sink += sums.sum()
            System.nanoTime() - start
        }
        if (sink == 42L) println(sink)   // keeps the loops from being optimised away
        return DeviceProfile(info.totalMem / 1e9, cores, BYTES / (best / 1e9) / 1e9)
    }

    /** Words per second the phone is expected to manage: reading the weights once per token with about half of the measured speed (only the part of the model that is really read for each word counts), 0.75 words per token. */
    fun expectedWordsPerSecond(p: DeviceProfile, option: ModelOption): Double = p.bandwidthGbps * 0.5 / option.activeGb * 0.75

    fun verdict(p: DeviceProfile, option: ModelOption): Verdict {
        val words = expectedWordsPerSecond(p, option)
        val fits = option.needGb <= p.ramGb * 0.5
        val fit = when { !fits -> Fit.NO; words >= 6 -> Fit.FAST; words >= 3 -> Fit.OK; else -> Fit.SLOW }
        return Verdict(option, fit, words)
    }

    /** The best model that fits and is not slow: the highest quality first, the faster one on a tie. The smallest one when nothing else does. */
    fun recommend(p: DeviceProfile): ModelOption {
        val ok = Models.ALL.map { verdict(p, it) }.filter { it.fit == Fit.FAST || it.fit == Fit.OK }
        return ok.maxWithOrNull(compareBy<Verdict>({ it.option.quality }, { it.wordsPerSecond }))?.option ?: Models.ALL.minBy { it.size }
    }
}
