package eu.byphil.aishcompanion

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/*
 * The pieces Settings is built from, shaped like the browser extension's settings: a small caption above each group, an outlined card
 * with calm rows (label and a muted hint on the left, the control on the right), emoji in front of labels, button groups for choices.
 */

/** A small uppercase caption above a group of cards ("Subscriptions · 12" in the extension). */
@Composable
fun SettingsCaption(text: String) {
    Text(text.uppercase(), style = MaterialTheme.typography.labelMedium, letterSpacing = 0.8.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 4.dp, top = 14.dp))
}

/** The outlined card of a settings group: thin outline, no fill, small radius. */
@Composable
fun SettingsCard(content: @Composable ColumnScope.() -> Unit) {
    Card(
        Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        content = content,
    )
}

/** A card with rows in it, padded the same way everywhere. */
@Composable
fun SettingsGroup(content: @Composable ColumnScope.() -> Unit) {
    SettingsCard { Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(14.dp), content = content) }
}

/** Label and hint on the left, a switch on the right. */
@Composable
fun ToggleRow(title: String, hint: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (hint.isNotEmpty()) Text(hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

/** Label on the left, the current choice as a drop-down button on the right (for longer lists). */
@Composable
fun SelectRow(title: String, current: String, options: List<Pair<String, String>>, onPick: (String) -> Unit) {
    val open = remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(title, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Box {
            OutlinedButton(onClick = { open.value = true }) { Text(current, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            DropdownMenu(expanded = open.value, onDismissRequest = { open.value = false }) {
                for ((value, label) in options) DropdownMenuItem(text = { Text(label) }, onClick = { onPick(value); open.value = false })
            }
        }
    }
}

/** Label above a button group (like Graph | List in the extension) for two to four short choices. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChoiceRow(title: String, hint: String, options: List<Pair<String, String>>, selected: String, onPick: (String) -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, style = MaterialTheme.typography.bodyLarge)
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            options.forEachIndexed { i, (value, label) ->
                SegmentedButton(selected = selected == value, onClick = { onPick(value) }, shape = SegmentedButtonDefaults.itemShape(i, options.size)) { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
        }
        if (hint.isNotEmpty()) Text(hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
