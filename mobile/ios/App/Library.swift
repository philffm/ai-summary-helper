import Foundation
import Observation

/// The saved articles, in `library.json` in the shared folder: saved from the feeds, or handed over by the Safari extension.
@MainActor
@Observable
final class Library {
    nonisolated private static let file = "library.json"
    /// One queue for the file, so an older state never lands after a newer one.
    nonisolated private static let disk = DispatchQueue(label: "kaivo.library", qos: .utility)

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
    var topics: [TopicBubbles.Topic] { Self.ranked(articles.flatMap(\.tags)) }

    /// The topics that come together with all of `chosen`, counted in articles, the most shared first.
    nonisolated static func related(_ articles: [Article], to chosen: [String]) -> [TopicBubbles.Topic] {
        ranked(articles.filter { article in chosen.allSatisfy(article.tags.contains) }
            .flatMap { Set($0.tags).subtracting(chosen) })
    }

    /// Topics that share no article with `chosen`, but one with a topic of the `ring` around it; each with the connected
    /// topic that leads to it most often.
    nonisolated static func beyond(_ articles: [Article], from chosen: [String], through ring: [TopicBubbles.Topic], most: Int) -> [Beyond] {
        let near = Set(related(articles, to: chosen).map(\.name)).union(chosen)
        var best: [String: Beyond] = [:]
        // the ring comes ranked, so of two equally strong ways the first stays
        for bridge in ring {
            for topic in related(articles, to: [bridge.name]) where !near.contains(topic.name) && topic.count > (best[topic.name]?.topic.count ?? 0) {
                best[topic.name] = Beyond(topic: topic, via: bridge.name)
            }
        }
        return Array(best.values.sorted { ($1.topic.count, $0.topic.name) < ($0.topic.count, $1.topic.name) }.prefix(most))
    }

    nonisolated private static func ranked(_ tags: [String]) -> [TopicBubbles.Topic] {
        let counts = Dictionary(tags.map { ($0, 1) }, uniquingKeysWith: +)
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
        writeAndWait()
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

    /// Takes over what was shared to Kaivo: the article is there at once, its text follows (see `fill`).
    func takeShared(from folder: URL = SharedLinks.directory) {
        guard !samples else { return }
        let waiting = SharedLinks.waiting(in: folder)
        guard !waiting.isEmpty else { return }
        for (_, shared) in waiting {
            if let i = articles.firstIndex(where: { $0.link == shared.url }) {
                // shared again: only a summary can be wanted that is not there yet
                if shared.summarize && articles[i].summary.isEmpty { articles[i].pending = Pending(text: articles[i].passages.isEmpty, summary: true) }
                continue
            }
            let host = URL(string: shared.url)?.host() ?? shared.url
            articles.insert(Article(id: UUID().uuidString, title: shared.title.isEmpty ? host : shared.title, host: host, tags: [], words: 0,
                                    savedAt: shared.date, link: shared.url, pending: Pending(text: true, summary: shared.summarize)), at: 0)
        }
        articles.sort { $0.savedAt > $1.savedAt }
        writeAndWait()
        for (file, _) in waiting { try? FileManager.default.removeItem(at: file) }
    }

    /// The text of a shared page has arrived.
    func fill(_ id: Article.ID, with page: ExtractedPage) {
        guard let i = articles.firstIndex(where: { $0.id == id }), articles[i].passages.isEmpty else { return }
        if !page.title.isEmpty { articles[i].title = page.title }
        articles[i].passages = page.passages
        articles[i].paper = page.paper
        articles[i].words = Self.words(in: page.passages.map(\.text).joined(separator: " "))
        articles[i].pending?.text = false
        write()
    }

    func nothingPending(_ id: Article.ID) {
        guard let i = articles.firstIndex(where: { $0.id == id }) else { return }
        articles[i].pending = nil
        write()
    }

    /// A finished summary; the sentences the model copied become its suggested highlights.
    func setSummary(_ id: Article.ID, _ lines: [String], marking sentences: [String]) {
        guard let i = articles.firstIndex(where: { $0.id == id }) else { return }
        articles[i].summary = lines
        articles[i].pending = nil
        for sentence in sentences { SafariImport.mark(sentence, ai: true, in: &articles[i].passages) }
        write()
    }

    /// Reading only ever moves forward.
    func read(_ id: Article.ID, upTo progress: Double) {
        guard let i = articles.firstIndex(where: { $0.id == id }), min(1, progress) > articles[i].progress else { return }
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

    /// Saving takes long with a large library, so it happens beside the screen.
    private func write() {
        guard !samples else { return }
        let snapshot = articles
        Self.disk.async { SharedStore.write(snapshot, to: Self.file) }
    }

    /// Saved before this returns, after everything that was still waiting.
    private func writeAndWait() {
        if !samples { Self.disk.sync { SharedStore.write(articles, to: Self.file) } }
    }

    /// Words for the reading time; scripts written without spaces count two characters as a word.
    nonisolated static func words(in text: String) -> Int {
        let spaced = text.split(whereSeparator: \.isWhitespace).count
        let unspaced = text.unicodeScalars.filter { (0x3040...0x9FFF).contains($0.value) }.count
        return max(spaced, unspaced / 2)
    }
}
