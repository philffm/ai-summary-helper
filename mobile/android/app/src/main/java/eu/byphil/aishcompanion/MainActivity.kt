package eu.byphil.aishcompanion

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

/** Pair once (scan the code from the extension's Settings → Phone inbox), then just use the share sheet. */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()   // content is drawn under the system bars; Screen pads itself with safeDrawingPadding()
        val store = Store(this)
        setContent {
            AishTheme {
                Surface(Modifier.fillMaxSize()) {
                    Screen(store, onScan = { onResult -> scan(onResult) })
                }
            }
        }
    }

    private fun scan(onResult: (String?) -> Unit) {
        val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        GmsBarcodeScanning.getClient(this, options).startScan()
            .addOnSuccessListener { onResult(it.rawValue) }
            .addOnFailureListener { onResult(null) }
    }
}

@Composable
private fun Screen(store: Store, onScan: ((String?) -> Unit) -> Unit) {
    var pairing by remember { mutableStateOf(store.pairing) }
    var error by remember { mutableStateOf<String?>(null) }
    var pasted by remember { mutableStateOf("") }
    var showPaste by remember { mutableStateOf(false) }

    fun accept(text: String?) {
        val p = text?.let { Pairing.parse(it) }
        if (p == null) { error = "That is not an AISH pairing code."; return }
        store.pairing = p; store.lastError = null; pairing = p; error = null; pasted = ""; showPaste = false
    }

    Box(Modifier.fillMaxSize().safeDrawingPadding(), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = 520.dp).fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Header()
            if (pairing == null) {
                Steps(
                    "Set up once",
                    listOf(
                        "In the browser extension open Settings → Phone inbox and tap Pair a phone.",
                        "Tap Scan pairing code below and scan the QR code on your screen.",
                        "Then share any link to AISH from any app.",
                    ),
                )
                Button(onClick = { onScan { accept(it) } }, Modifier.fillMaxWidth()) { Text("Scan pairing code") }
                if (showPaste) {
                    OutlinedTextField(pasted, { pasted = it }, Modifier.fillMaxWidth(), label = { Text("Pairing code") }, singleLine = true)
                    Button(onClick = { accept(pasted) }, Modifier.fillMaxWidth(), enabled = pasted.isNotBlank()) { Text("Pair") }
                } else {
                    TextButton(onClick = { showPaste = true }) { Text("Paste the code instead") }
                }
            } else {
                StatusCard("Paired", "This phone can send links to your browser.")
                Steps(
                    "How to use",
                    listOf(
                        "In any app tap Share and choose AISH.",
                        "The link goes to your browser, end-to-end encrypted.",
                        "Open History → From phone and tap Summarize.",
                    ),
                )
                store.lastError?.let { StatusCard("Last send failed", it, isError = true) }
                TextButton(onClick = { store.pairing = null; pairing = null }) { Text("Unpair this phone") }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center) }
        }
    }
}

@Composable
private fun Header() {
    Column(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.size(112.dp).clip(CircleShape)) {
            Image(painterResource(R.drawable.ic_launcher_background), contentDescription = null, modifier = Modifier.fillMaxSize())
            Image(painterResource(R.drawable.ic_launcher_foreground), contentDescription = null, modifier = Modifier.fillMaxSize())
        }
        Text("AISH Companion", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Text(
            "Send links from your phone to AI Summary Helper in your browser.",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun StatusCard(title: String, body: String, isError: Boolean = false) {
    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = if (isError) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.primaryContainer),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(body, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun Steps(title: String, steps: List<String>) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            steps.forEachIndexed { i, text ->
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                    Surface(color = MaterialTheme.colorScheme.primary, shape = CircleShape, modifier = Modifier.size(24.dp)) {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text("${i + 1}", color = MaterialTheme.colorScheme.onPrimary, style = MaterialTheme.typography.labelMedium)
                        }
                    }
                    Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                }
            }
        }
    }
}
