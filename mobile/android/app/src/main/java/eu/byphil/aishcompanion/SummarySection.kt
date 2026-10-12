package eu.byphil.aishcompanion

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect

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
}
