package eu.byphil.aishcompanion

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue

/** Settings group for what the on-device model writes: the language of summaries and recaps, key-passage highlights, reading aloud. */
@Composable
fun SummaryCard(model: AppModel) {
    LaunchedEffect(Unit) { model.speakSummary = model.store.speakSummary }   // the web view's speaker button changes it too
    SettingsGroup {
        SelectRow("🌐 Language", SummaryLangs.label(model.summaryLang), SummaryLangs.ALL.map { it.first to it.second }) { model.changeSummaryLang(it) }
        ToggleRow("🖍 Mark key passages", "The model picks the main sentences of a summarized page and highlights them faintly in the reading list, like the AI highlights in the browser.", model.ghostMarks) { model.changeGhostMarks(it) }
        ToggleRow("🔊 Read summaries aloud", "Speaks the summary sentence by sentence while the model writes it.", model.speakSummary) { model.changeSpeakSummary(it) }
    }
}

/** Settings group for the Feeds list. */
@Composable
fun FeedsCard(model: AppModel) {
    SettingsGroup {
        ToggleRow("🧩 Group similar items", "Stacks items about the same story from several sources under one card.", model.groupSimilar) { model.changeGroupSimilar(it) }
    }
    SettingsCaption("Backup & restore")
    SettingsGroup {
        androidx.compose.material3.Text("Your feed list as an OPML file, the format every feed reader understands. Folders become tags. Items and favourites stay on this phone.", style = androidx.compose.material3.MaterialTheme.typography.bodySmall, color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant)
        OpmlButtons(model)
    }
}

/** Settings group for comfort: which hand holds the phone, and how large the reading text is. */
@Composable
fun AccessibilityCard(model: AppModel) {
    var scale by remember { mutableStateOf(model.store.readerScale) }
    SettingsGroup {
        ChoiceRow("🖐 Hand", "The main actions in bottom bars sit on this side, within reach of your thumb.", listOf("right" to "Right-handed", "left" to "Left-handed"), if (model.leftHanded) "left" else "right") { model.changeLeftHanded(it == "left") }
        ChoiceRow("🔠 Reading text size", "Applies to articles in the reading list.", listOf("0.9" to "Small", "1.0" to "Normal", "1.2" to "Large", "1.5" to "Huge"),
            listOf(0.9f, 1.0f, 1.2f, 1.5f).minByOrNull { kotlin.math.abs(it - scale) }.toString()) { scale = it.toFloat(); model.store.readerScale = scale }
    }
}
