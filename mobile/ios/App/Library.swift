import Foundation
import Observation
import os

/// The saved articles: saved from the feeds, shared to the app, handed over by the Safari extension or fetched by the sync.
/// They are stored in the extension's format (LibraryStore); a change shows at once and is written behind the screen, one
/// after the other.
@MainActor
@Observable
final class Library {
    private(set) var articles: [Article] = []
    /// False until the library has been read for the first time.
    private(set) var loaded = false
    /// Why the library could not be read or written.
    private(set) var failure: String?
    /// Sample articles are shown in memory only and never written.
    private let samples: Bool
    @ObservationIgnored let store: LibraryStore?
    /// The last piece of work: the next one waits for it.
    @ObservationIgnored private var tail: Task<Void, Never>?
    /// Notes and highlights as the store tells them.
    private(set) var stored: [NoteItem] = []
    /// The samples' notes, which live only as long as the app.
    private var sampleNotes: [NoteItem] = []
    private var sampleComments: [String: String] = [:]
    /// Files of Safari's hand-over that are being taken over.
    @ObservationIgnored private var taking: Set<URL> = []
    /// Counts the changes, so that a reading that started before one of them is repeated.
    @ObservationIgnored private var changes = 0
    private static let logger = Logger(subsystem: "eu.byphil.kaivo", category: "library")

    init(samples: Bool = LaunchOptions.samples, store: LibraryStore? = nil) {
        self.samples = samples
        #if DEBUG
        if samples {
            self.store = nil
            articles = SampleData.articles
            loaded = true
            return
        }
        #endif
        do {
            self.store = try store ?? LibraryStore.standard()
        } catch {
            self.store = nil
            failure = "\(error)"
            loaded = true
            return
        }
        then { store in try await store.convert() }
        // the list first, so that there is something to choose from while the texts are read
        then { [weak self] store in
            let list = try await store.listing()
            if let self, !self.loaded, self.changes == 0 { self.articles = list }
        }
        reload()
    }

    /// Everything asked for so far is done.
    func settled() async { await tail?.value }

    /// Reads the library again: after the sync brought something, or something was taken over.
    func reload() {
        then { [weak self] store in
            while let self {
                let before = self.changes
                let read = try await store.articles()
                let notes = try await store.stream()
                guard self.changes == before else { continue }
                if self.articles != read { self.articles = read }
                if self.stored != notes { self.stored = notes }
                self.loaded = true
                return
            }
        }
    }

    /// Reads the notes again, after one of them changed.
    private func reloadNotes() {
        then { [weak self] store in
            let notes = try await store.stream()
            if let self, self.stored != notes { self.stored = notes }
        }
    }

    /// Everything "Notes" lists: notes, highlights and the saved questions, newest first.
    var entries: [NoteItem] {
        let questions = articles.flatMap { article in
            (article.questions ?? []).filter { $0.noted == true }.map { question in
                NoteItem(kind: .question, id: question.id, text: question.question, when: question.date, answer: question.answer,
                         article: article.id, title: article.title)
            }
        }
        return ((store == nil ? sampleEntries : stored) + questions).sorted { ($1.when, $0.id) < ($0.when, $1.id) }
    }

    /// Without a store: the samples' marks, as the library would list them.
    private var sampleEntries: [NoteItem] {
        sampleNotes + articles.flatMap { article in
            article.passages.flatMap { passage in
                passage.marks.map { mark in
                    let id = mark.highlight ?? mark.id.uuidString
                    let comment = NoteItem.split(sampleComments[id] ?? "")
                    return NoteItem(kind: mark.ai ? .ghost : .user, id: id, text: passage.words(of: mark), tags: comment.tags,
                                    when: LibraryRecords.timestamp(article.savedAt), comment: comment.text, article: article.id, title: article.title)
                }
            }
        }
    }

