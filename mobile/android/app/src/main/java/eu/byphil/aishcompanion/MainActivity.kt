package eu.byphil.aishcompanion

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

/** Pair once (scan the code from the extension's Settings → Phone inbox), then just use the share sheet. */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val store = Store(this)
        setContent {
            MaterialTheme {
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

    fun accept(text: String?) {
        val p = text?.let { Pairing.parse(it) }
        if (p == null) { error = "That is not an AISH pairing code."; return }
        store.pairing = p; store.lastError = null; pairing = p; error = null; pasted = ""
    }

    Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("AISH Companion", style = MaterialTheme.typography.headlineSmall)
        if (pairing == null) {
            Text("In the browser extension open Settings → Phone inbox → Pair a phone, then scan the code. After that, share any link to AISH from any app.")
            Button(onClick = { onScan { accept(it) } }, Modifier.fillMaxWidth()) { Text("Scan pairing code") }
            OutlinedTextField(pasted, { pasted = it }, Modifier.fillMaxWidth(), label = { Text("Or paste the pairing code") })
            OutlinedButton(onClick = { accept(pasted) }, Modifier.fillMaxWidth(), enabled = pasted.isNotBlank()) { Text("Pair") }
        } else {
            Text("Paired. Use Share → AISH in any app to send a link to your browser, where you tap Summarize.")
            store.lastError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            OutlinedButton(onClick = { store.pairing = null; pairing = null }, Modifier.fillMaxWidth()) { Text("Unpair this phone") }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
}
