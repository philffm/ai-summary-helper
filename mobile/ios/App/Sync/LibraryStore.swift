import CryptoKit
import Foundation
import os

/// The one library of the app, on disk in the extension's format, with the sync that goes with it. Everything is written
/// through the extension's modules (js/appSync.js); reading goes straight to the database.
final class LibraryStore: @unchecked Sendable {
    let sync: LibrarySync
    /// Where pictures taken out of the text are kept, and where the app kept its library before.
    let shared: URL

    init(folder: URL, shared: URL = SharedStore.directory, vault: SyncVault, writeBack: Bool = false,
         network: URLSessionConfiguration = .ephemeral) throws {
        self.shared = shared
        sync = try LibrarySync(folder: folder, vault: vault, writeBack: writeBack, network: network)
    }

    /// The app's own. The database stays outside the shared container: only the app reads it, and the system ends an app
    /// that holds a lock on a shared file while it is suspended.
    static var folder: URL { URL.applicationSupportDirectory.appending(path: "kaivo-library", directoryHint: .isDirectory) }

    /// Writing back is not switched on for anyone yet: only a debug build asked to (`-KaivoWriteBack YES`) does it.
    static func standard() throws -> LibraryStore {
        try LibraryStore(folder: folder, vault: SyncVault(scope: "library"), writeBack: LaunchOptions.writeBack)
    }

    private var host: SyncHost { sync.host }

    // MARK: - The library the app kept before

    static let oldFile = "library.json", backupFile = "library.before-sync.json"
    private static let convertedKey = "app:converted"

    /// Takes over `library.json`. The file stays where it is, so that an earlier version of the app, installed again,
    /// finds its library; should that version change it, the changes are taken over at the next start. The first state of
    /// the file is also copied aside, and that copy is never replaced. If anything fails, it is tried again.
    func convert() async throws {
        _ = try await host.run("return sync.library.tidy();")
        let old = shared.appending(path: Self.oldFile)
        guard FileManager.default.fileExists(atPath: old.path) else { return }
        let data = try Data(contentsOf: old)
        let state = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        let key = Self.convertedKey
        let done = try await host.read { try $0.get([key])[key] }
        guard done != "\"\(state)\"" else { return }
        let articles = try JSONDecoder().decode([Article].self, from: data)
        let copy = shared.appending(path: Self.backupFile)
        if !FileManager.default.fileExists(atPath: copy.path) { try data.write(to: copy, options: .atomic) }
        try await add(articles.reversed(), onlyMissing: true)
        _ = try await host.run("await storage.set({ [input.key]: input.state });", input: ["key": key, "state": state])
    }

    /// Takes over articles made in the app, with what only the app knows about them; the id each one has now.
    /// `onlyMissing`: of an article that is here already, a text or summary is only filled in, never replaced.
    @discardableResult
    func add(_ articles: [Article], onlyMissing: Bool = false) async throws -> [String] {
        // an article from Safari keeps the id the extension knows it by: the same article, also on the other devices
        let ids = try await take(articles.map { article in
            var package = LibraryRecords.package(article, id: article.safariID, pictures: shared)
            if onlyMissing { package["fill"] = true }
            return package
        })
        for (article, id) in zip(articles, ids) {
            // what is noted about it already stays, where nothing new is said
            let before = try await extra(id)
            var after = before
            after.paper = article.paper ?? before.paper
            after.pending = article.pending ?? before.pending
            if article.safariID != nil { after.safari = true }
            if article.host != URL(string: article.link)?.host() { after.host = article.host }
            if after != before { try await setExtra(id, after) }
        }
        return ids
    }

    // MARK: - Reading

    private struct Marks: Decodable {
        let pages: [String: String]
        let same: [String: String]
        let highlights: [LibraryRecords.Highlight]
    }

    private static let extraPrefix = "app:article:", removedKey = "app:removed"

    /// An article as read before, and what it was made from: reading a text and taking it apart is what takes time.
    private struct Read {
        let entry: NSDictionary
        let versions: [Int64?]
        let highlights: [LibraryRecords.Highlight]
        let article: Article?
    }
    private let known = OSAllocatedUnfairLock(initialState: [String: Read]())

    /// One article's stored parts. `record` and `extra` are there only when something about the article is new.
    private struct Stored: @unchecked Sendable {
        let id: String
        let entry: [String: Any]
        let versions: [Int64?]
        var record: Data?
        var extra: Data?
        let highlights: [LibraryRecords.Highlight]
        /// The page it is of, for telling two copies apart.
        let page: String
        let before: Read?
    }

