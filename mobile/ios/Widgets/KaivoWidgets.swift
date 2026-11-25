import SwiftUI
import WidgetKit

@main
struct KaivoWidgets: WidgetBundle {
    var body: some Widget {
        BriefingWidget()
        QuoteWidget()
        ReadingWidget()
    }
}

struct SnapshotEntry: TimelineEntry {
    var date: Date
    var snapshot: Snapshot
}

/// One entry from the file the app wrote; the app reloads the timelines when it changes.
struct SnapshotProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry { SnapshotEntry(date: .now, snapshot: Snapshot()) }
    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        completion(SnapshotEntry(date: .now, snapshot: Snapshot.load()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        completion(Timeline(entries: [SnapshotEntry(date: .now, snapshot: Snapshot.load())], policy: .never))
    }
}

struct BriefingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "briefing", provider: SnapshotProvider()) { entry in
            BriefingEntryView(snapshot: entry.snapshot)
        }
        .configurationDisplayName("Briefing")
        .description("The newest articles from your feeds.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular])
    }
}

private struct BriefingEntryView: View {
    @Environment(\.widgetFamily) private var family
    let snapshot: Snapshot
    var body: some View {
        BriefingWidgetView(snapshot: snapshot, family: family).containerBackground(.background, for: .widget)
    }
}

struct QuoteWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "quote", provider: SnapshotProvider()) { entry in
            QuoteWidgetView(snapshot: entry.snapshot)
                .containerBackground(for: .widget) { entry.snapshot.quote == nil ? Color(.systemBackground) : KaivoTokens.savedNoteUserBg }
        }
        .configurationDisplayName("Worth remembering")
        .description("One of your highlights.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct ReadingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "reading", provider: SnapshotProvider()) { entry in
            ReadingWidgetView(snapshot: entry.snapshot).containerBackground(.background, for: .widget)
        }
        .configurationDisplayName("Continue reading")
        .description("The article you have started.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
