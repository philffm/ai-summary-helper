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

// The Kaivo look, following the extension's design tokens (design-system, brand Kaivo): the same teals, the same neutral
// surfaces in light and dark, 12/16 px radii. Fixed colours on purpose (no Android 12 dynamic colour) so the app
// matches the extension and the website.
private val Light = lightColorScheme(
    primary = Color(0xFF0F6675), onPrimary = Color.White,
    primaryContainer = Color(0xFFCFECEF), onPrimaryContainer = Color(0xFF0A444E),
    secondary = Color(0xFF0F6675), onSecondary = Color.White,   // 6.6:1 (the lighter #1C7F8E gives white text only 4.7:1)
    background = Color(0xFFF6FAFA), onBackground = Color(0xFF0F172A),
    surface = Color(0xFFF6FAFA), onSurface = Color(0xFF0F172A),
    surfaceVariant = Color(0xFFEEF3F4), onSurfaceVariant = Color(0xFF566274),
    outline = Color(0xFF64748B), outlineVariant = Color(0xFFD3DEE0),
    error = Color(0xFFDC2626), onError = Color.White,
    secondaryContainer = Color(0xFFDCEFF1), onSecondaryContainer = Color(0xFF0A444E),
    tertiaryContainer = Color(0xFFFDF0C8), onTertiaryContainer = Color(0xFF5B3B05),
    errorContainer = Color(0xFFFEE2E2), onErrorContainer = Color(0xFF7F1D1D),
    surfaceContainerLowest = Color.White, surfaceContainerLow = Color(0xFFF2F7F7), surfaceContainer = Color(0xFFEEF3F4),
    surfaceContainerHigh = Color(0xFFE7EEF0), surfaceContainerHighest = Color(0xFFE0E9EB),
)
private val Dark = darkColorScheme(
    primary = Color(0xFF3FA6B3), onPrimary = Color(0xFF0B0E14),
    primaryContainer = Color(0xFF0B525E), onPrimaryContainer = Color(0xFFCFECEF),
    secondary = Color(0xFF3FA6B3), onSecondary = Color(0xFF0B0E14),   // dark text on the light teal: 6.7:1
    background = Color(0xFF0B0E14), onBackground = Color(0xFFE8EDF5),
    surface = Color(0xFF0B0E14), onSurface = Color(0xFFE8EDF5),
    surfaceVariant = Color(0xFF172326), onSurfaceVariant = Color(0xFF94A3B8),
    outline = Color(0xFF64748B), outlineVariant = Color(0xFF27393D),
    error = Color(0xFFFCA5A5), onError = Color(0xFF0B0E14),
    secondaryContainer = Color(0xFF133238), onSecondaryContainer = Color(0xFFCFECEF),
    tertiaryContainer = Color(0xFF3D2F0F), onTertiaryContainer = Color(0xFFFDE68A),
    errorContainer = Color(0xFF4C1D1D), onErrorContainer = Color(0xFFFECACA),
    surfaceContainerLowest = Color(0xFF080A10), surfaceContainerLow = Color(0xFF0E1719), surfaceContainer = Color(0xFF111D20),
    surfaceContainerHigh = Color(0xFF172629), surfaceContainerHighest = Color(0xFF1D2E32),
)
// High contrast: text and borders at the strongest steps (WCAG AAA for text), same brand hue.
private val LightHigh = Light.copy(
    primary = Color(0xFF0A444E), onSurface = Color(0xFF000000), onBackground = Color(0xFF000000), onSurfaceVariant = Color(0xFF2B3544),
    outline = Color(0xFF334155), outlineVariant = Color(0xFF64748B), primaryContainer = Color(0xFFB4E0E5), onPrimaryContainer = Color(0xFF062F36),
    secondary = Color(0xFF0A444E),
)
private val DarkHigh = Dark.copy(
    primary = Color(0xFF7CCBD4), onSurface = Color(0xFFFFFFFF), onBackground = Color(0xFFFFFFFF), onSurfaceVariant = Color(0xFFD5DBE6),
    outline = Color(0xFFCBD5E1), outlineVariant = Color(0xFF94A3B8), primaryContainer = Color(0xFF0B525E), onPrimaryContainer = Color(0xFFFFFFFF),
    secondary = Color(0xFF7CCBD4), onSecondary = Color(0xFF0B0E14),
)

/** The extension's chips and filters are fully rounded pills; one shape for every chip of the app. */
val PillShape = RoundedCornerShape(percent = 50)

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
fun AishTheme(
    highContrast: Boolean = false, reduceMotion: Boolean = false,
    /** "system", "light" or "dark": the app's own choice, independent of the system setting. */
    themeMode: String = "system",
    /** Android 12+: take the colours from the wallpaper instead of the brand teal. Ignored with high contrast. */
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit,
) {
    val dark = when (themeMode) { "dark" -> true; "light" -> false; else -> isSystemInDarkTheme() }
    val context = androidx.compose.ui.platform.LocalContext.current
    val wallpaper = dynamicColor && !highContrast && android.os.Build.VERSION.SDK_INT >= 31
    val scheme = when {
        wallpaper && dark -> androidx.compose.material3.dynamicDarkColorScheme(context)
        wallpaper -> androidx.compose.material3.dynamicLightColorScheme(context)
        highContrast && dark -> DarkHigh; highContrast -> LightHigh; dark -> Dark; else -> Light
    }
    val noMotion = reduceMotion || !android.animation.ValueAnimator.areAnimatorsEnabled()
    androidx.compose.runtime.CompositionLocalProvider(LocalReduceMotion provides noMotion) {
        MaterialTheme(colorScheme = scheme, shapes = AishShapes, typography = AishTypography, content = content)
    }
}