    private static func json(_ data: Data?) -> Any? { data.flatMap { try? JSONSerialization.jsonObject(with: $0, options: .fragmentsAllowed) } }

    /// The synced library under the extension's keys, and what is only on this device (js/appSync.js).
    private static let areas = ["", "local:"]

    private static func listed(_ storage: SyncStoring) throws -> [(area: String, entry: [String: Any])] {
        let stored = try storage.data(areas.map { $0 + "articles:index" } + [removedKey])
        let removed = Set(json(stored[removedKey]) as? [String] ?? [])
        return areas.flatMap { area in
            (json(stored[area + "articles:index"]) as? [[String: Any]] ?? []).compactMap { entry in
                guard let id = entry["id"] as? String, !removed.contains(id) else { return nil }
                return (area, entry)
            }
        }
    }

    /// The list alone, without texts and highlights: there at once, also for a large library.
    func listing() async throws -> [Article] {
        let pictures = shared
        let entries = try await host.read { try Self.listed($0) }
        return entries.compactMap { LibraryRecords.article(entry: $0.entry, record: [:], highlights: [], extra: nil, pictures: pictures) }
            .sorted { $0.savedAt > $1.savedAt }
    }

    /// The articles to show, the newest first. One page saved twice (here and on another device) appears once.
    func articles() async throws -> [Article] {
        let marks = try JSONDecoder().decode(Marks.self, from: try await host.run("return sync.library.marks();"))
        let before = known.withLockUnchecked { $0 }
        let stored = try await host.read { storage -> [Stored] in
            let byPage = Dictionary(grouping: marks.highlights, by: \.url)
            let entries = try Self.listed(storage)
            let keys = entries.map { area, entry in
                let id = entry["id"] as? String ?? ""
                return [area + "articles:rec:" + id, Self.extraPrefix + id]
            }
            let versions = try storage.versions(keys.flatMap { $0 })
            return try zip(entries, keys).map { found, keys in
                let entry = found.entry
                let id = entry["id"] as? String ?? ""
                var parts = Stored(id: id, entry: entry, versions: keys.map { versions[$0] }, highlights: byPage[marks.pages[id] ?? ""] ?? [],
                                   page: marks.same[id] ?? "", before: nil)
                if let old = before[id], old.versions == parts.versions, old.highlights == parts.highlights, old.entry == entry as NSDictionary {
                    return Stored(id: id, entry: entry, versions: parts.versions, highlights: parts.highlights, page: parts.page, before: old)
                }
                let data = try storage.data(keys)
                parts.record = data[keys[0]]
                parts.extra = data[keys[1]]
                return parts
            }
        }
        // taken apart beside the sync's queue, on every core
        let read = made(stored)
        var out: [Article] = [], seen: [String: Int] = [:]
        for (parts, article) in zip(stored, read) {
            guard let article else { continue }
            if !parts.page.isEmpty, let at = seen[parts.page] {
                // the copy with text wins, else the one saved first
                let other = out[at]
                if other.passages.isEmpty != article.passages.isEmpty ? other.passages.isEmpty : article.savedAt < other.savedAt { out[at] = article }
                continue
            }
            if !parts.page.isEmpty { seen[parts.page] = out.count }
            out.append(article)
        }
        return out.sorted { $0.savedAt > $1.savedAt }
    }

    private func made(_ stored: [Stored]) -> [Article?] {
        let pictures = shared
        let results = OSAllocatedUnfairLock(initialState: [Read?](repeating: nil, count: stored.count))
        DispatchQueue.concurrentPerform(iterations: stored.count) { number in
            let parts = stored[number]
            let read: Read
            if let old = parts.before {
                read = old
            } else {
                let fields = Self.json(parts.record) as? [String: Any] ?? [:]
                let extra = parts.extra.flatMap { try? JSONDecoder().decode(LibraryRecords.Extra.self, from: $0) }
                let article = LibraryRecords.article(entry: parts.entry, record: fields, highlights: parts.highlights, extra: extra, pictures: pictures)
                read = Read(entry: parts.entry as NSDictionary, versions: parts.versions, highlights: parts.highlights, article: article)
            }
            results.withLockUnchecked { $0[number] = read }
        }
        let all = results.withLockUnchecked { $0 }
        known.withLockUnchecked { known in
            known = Dictionary(zip(stored.map(\.id), all.compactMap { $0 }), uniquingKeysWith: { _, last in last })
        }
        return all.map { $0?.article }
    }

