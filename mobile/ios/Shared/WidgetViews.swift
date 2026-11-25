import SwiftUI
import WidgetKit

/// The widgets' views, shared with the app so that a debug screen can show them (the simulator cannot place widgets by script).
struct BriefingWidgetView: View {
    let snapshot: Snapshot
    let family: WidgetFamily

    var body: some View {
        if let first = snapshot.headlines.first {
            switch family {
            case .accessoryRectangular:
                VStack(alignment: .leading, spacing: 1) {
                    Text(verbatim: "Kaivo").font(.caption2.weight(.bold))
                    Text(verbatim: first.title).font(.caption).lineLimit(2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .widgetURL(first.link)
            case .systemSmall:
                VStack(alignment: .leading, spacing: 6) {
                    kicker("Briefing")
                    Text(verbatim: first.title).font(.subheadline.weight(.medium)).fontDesign(.serif).lineLimit(4)
                    Spacer(minLength: 0)
                    Text(verbatim: first.source).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .widgetURL(first.link)
            default:
                VStack(alignment: .leading, spacing: 6) {
                    kicker("Briefing")
                    ForEach(snapshot.headlines.prefix(family == .systemLarge ? 5 : 2)) { headline in
                        Link(destination: headline.link) {
                            VStack(alignment: .leading, spacing: 1) {
                                // a link would otherwise colour its text with the tint and centre a second line
                                Text(verbatim: headline.title).font(.subheadline.weight(.medium)).fontDesign(.serif).foregroundStyle(Color.primary).lineLimit(2)
                                Text(verbatim: headline.source).font(.caption2).foregroundStyle(Color.secondary).lineLimit(1)
                            }
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            EmptyWidgetView(text: "Add a feed in Kaivo.")
        }
    }
}

struct QuoteWidgetView: View {
    let snapshot: Snapshot

    var body: some View {
        if let quote = snapshot.quote {
            VStack(alignment: .leading, spacing: 8) {
                Text(verbatim: "“\(quote.text)”").font(.subheadline).fontDesign(.serif).italic().minimumScaleFactor(0.8)
                Spacer(minLength: 0)
                Text(verbatim: quote.source).font(.caption2).lineLimit(1)
            }
            .foregroundStyle(KaivoTokens.savedNoteUserFg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .widgetURL(quote.link)
        } else {
            EmptyWidgetView(text: "Your highlights show up here.")
        }
    }
}

struct ReadingWidgetView: View {
    let snapshot: Snapshot

    var body: some View {
        if let reading = snapshot.reading {
            VStack(alignment: .leading, spacing: 6) {
                kicker("Continue reading")
                Text(verbatim: reading.title).font(.subheadline.weight(.medium)).fontDesign(.serif).lineLimit(3)
                Spacer(minLength: 0)
                ProgressView(value: reading.progress).tint(KaivoTokens.accent)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .widgetURL(reading.link)
        } else {
            EmptyWidgetView(text: "Nothing started.")
        }
    }
}

struct EmptyWidgetView: View {
    let text: LocalizedStringKey
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(verbatim: "Kaivo").font(.caption.weight(.bold)).foregroundStyle(KaivoTokens.accent)
            Text(text).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(DeepLink.today.url)
    }
}

private func kicker(_ text: LocalizedStringKey) -> some View {
    Text(text).font(.caption.weight(.bold)).foregroundStyle(KaivoTokens.accent).lineLimit(1)
}