    func addNote(_ text: String) {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        if store == nil {
            let parts = NoteItem.split(text)
            sampleNotes.insert(NoteItem(kind: .note, id: "sample-" + UUID().uuidString, text: parts.text, tags: parts.tags,
                                        when: LibraryRecords.timestamp(.now)), at: 0)
            return
        }
        changed { try await $0.note(text) }
        reloadNotes()
    }

    /// New words for a note, or a comment on a highlight (none take it away).
    func write(_ text: String, on item: NoteItem) {
        if item.kind == .note {
            guard !text.isEmpty else { return }
            if store == nil {
                let parts = NoteItem.split(text)
                if let i = sampleNotes.firstIndex(where: { $0.id == item.id }) { sampleNotes[i].text = parts.text; sampleNotes[i].tags = parts.tags }
                return
            }
            changed { try await $0.editNote(item.id, text: text) }
        } else {
            comment(item.id, text: text, url: item.url ?? "")
            return
        }
        reloadNotes()
    }

    /// The comment on a highlight.
    func comment(_ highlight: String, text: String, url: String) {
        if store == nil {
            sampleComments[highlight] = text
            return
        }
        changed { try await $0.comment(highlight, text: text, url: url) }
        reloadNotes()
    }

    /// The highlight behind a mark of an article, with its comment; made known to the library first where it is new.
    func entry(for mark: Mark.ID, in id: Article.ID) -> NoteItem? {
        guard let article = article(id),
              let passage = article.passages.first(where: { $0.marks.contains { $0.id == mark } }),
              let found = passage.marks.first(where: { $0.id == mark }) else { return nil }
        let highlight = found.highlight ?? found.id.uuidString
        if let listed = entries.first(where: { $0.isHighlight && $0.id == highlight }) { return listed }
        return NoteItem(kind: found.ai ? .ghost : .user, id: highlight, text: passage.words(of: found), when: "",
                        url: Self.address(of: article), article: id, title: article.title)
    }

    /// A suggestion of the AI becomes the reader's own.
    func keep(_ item: NoteItem) { resolve(item, keep: true) }

    /// A note goes, a highlight is removed, a suggestion is turned down.
    func delete(_ item: NoteItem) {
        if item.kind == .note {
            if store == nil { sampleNotes.removeAll { $0.id == item.id }; return }
            stored.removeAll { $0.id == item.id }
            changed { try await $0.removeNote(item.id) }
            reloadNotes()
        } else if item.isHighlight {
            resolve(item, keep: false)
        }
    }

    private func resolve(_ item: NoteItem, keep: Bool) {
        // the article on screen shows it at once
        for a in articles.indices {
            for p in articles[a].passages.indices {
                guard let m = articles[a].passages[p].marks.firstIndex(where: { ($0.highlight ?? $0.id.uuidString) == item.id }) else { continue }
                if keep { articles[a].passages[p].marks[m].ai = false } else { articles[a].passages[p].marks.remove(at: m) }
            }
        }
        guard store != nil else { return }
        if keep { if let i = stored.firstIndex(where: { $0.id == item.id }) { stored[i].kind = .user } }
        else { stored.removeAll { $0.id == item.id } }
        let url = item.url ?? ""
        changed { store in
            if keep { try await store.mark(url: url, keep: [item.id]) }
            else if item.kind == .ghost { try await store.mark(url: url, dismiss: [item.id]) }
            else { try await store.mark(url: url, remove: [item.id]) }
        }
        reloadNotes()
    }

    // MARK: - Questions about an article

    func askPrompt(_ id: Article.ID, question: String, turn: String? = nil, chars: Int, earlier: Int) async throws -> LibraryStore.Prompt {
        await settled()
        if let store { return try await store.askPrompt(id, question: question, turn: turn, chars: chars, earlier: earlier) }
        // the samples have no library behind them
        let text = article(id)?.passages.map(\.text).joined(separator: " ") ?? ""
        return LibraryStore.Prompt(system: "Answer questions about the text.", user: String(text.prefix(chars)) + "\n\n" + question, cut: text.count > chars)
    }