    // MARK: - Writing

    /// Takes packages over (see LibraryRecords.package); the id each one has now.
    @discardableResult
    func take(_ packages: [[String: Any]]) async throws -> [String] {
        guard !packages.isEmpty else { return [] }
        return try JSONDecoder().decode([String].self, from: try await host.run("return sync.library.take(input);", input: ["articles": packages]))
    }

    func change(_ id: String, entry: [String: Any] = [:], record: [String: Any]? = nil) async throws {
        var input: [String: Any] = ["id": id, "entry": entry]
        if let record { input["record"] = record }
        _ = try await host.run("return sync.library.change(input);", input: input)
    }

    func mark(url: String, add: [[String: Any]] = [], keep: [String] = [], dismiss: [String] = [], remove: [String] = []) async throws {
        _ = try await host.run("return sync.library.mark(input);",
                               input: ["url": url, "add": add, "keep": keep, "dismiss": dismiss, "remove": remove])
    }

    func extra(_ id: String) async throws -> LibraryRecords.Extra {
        let key = Self.extraPrefix + id
        let stored = try await host.read { try $0.get([key])[key] }
        return stored.flatMap { try? JSONDecoder().decode(LibraryRecords.Extra.self, from: Data($0.utf8)) } ?? LibraryRecords.Extra()
    }

    func setExtra(_ id: String, _ extra: LibraryRecords.Extra) async throws {
        let value = try JSONSerialization.jsonObject(with: JSONEncoder().encode(extra))
        _ = try await host.run("await storage.set({ [input.key]: input.value });", input: ["key": Self.extraPrefix + id, "value": value])
    }

    /// Gone from this device, or back again. (Deleting on every device comes with a later version.)
    /// Notes and highlights of the whole library, newest first.
    func stream() async throws -> [NoteItem] {
        try JSONDecoder().decode([NoteItem].self, from: try await host.run("return sync.library.stream();"))
    }

    func note(_ text: String, url: String = "", title: String = "") async throws {
        _ = try await host.run("return sync.library.note(input);", input: ["text": text, "url": url, "title": title])
    }

    func editNote(_ id: String, text: String) async throws {
        _ = try await host.run("return sync.library.editNote(input);", input: ["id": id, "text": text])
    }

    func removeNote(_ id: String) async throws {
        _ = try await host.run("return sync.library.removeNote(input);", input: ["id": id])
    }

    func comment(_ highlight: String, text: String, url: String) async throws {
        _ = try await host.run("return sync.library.comment(input);", input: ["highlightId": highlight, "text": text, "url": url])
    }

    /// What to ask a model for one question about an article.
    struct Prompt: Decodable, Equatable {
        var system: String
        var user: String
        /// Only the beginning of the article went along.
        var cut: Bool
    }

    /// `turn`: the short answer that is to be continued.
    func askPrompt(_ id: String, question: String, turn: String?, chars: Int, earlier: Int) async throws -> Prompt {
        try JSONDecoder().decode(Prompt.self, from: try await host.run("return sync.library.askPrompt(input);",
                                                                       input: ["id": id, "question": question, "turn": turn ?? "", "chars": chars, "earlier": earlier]))
    }

    /// The id of the question the reply went to.
    func answer(_ id: String, question: String, reply: String, turn: String?) async throws -> String {
        try JSONDecoder().decode(String.self, from: try await host.run("return sync.library.answer(input);",
                                                                       input: ["id": id, "question": question, "reply": reply, "turn": turn ?? ""]))
    }

    /// A prepared question with its short answer, without a model. "" where no answer is ready.
    func quick(_ id: String, question: String) async throws -> String {
        try JSONDecoder().decode(String.self, from: try await host.run("return sync.library.quick(input);", input: ["id": id, "question": question]))
    }

    func setSuggestions(_ id: String, raw: String) async throws {
        _ = try await host.run("return sync.library.setSuggestions(input);", input: ["id": id, "raw": raw])
    }

    func setQuestion(_ id: String, turn: String, noted: Bool? = nil, pinned: Bool? = nil) async throws {
        var input: [String: Any] = ["id": id, "turn": turn]
        if let noted { input["noted"] = noted }
        if let pinned { input["pinned"] = pinned }
        _ = try await host.run("return sync.library.setQuestion(input);", input: input)
    }

    func hide(_ id: String, gone: Bool = true) async throws {
        _ = try await host.run("return sync.library.hide(input);", input: ["id": id, "gone": gone])
    }
}
