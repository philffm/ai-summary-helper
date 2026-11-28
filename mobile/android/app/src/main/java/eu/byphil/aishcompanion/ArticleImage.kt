package eu.byphil.aishcompanion

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/** A picture saved with an article, read no larger than it is shown. Where it cannot be read, its description stands for it. */
@Composable
fun ArticleImage(file: File?, description: String) {
    BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        val room = constraints.maxWidth
        val bitmap by produceState<android.graphics.Bitmap?>(null, file?.path, file?.length(), room) {
            value = withContext(Dispatchers.IO) {
                val path = file?.path ?: return@withContext null
                val size = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeFile(path, size)
                if (size.outWidth <= 0 || size.outHeight <= 0) return@withContext null
                var sample = 1
                // not wider than shown, and never more than a few million pixels, however tall the picture
                while (size.outWidth / (sample * 2) >= room || size.outWidth.toLong() * size.outHeight / (sample * sample) > 8_000_000) sample *= 2
                runCatching { BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample }) }.getOrNull()
            }
        }
        val shown = bitmap
        if (shown != null) {
            // a small picture keeps its size, a large one takes the width
            val own = with(LocalDensity.current) { (shown.width * 2).toDp() }
            Image(shown.asImageBitmap(), contentDescription = description.ifBlank { null }, contentScale = ContentScale.FillWidth,
                modifier = Modifier.widthIn(max = own.coerceAtLeast(48.dp)).fillMaxWidth().clip(RoundedCornerShape(12.dp)))
        } else if (file == null && description.isNotBlank()) Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