    /// A model's reply becomes the article's next question, or goes on from the short answer `turn`. → that question's id
    @discardableResult
    func answer(_ id: Article.ID, question: String, reply: String, turn: String? = nil) async throws -> String {
        guard let store else {
            guard let turn, let i = articles.firstIndex(where: { $0.id == id }),
                  let t = articles[i].questions?.firstIndex(where: { $0.id == turn }) else { return sample(id, question, reply) }
            articles[i].questions?[t].answer += " " + reply
            return turn
        }
        await settled()
        changes += 1
        let written = try await store.answer(id, question: question, reply: reply, turn: turn)
        reload()
        await settled()
        return written
    }

    /// A prepared question with its short answer: there at once, without a model. → its id, nil where none is ready
    func quickAnswer(_ id: Article.ID, question: String) async throws -> String? {
        guard let store else {
            guard let ready = article(id)?.openSuggestions.first(where: { $0.question == question })?.answer else { return nil }
            return sample(id, question, ready)
        }
        await settled()
        changes += 1
        let written = try await store.quick(id, question: question)
        reload()
        await settled()
        return written.isEmpty ? nil : written
    }

    private func sample(_ id: Article.ID, _ question: String, _ answer: String) -> String {
        let turn = Question(id: "sample-" + UUID().uuidString, question: question, answer: answer, date: LibraryRecords.timestamp(.now))
        if let i = articles.firstIndex(where: { $0.id == id }) { articles[i].questions = (articles[i].questions ?? []) + [turn] }
        return turn.id
    }

    /// Saved to the notes, or shown with the summary on the other devices.
    func setQuestion(_ id: Article.ID, turn: String, noted: Bool? = nil, pinned: Bool? = nil) {
        guard let a = articles.firstIndex(where: { $0.id == id }), let t = articles[a].questions?.firstIndex(where: { $0.id == turn }) else { return }
        if let noted { articles[a].questions?[t].noted = noted ? true : nil }
        if let pinned { articles[a].questions?[t].pinned = pinned ? true : nil }
        changed { try await $0.setQuestion(id, turn: turn, noted: noted, pinned: pinned) }
    }

    private func then(_ work: @escaping @MainActor (LibraryStore) async throws -> Void) {
        guard let store else { return }
        let previous = tail
        tail = Task { [weak self] in
            await previous?.value
            do {
                try await work(store)
            } catch {
                Self.logger.error("\(String(describing: error), privacy: .public)")
                self?.failure = "\(error)"
                self?.loaded = true
            }
        }
    }

    /// A change to what is shown, with what it means for the store.
    private func changed(_ work: @escaping @MainActor (LibraryStore) async throws -> Void) {
        changes += 1
        then(work)
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
        let article = Article(id: UUID().uuidString.lowercased(), title: item.title, host: URL(string: item.link)?.host() ?? feed.name,
                              tags: feed.tags, words: Self.words(in: text), savedAt: .now,
                              passages: paragraphs.map { Passage(kind: .text, text: $0) }, link: item.link)
        articles.insert(article, at: 0)
        changed { store in
            // saved again after it was removed: it comes back, with the id it had
            for id in try await store.add([article]) { try await store.hide(id, gone: false) }
        }
        reload()
    }

    /// Takes over what Safari saved since the last time. An article already saved here (same page) gains, it is not doubled.
    func importFromSafari(from folder: URL = SafariInbox.directory) {
        guard !samples else { return }
        // what is being taken over already is not taken a second time
        let waiting = SafariInbox.pending(in: folder).filter { !taking.contains($0.file) }
        guard !waiting.isEmpty else { return }
        taking.formUnion(waiting.map(\.file))
        changed { [weak self] store in
            defer { self?.taking.subtract(waiting.map(\.file)) }
            let removed = SafariInbox.removed
            let wanted = waiting.filter { !removed.contains($0.article.id) }
            let ids = try await store.take(wanted.map { SafariImport.package($0.article, pictures: folder) })
            for id in ids {
                var extra = try await store.extra(id)
                extra.safari = true
                try await store.setExtra(id, extra)
            }
            // the files go only after the library is on disk
            for item in waiting {
                // written again meanwhile: that version is still to be taken
                guard SafariInbox.read(item.file) == item.article else { continue }
                try? FileManager.default.removeItem(at: item.file)
                try? FileManager.default.removeItem(at: folder.appending(path: "images/\(item.article.id)"))
            }
        }
        reload()
    }

