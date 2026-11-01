package eu.byphil.aishcompanion

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
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

/** Font, size, line spacing and background for the article reader. Choices apply at once and are remembered. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReaderSheet(model: AppModel, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 24.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Reading", style = MaterialTheme.typography.titleMedium)
            ChipGroup("Typeface", ReaderLook.FONTS, model.readerFont) { model.changeReaderFont(it) }
            ChipGroup("Text size", listOf("0.9" to "Small", "1.0" to "Normal", "1.2" to "Large", "1.5" to "Huge"),
                listOf(0.9f, 1.0f, 1.2f, 1.5f).minByOrNull { kotlin.math.abs(it - model.readerScale) }.toString()) { model.changeReaderScale(it.toFloat()) }
            ChipGroup("Line spacing", ReaderLook.SPACING.map { it.first.toString() to it.second },
                ReaderLook.SPACING.minByOrNull { kotlin.math.abs(it.first - model.readerSpacing) }!!.first.toString()) { model.changeReaderSpacing(it.toFloat()) }
            ChipGroup("Background", ReaderLook.THEMES, model.readerTheme) { model.changeReaderTheme(it) }
        }
    }
}

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun ChipGroup(title: String, options: List<Pair<String, String>>, selected: String, onPick: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for ((key, label) in options) FilterChip(shape = PillShape, selected = key == selected, onClick = { onPick(key) }, label = { Text(label) })
        }
    }
}
