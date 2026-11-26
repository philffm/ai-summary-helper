package eu.byphil.aishcompanion

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** The depth rail at the edge of the reader: where the highlights lie and what is on screen. Tap or drag to go there. */
@Composable
fun DepthRail(spots: List<Spot>, window: () -> Pair<Float, Float>?, onSpot: (Spot) -> Unit, onSeek: (Float) -> Unit, modifier: Modifier = Modifier) {
    val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    // as in the text: own highlights are amber, the AI's suggestions teal (see markColors in Ui.kt)
    val own = if (dark) Color(0xFFD4A514) else Color(0xFFEAB308)
    val ai = MaterialTheme.colorScheme.secondary
    val track = MaterialTheme.colorScheme.surfaceContainerHighest
    val frame = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
    val haptic = LocalHapticFeedback.current
    val latest by rememberUpdatedState(Triple(spots, onSpot, onSeek))
    val step = remember(spots) { intArrayOf(-1) }   // where the screen reader's "next" and "previous" are
    fun go(to: Int) { if (to in spots.indices) { step[0] = to; onSpot(spots[to]) } }
    Box(
        modifier.width(32.dp).semantics {
            contentDescription = "Highlights: ${spots.size}"
            customActions = listOf(
                CustomAccessibilityAction("Next highlight") { go(minOf(spots.size - 1, step[0] + 1)); true },
                CustomAccessibilityAction("Previous highlight") { go(maxOf(0, step[0] - 1)); true },
            )
        }.pointerInput(Unit) {
            awaitEachGesture {
                var held: Spot? = null
                var change = awaitFirstDown()
                while (change.pressed) {
                    change.consume()
                    val fraction = (change.position.y / size.height).coerceIn(0f, 1f)
                    val near = DepthTrack.near(latest.first, fraction, 14.dp.toPx() / size.height)
                    if (near == null) { held = null; latest.third(fraction) }
                    else if (near != held) { held = near; haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove); latest.second(near) }
                    change = awaitPointerEvent().changes.firstOrNull { it.id == change.id } ?: break
                }
            }
        },
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val x = size.width / 2
            val bar = 10.dp.toPx(); val round = CornerRadius(bar / 2)
            drawRoundRect(track, Offset(x - bar / 2, 0f), Size(bar, size.height), round)
            for (s in spots) {
                val h = maxOf(8.dp.toPx(), (s.to - s.from) * size.height)
                drawRoundRect(if (s.ghost) ai else own, Offset(x - bar / 2, minOf(s.from * size.height, size.height - h)), Size(bar, h), round)
            }
            window()?.let { (from, to) ->
                val h = maxOf(18.dp.toPx(), (to - from) * size.height)
                val w = 20.dp.toPx()
                drawRoundRect(frame, Offset(x - w / 2, minOf(from * size.height, size.height - h)), Size(w, h), CornerRadius(9.dp.toPx()), style = Stroke(1.5.dp.toPx()))
            }
        }
    }
}
