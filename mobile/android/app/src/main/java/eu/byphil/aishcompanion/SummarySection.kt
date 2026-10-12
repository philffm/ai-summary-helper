package eu.byphil.aishcompanion

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** Settings card for what the on-device model writes: the language of summaries and recaps, and the AI key-passage highlights. */
@Composable
fun SummaryCard(model: AppModel) {
    val menu = remember { mutableStateOf(false) }
    Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Summaries on this phone", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(
                "Applies to page summaries from the web view and to the day recap in Feeds. Articles sent from the browser keep the language chosen in the extension.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Language", Modifier.weight(1f))
                androidx.compose.foundation.layout.Box {
                    OutlinedButton(onClick = { menu.value = true }) { Text(SummaryLangs.label(model.summaryLang)) }
                    DropdownMenu(expanded = menu.value, onDismissRequest = { menu.value = false }) {
                        for ((code, name) in SummaryLangs.ALL) DropdownMenuItem(text = { Text(name) }, onClick = { model.changeSummaryLang(code); menu.value = false })
                    }
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Mark key passages")
                    Text("The model picks the main sentences of a summarized page and highlights them faintly in the reading list, like the AI highlights in the browser. Takes a little extra time after each summary.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked = model.ghostMarks, onCheckedChange = { model.changeGhostMarks(it) })
            }
        }
    }
}
