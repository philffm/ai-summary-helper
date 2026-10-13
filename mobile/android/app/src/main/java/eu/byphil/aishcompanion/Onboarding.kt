package eu.byphil.aishcompanion

import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * What a new user sees on the empty Feeds screen. Everything here is optional: a few starter feeds to tap, an OPML import, and two
 * links to the steps that need the browser extension or an account. "Skip for now" (or having three feeds) ends it for good.
 */
@Composable
fun OnboardingCard(model: AppModel, onOpenSettings: (String) -> Unit, onAddByAddress: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    var suggestions by remember { mutableStateOf(SuggestedFeeds.load(context)) }
    LaunchedEffect(Unit) { suggestions = withContext(Dispatchers.IO) { SuggestedFeeds.refresh(context) } }
    val have = model.feeds.map { it.url }.toSet()
    val shown = suggestions.filter { it.url !in have }.take(8)
    val opml = rememberOpmlActions(model)

    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Welcome", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Text("Your feeds, your reading list and AI summaries on this phone. Everything works without an account or the browser extension.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)

        SettingsCaption("Pick a few feeds")
        SettingsCard {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                shown.forEach { f ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(f.icon, style = MaterialTheme.typography.titleLarge)
                        Column(Modifier.weight(1f)) {
                            Text(f.name, style = MaterialTheme.typography.bodyLarge)
                            val detail = listOf(f.note, f.tags.joinToString(", ")).filter { it.isNotBlank() }.joinToString(" · ")
                            if (detail.isNotEmpty()) Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
                        }
                        IconButton(enabled = !busy, onClick = {
                            scope.launch { busy = true; note = model.addFeed(f.url, f.tags.joinToString(",")); busy = false }
                        }) { Icon(Icons.Filled.Add, contentDescription = "Add " + f.name) }
                    }
                }
                note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = onAddByAddress) { Text("Add by address") }
                    OutlinedButton(onClick = opml.import) { Text("Import OPML…") }
                }
            }
        }

        SettingsCaption("Optional")
        OnboardingLink(Icons.Filled.Link, "Connect your browser", "Sync feeds and send articles with the AISH extension, end-to-end encrypted.") { onOpenSettings("link") }
        OnboardingLink(Icons.Filled.Person, "Sign in for Pro", "Your plan and the cloud AI, with an email code.") { onOpenSettings("account") }
        OnboardingLink(Icons.Filled.AutoAwesome, "Download the on-device AI", "Summaries, recaps and the morning briefing, written on this phone.") { onOpenSettings("ai") }

        TextButton(onClick = { model.finishOnboarding() }, Modifier.align(Alignment.CenterHorizontally)) { Text("Skip for now") }
    }
}

@Composable
private fun OnboardingLink(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, sub: String, onClick: () -> Unit) {
    SettingsCard {
        Row(Modifier.fillMaxWidth().clickableRow(onClick).padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            LeadingIcon(icon)
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleMedium)
                Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private fun Modifier.clickableRow(onClick: () -> Unit): Modifier = this.then(Modifier.clickable(onClick = onClick))
