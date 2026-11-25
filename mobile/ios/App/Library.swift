import Foundation
import Observation

/// The saved articles, in `library.json` in the shared folder: saved from the feeds, or handed over by the Safari extension.
@MainActor
@Observable
final class Library {
    private static let file = "library.json"

    private(set) var articles: [Article]
    /// Sample articles are shown in memory only and never written.
    private let samples: Bool

    init(samples: Bool = LaunchOptions.samples) {
        self.samples = samples
        #if DEBUG
        if samples { articles = SampleData.articles; return }
        #endif
        articles = SharedStore.read([Article].self, from: Self.file) ?? []
    }

    func article(_ id: Article.ID) -> Article? { articles.first { $0.id == id } }
    func contains(link: String) -> Bool { !link.isEmpty && articles.contains { $0.link == link } }

    /// The most used tags first; ties in alphabetical order.
    var topics: [TopicBubbles.Topic] {
        let counts = Dictionary(articles.flatMap(\.tags).map { ($0, 1) }, uniquingKeysWith: +)
        return counts.sorted { ($1.value, $0.key) < ($0.value, $1.key) }.map { TopicBubbles.Topic(name: $0.key, count: $0.value) }
    }

    func save(_ item: FeedItem, from feed: Feed) {
        guard !contains(link: item.link) else { return }
        let text = item.body.isEmpty ? item.summary : item.body
        let paragraphs = text.components(separatedBy: "\n\n").filter { !$0.isEmpty }
        articles.insert(Article(id: UUID().uuidString, title: item.title, host: URL(string: item.link)?.host() ?? feed.name,
                                tags: feed.tags, words: Self.words(in: text), savedAt: .now,
                                passages: paragraphs.map { Passage(kind: .text, text: $0) }, link: item.link), at: 0)
        write()
    }

    /// Takes over what Safari saved since the last time. An article already saved here (same link) is updated, not doubled.
    func importFromSafari() {
        guard !samples else { return }
        let waiting = SafariInbox.pending()
        guard !waiting.isEmpty else { return }
        let removed = SafariInbox.removed
        for item in waiting where !removed.contains(item.article.id) {
            let index = articles.firstIndex { $0.safariID == item.article.id || (!$0.link.isEmpty && $0.link == item.article.url) }
            let article = SafariImport.article(item.article, existing: index.map { articles[$0] })
            if let index { articles[index] = article } else { articles.append(article) }
            moveImages(of: item.article.id)
        }
        articles.sort { $0.savedAt > $1.savedAt }
        // the files go only after the library is on disk
        write()
        for item in waiting { try? FileManager.default.removeItem(at: item.file) }
    }

    /// The pictures leave the hand-over folder for the library's own.
    private func moveImages(of safariID: String) {
        let files = FileManager.default, from = SafariInbox.images(of: safariID)
        guard files.fileExists(atPath: from.path) else { return }
        let to = SharedStore.directory.appending(path: "images/\(safariID)")
        try? files.createDirectory(at: to.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? files.removeItem(at: to)
        try? files.moveItem(at: from, to: to)
    }

    func remove(_ id: Article.ID) {
        if let safariID = article(id)?.safariID, !samples {
            SafariInbox.markRemoved(safariID)
            try? FileManager.default.removeItem(at: SharedStore.directory.appending(path: "images/\(safariID)"))
        }
        articles.removeAll { $0.id == id }
        write()
    }

    /// Reading only ever moves forward.
    func read(_ id: Article.ID, upTo progress: Double) {
        guard let i = articles.firstIndex(where: { $0.id == id }), progress > articles[i].progress else { return }
        articles[i].progress = min(1, progress)
        write()
    }

    /// Changes the marks of one paragraph.
    func change(_ passage: Passage.ID, in id: Article.ID, _ change: (inout Passage) -> Void) {
        guard let a = articles.firstIndex(where: { $0.id == id }),
              let p = articles[a].passages.firstIndex(where: { $0.id == passage }) else { return }
        change(&articles[a].passages[p])
        write()
    }

    private func write() {
        if !samples { SharedStore.write(articles, to: Self.file) }
    }

    /// Words for the reading time; scripts written without spaces count two characters as a word.
    nonisolated static func words(in text: String) -> Int {
        let spaced = text.split(whereSeparator: \.isWhitespace).count
        let unspaced = text.unicodeScalars.filter { (0x3040...0x9FFF).contains($0.value) }.count
        return max(spaced, unspaced / 2)
    }
}