    func remove(_ id: Article.ID) {
        if let safariID = article(id)?.safariID, !samples {
            SafariInbox.markRemoved(safariID)
            try? FileManager.default.removeItem(at: SharedStore.directory.appending(path: "images/\(safariID)"))
        }
        articles.removeAll { $0.id == id }
        changed { try await $0.hide(id) }
    }

    /// Takes over what was shared to Kaivo: the article is there at once, its text follows (see `fill`).
    func takeShared(from folder: URL = SharedLinks.directory) async {
        guard !samples else { return }
        // what is here already must be known first
        await settled()
        let waiting = SharedLinks.waiting(in: folder)
        guard !waiting.isEmpty else { return }
        var new: [Article] = [], wanted: [(Article.ID, Pending)] = []
        for (_, shared) in waiting {
            if let i = articles.firstIndex(where: { $0.link == shared.url }) {
                // shared again: only a summary can be wanted that is not there yet
                if shared.summarize && articles[i].summary.isEmpty {
                    articles[i].pending = Pending(text: articles[i].passages.isEmpty, summary: true)
                    wanted.append((articles[i].id, Pending(text: articles[i].passages.isEmpty, summary: true)))
                }
                continue
            }
            let host = URL(string: shared.url)?.host() ?? shared.url
            let article = Article(id: UUID().uuidString.lowercased(), title: shared.title.isEmpty ? host : shared.title, host: host, tags: [], words: 0,
                                  savedAt: shared.date, link: shared.url, pending: Pending(text: true, summary: shared.summarize))
            articles.insert(article, at: 0)
            new.append(article)
        }
        articles.sort { $0.savedAt > $1.savedAt }
        changed { [weak self] store in
            for article in new {
                guard let id = try await store.add([article]).first else { continue }
                try await store.hide(id, gone: false)
                // the page was in the library under another id: the one on screen is replaced at the next reading
                if id != article.id { self?.reload() }
            }
            for (id, pending) in wanted {
                var extra = try await store.extra(id)
                extra.pending = pending
                try await store.setExtra(id, extra)
            }
            for (file, _) in waiting { try? FileManager.default.removeItem(at: file) }
        }
        await settled()
    }

    /// The text of a shared page has arrived.
    func fill(_ id: Article.ID, with page: ExtractedPage) {
        guard let i = articles.firstIndex(where: { $0.id == id }), articles[i].passages.isEmpty else { return }
        if !page.title.isEmpty { articles[i].title = page.title }
        articles[i].passages = page.passages
        articles[i].paper = page.paper
        articles[i].words = Self.words(in: page.passages.map(\.text).joined(separator: " "))
        articles[i].pending?.text = false
        let article = articles[i]
        changed { store in
            try await store.change(id, entry: ["title": article.title, "contentWordCount": article.words],
                                   record: ["content": LibraryRecords.html(article.passages)])
            var extra = try await store.extra(id)
            extra.paper = article.paper
            extra.pending = article.pending
            try await store.setExtra(id, extra)
        }
    }

    func nothingPending(_ id: Article.ID) {
        guard let i = articles.firstIndex(where: { $0.id == id }) else { return }
        articles[i].pending = nil
        changed { store in
            var extra = try await store.extra(id)
            extra.pending = nil
            try await store.setExtra(id, extra)
        }
    }

