package eu.byphil.aishcompanion

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import kotlin.math.roundToInt
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp

/** How article text is set: typeface and line spacing (the colours are applied by the reader's surface). */
data class ReaderStyle(val family: FontFamily? = null, val spacing: Float = 1f)

val LocalReaderStyle = compositionLocalOf { ReaderStyle() }

object ReaderLook {
    val FONTS = listOf("sans" to "App font", "serif" to "Serif", "easy" to "Easy read")
    val THEMES = listOf("auto" to "Auto", "paper" to "Paper", "white" to "White", "dark" to "Dark")
    val SPACING = listOf(1f to "Tight", 1.15f to "Normal", 1.35f to "Airy")

    fun family(key: String): FontFamily? = when (key) {
        "serif" -> FontFamily.Serif
        "easy" -> AtkinsonHyperlegible
        else -> null
    }

    /** Background and text colour of a fixed reader theme; null for "auto" (the app's own colours). */
    fun colors(theme: String): Pair<Color, Color>? = when (theme) {
        "paper" -> Color(0xFFF4ECD8) to Color(0xFF3B3226)
        "white" -> Color(0xFFFFFFFF) to Color(0xFF111111)
        "dark" -> Color(0xFF121212) to Color(0xFFE6E6E6)
        else -> null
    }
}

/** Text size, typeface, line spacing and background of the article reader. Choices apply at once and are remembered. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReaderSettings(model: AppModel) {
    val sizes = listOf(0.9f to "Small", 1.0f to "Normal", 1.2f to "Large", 1.5f to "Huge")
    val at = sizes.indices.minByOrNull { kotlin.math.abs(sizes[it].first - model.readerScale) } ?: 1
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Text size · ${sizes[at].second}", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Slider(
            value = at.toFloat(), onValueChange = { v -> val i = v.roundToInt().coerceIn(sizes.indices); if (i != at) model.changeReaderScale(sizes[i].first) },
            valueRange = 0f..(sizes.size - 1).toFloat(), steps = sizes.size - 2,
            modifier = Modifier.semantics { contentDescription = "Text size"; stateDescription = sizes[at].second },
        )
        Choices("Typeface", ReaderLook.FONTS, model.readerFont) { model.changeReaderFont(it) }
        Choices("Line spacing", ReaderLook.SPACING.map { it.first.toString() to it.second },
            ReaderLook.SPACING.minByOrNull { kotlin.math.abs(it.first - model.readerSpacing) }!!.first.toString()) { model.changeReaderSpacing(it.toFloat()) }
        Choices("Background", ReaderLook.THEMES, model.readerTheme) { model.changeReaderTheme(it) }
    }
}

/** One of a few: a row of segmented buttons. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Choices(title: String, options: List<Pair<String, String>>, selected: String, onPick: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            options.forEachIndexed { i, (key, label) ->
                SegmentedButton(selected = key == selected, onClick = { onPick(key) }, shape = SegmentedButtonDefaults.itemShape(i, options.size), icon = {}) {
                    Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}
