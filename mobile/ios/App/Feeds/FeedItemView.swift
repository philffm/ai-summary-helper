import SwiftUI

/// One feed item as the feed carries it; the full page opens in Safari, where the extension can summarize it.
struct FeedItemView: View {
    let feedURL: String
    let itemID: String
    @Environment(FeedsModel.self) private var feeds
    @Environment(Library.self) private var library
    @Environment(Speaker.self) private var speaker

    var body: some View {
        Group {
            if let entry = feeds.entry(feed: feedURL, id: itemID) {
                content(entry)
                    .onAppear { feeds.setRead(entry, true) }
            } else {
                ContentUnavailableView("Article removed", systemImage: "trash")
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .readingFullScreen()
    }

    private func content(_ entry: FeedEntry) -> some View {
        let item = entry.stored.item
        let link = URL(string: item.link)
        let saved = library.contains(link: item.link)
        return ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text(verbatim: [entry.feed.name, item.published.map { Dates.relativeDay($0) }].compactMap { $0 }.joined(separator: " · "))
                    .font(.footnote).foregroundStyle(.secondary)
                Text(verbatim: item.title).font(.title.weight(.semibold)).fontDesign(.serif).accessibilityAddTraits(.isHeader)
                if let sound = item.audio.flatMap(URL.init(string:)) {
                    EpisodePlayer(id: entry.id, url: sound, title: item.title, show: entry.feed.name)
                }
                Text(verbatim: item.body.isEmpty ? item.summary : item.body).fontDesign(.serif).lineSpacing(4).textSelection(.enabled)
                if let link {
                    Link(destination: link) { Label("Read the full article in Safari", systemImage: "safari") }
                }
            }
            .frame(maxWidth: 640, alignment: .leading)
            .padding(20)
            .frame(maxWidth: .infinity)
        }
        .toolbar {
            if let link {
                ToolbarItem(placement: .topBarTrailing) { ShareLink(item: link, subject: Text(verbatim: item.title)) }
            }
            ToolbarItemGroup(placement: .bottomBar) {
                Button {
                    AudioPlayer.shared.pause()   // one voice at a time
                    speaker.toggle(entry.id, text: [item.title, item.body.isEmpty ? item.summary : item.body].joined(separator: ". "))
                } label: {
                    if speaker.current == entry.id {
                        Label("Stop", systemImage: "stop.fill")
                    } else {
                        Label("Listen", systemImage: "headphones")
                    }
                }
                Spacer()
                Button { library.save(item, from: entry.feed) } label: {
                    if saved {
                        Label("Saved", systemImage: "bookmark.fill")
                    } else {
                        Label("Save to library", systemImage: "bookmark")
                    }
                }
                .disabled(saved)
            }
        }
    }
}