    /// A finished summary; the sentences the model copied become its suggested highlights.
    func setSummary(_ id: Article.ID, _ lines: [String], marking sentences: [String], onDevice: Bool = false, questions: String = "") {
        guard let i = articles.firstIndex(where: { $0.id == id }) else { return }
        articles[i].summary = lines
        articles[i].summaryHTML = LibraryRecords.summaryHTML(lines)
        articles[i].summaryOnDevice = onDevice ? true : nil
        articles[i].pending = nil
        for sentence in sentences { SafariImport.mark(sentence, ai: true, in: &articles[i].passages) }
        var added: [[String: Any]] = []
        for p in articles[i].passages.indices {
            for m in articles[i].passages[p].marks.indices where articles[i].passages[p].marks[m].highlight == nil {
                let highlight = LibraryRecords.newHighlightID()
                articles[i].passages[p].marks[m].highlight = highlight
                added.append(LibraryRecords.new(articles[i].passages[p].marks[m], in: articles[i].passages[p], id: highlight))
            }
        }
        let url = Self.address(of: articles[i])
        changed { store in
            try await store.change(id, record: ["summary": LibraryRecords.summaryHTML(lines)])
            try await store.mark(url: url, add: added)
            var extra = try await store.extra(id)
            extra.pending = nil
            extra.deviceSummary = onDevice ? LibraryRecords.summaryHTML(lines) : nil
            try await store.setExtra(id, extra)
            if !questions.isEmpty { try await store.setSuggestions(id, raw: questions) }
        }
        // the questions show once they are stored
        if !questions.isEmpty { reload() }
    }

    /// Reading only ever moves forward.
    func read(_ id: Article.ID, upTo progress: Double) {
        guard let i = articles.firstIndex(where: { $0.id == id }), min(1, progress) > articles[i].progress else { return }
        articles[i].progress = min(1, progress)
        changed { try await $0.change(id, entry: ["progress": min(1, progress)]) }
    }

    /// Changes the marks of one paragraph.
    func change(_ passage: Passage.ID, in id: Article.ID, _ change: (inout Passage) -> Void) {
        guard let a = articles.firstIndex(where: { $0.id == id }),
              let p = articles[a].passages.firstIndex(where: { $0.id == passage }) else { return }
        let before = articles[a].passages[p].marks
        change(&articles[a].passages[p])
        var added: [[String: Any]] = [], keep: [String] = [], dismiss: [String] = [], remove: [String] = []
        for old in before {
            guard let highlight = old.highlight else { continue }
            if let now = articles[a].passages[p].marks.first(where: { $0.id == old.id }) {
                if old.ai && !now.ai { keep.append(highlight) }
            } else if old.ai {
                dismiss.append(highlight)   // kept as turned down, so that it does not come back
            } else {
                remove.append(highlight)
            }
        }
        for m in articles[a].passages[p].marks.indices where !before.contains(where: { $0.id == articles[a].passages[p].marks[m].id }) {
            let highlight = LibraryRecords.newHighlightID()
            articles[a].passages[p].marks[m].highlight = highlight
            added.append(LibraryRecords.new(articles[a].passages[p].marks[m], in: articles[a].passages[p], id: highlight))
        }
        guard !(added.isEmpty && keep.isEmpty && dismiss.isEmpty && remove.isEmpty) else { return }
        let url = Self.address(of: articles[a])
        changed { try await $0.mark(url: url, add: added, keep: keep, dismiss: dismiss, remove: remove) }
        reloadNotes()
    }

    /// Where an article's highlights are filed: its address, or one of the app's own for an article without.
    private static func address(of article: Article) -> String { article.link.isEmpty ? LibraryRecords.address(without: article.id) : article.link }

    /// Words for the reading time; scripts written without spaces count two characters as a word.
    nonisolated static func words(in text: String) -> Int {
        let spaced = text.split(whereSeparator: \.isWhitespace).count
        let unspaced = text.unicodeScalars.filter { (0x3040...0x9FFF).contains($0.value) }.count
        return max(spaced, unspaced / 2)
    }
}
