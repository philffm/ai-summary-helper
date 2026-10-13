package eu.byphil.aishcompanion

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Sign in with an email code, like in the browser extension; shows the plan once signed in. Syncing with the browser stays end-to-end encrypted via pairing. */
@Composable
fun AccountCard(model: AppModel) {
    val scope = rememberCoroutineScope()
    var email by remember { mutableStateOf("") }
    var otpId by remember { mutableStateOf<String?>(null) }
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    var plan by remember { mutableStateOf<String?>(null) }
    var usage by remember { mutableStateOf<AccountInfo?>(null) }
    val signedIn = model.accountEmail.isNotBlank()

    LaunchedEffect(model.license, signedIn) {
        if (signedIn && model.license.isNotBlank()) {
            val info = withContext(Dispatchers.IO) { Account.check(model.license) }
            plan = Account.describe(info); usage = info?.takeIf { it.active }
        } else { plan = null; usage = null }
    }

    fun send() {
        busy = true; note = null
        scope.launch {
            val (id, err) = withContext(Dispatchers.IO) { Login.request(email) }
            otpId = id; note = err ?: if (id != null) "Code sent. Check your inbox." else null; busy = false
        }
    }
    fun verify(c: String) {
        val id = otpId ?: return
        busy = true; note = null
        scope.launch {
            val (signed, err) = withContext(Dispatchers.IO) { Login.verify(id, c, email) }
            busy = false
            if (signed != null) { model.signIn(signed); otpId = null; code = ""; email = "" } else { note = err; code = "" }
        }
    }

    usage?.let { u -> UsageCard(u, model.store.localRuns, model.store.cloudCalls) }
    SettingsGroup {
        if (signedIn) {
            Text("Signed in as ${model.accountEmail}", style = MaterialTheme.typography.titleMedium)
            Text(plan ?: if (model.license.isBlank()) "Free plan." else "Checking your plan…", style = MaterialTheme.typography.bodyMedium)
            OutlinedButton(onClick = { model.signOut() }) { Text("Sign out") }
        } else if (otpId == null) {
            Text("Sign in to use your plan and the cloud AI here, as in the browser extension.", style = MaterialTheme.typography.bodyMedium)
            OutlinedTextField(email, { email = it }, Modifier.fillMaxWidth(), label = { Text("Email") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
            Button(onClick = { send() }, enabled = !busy && email.contains("@")) { Text(if (busy) "Sending…" else "Send code") }
        } else {
            Text("Enter the 4-digit code we sent to ${email.trim()}.", style = MaterialTheme.typography.bodyMedium)
            OutlinedTextField(code, { v -> code = v.filter { it.isDigit() }.take(4); if (code.length == 4) verify(code) }, Modifier.fillMaxWidth(), label = { Text("Code") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { verify(code) }, enabled = !busy && code.length >= 4) { Text(if (busy) "Checking…" else "Sign in") }
                TextButton(onClick = { send() }, enabled = !busy) { Text("Send again") }
                TextButton(onClick = { otpId = null; code = ""; note = null }) { Text("Back") }
            }
        }
        note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        Text("Signing in only identifies your account. Your feeds and reading list sync with the browser end-to-end encrypted through the pairing code, never through the account.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** This month's cloud AI use as the server counts it, and what ran on this phone (free, never sent anywhere). */
@Composable
private fun UsageCard(u: AccountInfo, localRuns: Int, cloudCalls: Int) {
    SettingsCaption("AI use this month")
    SettingsGroup {
        Text("${100 - u.percent}% of the monthly allowance left", style = MaterialTheme.typography.titleMedium)
        androidx.compose.material3.LinearProgressIndicator(progress = { (1f - u.percent / 100f).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
        Text(
            "${u.requests} cloud request" + (if (u.requests == 1) "" else "s") + " · ${Account.tokens(u.tokensIn)} tokens in, ${Account.tokens(u.tokensOut)} out" +
                (if (u.resetAt.length >= 10) " · resets ${u.resetAt.take(10)}" else ""),
            style = MaterialTheme.typography.bodyMedium,
        )
        if (u.models.isNotEmpty()) {
            Text("By model", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            for (m in u.models) Text("${m.model.substringAfterLast('/')} · ${m.requests}×", style = MaterialTheme.typography.bodyMedium)
            Text("From 80% of the allowance the cheapest model is used; at 100% cloud AI pauses until the reset.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else if (u.lastModel.isNotBlank()) Text("Last model: ${u.lastModel.substringAfterLast('/')}", style = MaterialTheme.typography.bodyMedium)
        Text(
            "On this phone: $localRuns on-device model run" + (if (localRuns == 1) "" else "s") + " (free, never sent anywhere) · $cloudCalls call" + (if (cloudCalls == 1) "" else "s") + " to the cloud AI. Use from the browser extension counts here too.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
