package eu.byphil.aishcompanion

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
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
    secondary = Color(0xFF3B82F6), onSecondary = Color.White,
    background = Color(0xFFFAF8FF), onBackground = Color(0xFF0F172A),
    surface = Color(0xFFFAF8FF), onSurface = Color(0xFF0F172A),
    surfaceVariant = Color(0xFFEEF1F8), onSurfaceVariant = Color(0xFF566274),
    outline = Color(0xFF94A3B8), outlineVariant = Color(0xFFD5DBE6),
    error = Color(0xFFDC2626), onError = Color.White,
)
private val Dark = darkColorScheme(
    primary = Color(0xFF60A5FA), onPrimary = Color(0xFF0B0E14),
    primaryContainer = Color(0xFF1E3A8A), onPrimaryContainer = Color(0xFFDBEAFE),
    secondary = Color(0xFF3B82F6), onSecondary = Color.White,
    background = Color(0xFF0B0E14), onBackground = Color(0xFFE8EDF5),
    surface = Color(0xFF0B0E14), onSurface = Color(0xFFE8EDF5),
    surfaceVariant = Color(0xFF171C26), onSurfaceVariant = Color(0xFF94A3B8),
    outline = Color(0xFF64748B), outlineVariant = Color(0xFF2A3140),
    error = Color(0xFFFCA5A5), onError = Color(0xFF0B0E14),
)
private val AishShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp), small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(12.dp), large = RoundedCornerShape(16.dp), extraLarge = RoundedCornerShape(20.dp),
)

@Composable
fun AishTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, shapes = AishShapes, content = content)
}
