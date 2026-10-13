package eu.byphil.aishcompanion

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

// The AISH look, taken from the extension's design tokens (plugin/src/styles.css): the same blues, the same neutral
// surfaces in light and dark, 12/16 px radii. Fixed colours on purpose (no Android 12 dynamic colour) so the app
// matches the extension and the website.
private val Light = lightColorScheme(
    primary = Color(0xFF2563EB), onPrimary = Color.White,
    primaryContainer = Color(0xFFDBEAFE), onPrimaryContainer = Color(0xFF1E3A8A),
    secondary = Color(0xFF2F5FD0), onSecondary = Color.White,   // 5.5:1 (the lighter #3B82F6 gave white text only 3.7:1)
    background = Color(0xFFFAF8FF), onBackground = Color(0xFF0F172A),
    surface = Color(0xFFFAF8FF), onSurface = Color(0xFF0F172A),
    surfaceVariant = Color(0xFFEEF1F8), onSurfaceVariant = Color(0xFF566274),
    outline = Color(0xFF64748B), outlineVariant = Color(0xFFD5DBE6),
    error = Color(0xFFDC2626), onError = Color.White,
    secondaryContainer = Color(0xFFE0E9FB), onSecondaryContainer = Color(0xFF1E3A8A),
    tertiaryContainer = Color(0xFFFDF0C8), onTertiaryContainer = Color(0xFF5B3B05),
    errorContainer = Color(0xFFFEE2E2), onErrorContainer = Color(0xFF7F1D1D),
    surfaceContainerLowest = Color.White, surfaceContainerLow = Color(0xFFF5F6FC), surfaceContainer = Color(0xFFF0F2FA),
    surfaceContainerHigh = Color(0xFFEAEDF6), surfaceContainerHighest = Color(0xFFE4E8F2),
)
private val Dark = darkColorScheme(
    primary = Color(0xFF60A5FA), onPrimary = Color(0xFF0B0E14),
    primaryContainer = Color(0xFF1E3A8A), onPrimaryContainer = Color(0xFFDBEAFE),
    secondary = Color(0xFF3B82F6), onSecondary = Color(0xFF0B0E14),   // dark text on the bright blue: 5.3:1
    background = Color(0xFF0B0E14), onBackground = Color(0xFFE8EDF5),
    surface = Color(0xFF0B0E14), onSurface = Color(0xFFE8EDF5),
    surfaceVariant = Color(0xFF171C26), onSurfaceVariant = Color(0xFF94A3B8),
    outline = Color(0xFF64748B), outlineVariant = Color(0xFF2A3140),
    error = Color(0xFFFCA5A5), onError = Color(0xFF0B0E14),
    secondaryContainer = Color(0xFF1E2B4A), onSecondaryContainer = Color(0xFFDBEAFE),
    tertiaryContainer = Color(0xFF3D2F0F), onTertiaryContainer = Color(0xFFFDE68A),
    errorContainer = Color(0xFF4C1D1D), onErrorContainer = Color(0xFFFECACA),
    surfaceContainerLowest = Color(0xFF080A10), surfaceContainerLow = Color(0xFF0F131B), surfaceContainer = Color(0xFF131822),
    surfaceContainerHigh = Color(0xFF181E2A), surfaceContainerHighest = Color(0xFF1E2532),
)
// High contrast: text and borders at the strongest steps (WCAG AAA for text), same brand hue.
private val LightHigh = Light.copy(
    primary = Color(0xFF1D4ED8), onSurface = Color(0xFF000000), onBackground = Color(0xFF000000), onSurfaceVariant = Color(0xFF2B3544),
    outline = Color(0xFF334155), outlineVariant = Color(0xFF64748B), primaryContainer = Color(0xFFBFD7FE), onPrimaryContainer = Color(0xFF0B1F5C),
    secondary = Color(0xFF1D4ED8),
)
private val DarkHigh = Dark.copy(
    primary = Color(0xFF93C5FD), onSurface = Color(0xFFFFFFFF), onBackground = Color(0xFFFFFFFF), onSurfaceVariant = Color(0xFFD5DBE6),
    outline = Color(0xFFCBD5E1), outlineVariant = Color(0xFF94A3B8), primaryContainer = Color(0xFF1E3A8A), onPrimaryContainer = Color(0xFFFFFFFF),
    secondary = Color(0xFF93C5FD), onSecondary = Color(0xFF0B0E14),
)

/** True when animations should be skipped: the "Reduce motion" setting, or the system turned animations off. */
val LocalReduceMotion = androidx.compose.runtime.compositionLocalOf { false }

private val AishShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp), small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(16.dp), large = RoundedCornerShape(20.dp), extraLarge = RoundedCornerShape(28.dp),
)

/** Hanken Grotesk, as in the extension (variable font: one file, every weight). */
@OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
val HankenGrotesk = FontFamily(
    listOf(400, 500, 600, 700).map { w -> Font(R.font.hanken_grotesk, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w))) },
)

/** Atkinson Hyperlegible, the "easy read" face of the extension: letter shapes that stay distinct at a glance. */
val AtkinsonHyperlegible = FontFamily(Font(R.font.atkinson_hyperlegible, FontWeight.Normal), Font(R.font.atkinson_hyperlegible_bold, FontWeight.Bold))

private fun Typography.with(family: FontFamily): Typography {
    fun TextStyle.f() = copy(fontFamily = family)
    return copy(
        displayLarge = displayLarge.f(), displayMedium = displayMedium.f(), displaySmall = displaySmall.f(),
        headlineLarge = headlineLarge.f(), headlineMedium = headlineMedium.f(), headlineSmall = headlineSmall.f(),
        titleLarge = titleLarge.f(), titleMedium = titleMedium.f(), titleSmall = titleSmall.f(),
        bodyLarge = bodyLarge.f(), bodyMedium = bodyMedium.f(), bodySmall = bodySmall.f(),
        labelLarge = labelLarge.f(), labelMedium = labelMedium.f(), labelSmall = labelSmall.f(),
    )
}
private val AishTypography = Typography().with(HankenGrotesk)

@Composable
fun AishTheme(highContrast: Boolean = false, reduceMotion: Boolean = false, content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val scheme = when { highContrast && dark -> DarkHigh; highContrast -> LightHigh; dark -> Dark; else -> Light }
    val noMotion = reduceMotion || !android.animation.ValueAnimator.areAnimatorsEnabled()
    androidx.compose.runtime.CompositionLocalProvider(LocalReduceMotion provides noMotion) {
        MaterialTheme(colorScheme = scheme, shapes = AishShapes, typography = AishTypography, content = content)
    }
}
