package eu.byphil.aishcompanion

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import java.io.File

/**
 * Marks risky steps ("start", "alarm", "model") before they run and clears the mark when they went well. A mark still there at the
 * next start means the app died inside that step, even when no error could be written (a native crash). Synchronous on purpose.
 */
object Guard {
    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences("guard", Context.MODE_PRIVATE)
    fun begin(context: Context, name: String) { prefs(context).edit().putBoolean(name, true).commit() }
    fun end(context: Context, name: String) { prefs(context).edit().remove(name).commit() }
    fun pending(context: Context): List<String> = prefs(context).all.keys.sorted()
    fun clear(context: Context) { prefs(context).edit().clear().commit() }

    fun describe(name: String): String = when (name) {
        "start" -> "starting up"
        "alarm" -> "setting the alarm"
        "model" -> "running the on-device model"
        else -> name
    }
}

/**
 * Keeps the last crash on this phone, so a crash that happens on every start can still be read and passed on without a computer:
 * the next start shows it (see [CrashScreen]) instead of crashing again. The file stays on the phone and is only shown, never sent.
 */
object CrashLog {
    private fun file(context: Context) = File(context.applicationContext.filesDir, "last-crash.txt")

    fun install(context: Context) {
        val app = context.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching { file(app).writeText("${java.util.Date()}\nthread: ${thread.name}\n" + error.stackTraceToString().take(12_000)) }
            previous?.uncaughtException(thread, error)
        }
    }

    fun read(context: Context): String? = file(context).takeIf { it.isFile }?.readText()?.ifBlank { null }
    fun clear(context: Context) { file(context).delete() }
}

@Composable
fun CrashScreen(text: String, onSafeStart: () -> Unit, onOpenAnyway: () -> Unit) {
    val context = LocalContext.current
    Surface(Modifier.fillMaxSize()) {
        Column(Modifier.safeDrawingPadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("The app stopped last time", style = MaterialTheme.typography.titleLarge)
            Text("This is what went wrong. Copy it and send it to whoever is fixing the app.", style = MaterialTheme.typography.bodyMedium)
            SelectionContainer(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                Text(text, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
            }
            Button(onClick = {
                context.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("crash", text))
            }, Modifier.fillMaxWidth()) { Text("Copy") }
            OutlinedButton(onClick = onSafeStart, Modifier.fillMaxWidth()) { Text("Turn the alarm off and open the app") }
            OutlinedButton(onClick = onOpenAnyway, Modifier.fillMaxWidth()) { Text("Open the app") }
        }
    }
}
