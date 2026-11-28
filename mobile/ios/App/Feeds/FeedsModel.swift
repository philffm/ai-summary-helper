import Foundation
import Observation
import WidgetKit

extension Feed {
    func has(category: String) -> Bool { tags.contains { $0.caseInsensitiveCompare(category) == .orderedSame } }
}

struct FeedEntry: Identifiable, Hashable {
    var feed: Feed
    var stored: StoredItem
    var id: String { feed.url + "\n" + stored.item.id }
    /// It comes with something to listen to.
    var isPodcast: Bool { stored.item.audio?.isEmpty == false }
}

/// What the list of "Feeds" shows.
enum FeedFilter: CaseIterable {
    case all, unread, podcasts

    func shows(_ entry: FeedEntry) -> Bool {
        switch self {
        case .all: true
        case .unread: !entry.stored.read
        case .podcasts: entry.isPodcast
        }
    }
}

struct SuggestedFeed: Decodable, Identifiable, Hashable {
    var name: String
    var url: String
    var tags: [String]?
    var note: String?
    var id: String { url }
}

/// The subscriptions and their items. The list is `feeds.json` in the sync format; items are this device's own.
@MainActor
@Observable
final class FeedsModel {
    private static let listFile = "feeds.json"
    private static let stateFile = "feed-items.json"
    private static let maxStored = 400
    private static let keep: TimeInterval = 14 * 24 * 3600

    private struct Vault: Codable { var v = 1; var feeds: [Feed] }

    private var all: [Feed] = []
    /// Told when a feed was added or removed here, so that the library can have it.
    @ObservationIgnored var changed: (() -> Void)?
    /// The list as the library takes it, removed feeds included; the made-up one of a debug start never leaves.
    var forLibrary: [Feed] { samples ? [] : all }
    /// Entries that stay however old they get: the loaded episodes.
    @ObservationIgnored var keeps: (String) -> Bool = { PodcastStore.shared.keeps($0) }
    private(set) var states: [String: FeedState] = [:]
    private(set) var refreshing = false
    /// Sample feeds are shown in memory only and never written.
    private let samples: Bool

    init(samples: Bool = LaunchOptions.samples) {
        self.samples = samples
        #if DEBUG
        if samples { (all, states) = SampleData.feeds; return }
        #endif
        all = SharedStore.read(Vault.self, from: Self.listFile)?.feeds ?? []
        states = SharedStore.read([String: FeedState].self, from: Self.stateFile) ?? [:]
    }

    var feeds: [Feed] { all.filter { !$0.removed }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending } }

    /// Every item of every feed, newest first.
    var entries: [FeedEntry] {
        feeds.flatMap { feed in (states[feed.url]?.items ?? []).map { FeedEntry(feed: feed, stored: $0) } }
            .sorted { ($0.stored.item.published ?? .distantPast) > ($1.stored.item.published ?? .distantPast) }
    }

    /// The categories of the feeds that are subscribed to: their tags, each once, in the order of the alphabet (as the
    /// extension lists them).
    var categories: [String] {
        var seen: [String: String] = [:]
        for feed in feeds { for tag in feed.tags where seen[tag.lowercased()] == nil { seen[tag.lowercased()] = tag } }
        return seen.values.sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }

    /// What "Today" reads aloud: the newest unread titles and where they come from.
    var briefingText: String {
        newest.prefix(3).map { String(localized: "\($0.stored.item.title). From \($0.feed.name).") }.joined(separator: " ")
    }

    var newest: [FeedEntry] { Array(entries.filter { !$0.stored.read }.prefix(5)) }

    func entry(feed url: String, id: String) -> FeedEntry? {
        guard let feed = feeds.first(where: { $0.url == url }), let stored = states[url]?.items.first(where: { $0.item.id == id }) else { return nil }
        return FeedEntry(feed: feed, stored: stored)
    }

    var suggestions: [SuggestedFeed] {
        struct File: Decodable { var feeds: [SuggestedFeed] }
        guard let url = Bundle.main.url(forResource: "suggested-feeds", withExtension: "json"),
              let data = try? Data(contentsOf: url), let file = try? JSONDecoder().decode(File.self, from: data) else { return [] }
        return file.feeds.filter { s in s.url.hasPrefix("https://") && !feeds.contains { $0.url == s.url } }
    }

    /// Takes over the feeds Safari subscribes to: new ones are added, one removed here stays removed.
    func importFromSafari() {
        let waiting = SafariInbox.pendingFeeds
        guard !samples, !waiting.isEmpty else { return }
        let before = all.count
        take(waiting)
        save()
        SafariInbox.clearFeeds()
        if all.count != before { changed?() }
    }

    /// The categories are the extension's: where it names some for a feed that is here, they are taken.
    func take(_ handed: [InboxFeed]) {
        for feed in handed {
            if let i = all.firstIndex(where: { $0.url == feed.url }) {
                guard !all[i].removed, !feed.tags.isEmpty, all[i].tags != feed.tags else { continue }
                all[i].tags = feed.tags
                all[i].updatedAt = Self.now
            } else {
                all.append(Feed(url: feed.url, title: feed.title, tags: feed.tags, updatedAt: Self.now))
            }
        }
    }

    /// The feed list of the library, joined with the one here: for each address the newer entry counts, so what was
    /// removed on the computer goes here too, and what was removed here stays away until it is added again. Many removals
    /// at once (more than 10 and a quarter of the feeds) are not carried out.
    func take(library handed: [LibrarySync.FeedEntry]) {
        let live = all.filter { !$0.removed }.count
        let gone = handed.filter { entry in entry.removed == true && all.contains { $0.url == entry.url && !$0.removed && $0.updatedAt <= entry.updatedAt } }
        let held = gone.count > max(10, (live + 3) / 4)
        var differs = false
        for entry in handed {
            guard let url = URL(string: entry.url), ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { continue }
            let removed = entry.removed == true
            if let i = all.firstIndex(where: { $0.url == entry.url }) {
                let here = all[i]
                // on a tie a removal wins, as everywhere
                guard entry.updatedAt > here.updatedAt || (entry.updatedAt == here.updatedAt && removed && !here.removed) else { continue }
                if removed {
                    guard !held, !here.removed else { continue }
                    all[i].removed = true
                    states[entry.url] = nil
                } else {
                    all[i].removed = false
                    if let title = entry.title, !title.isEmpty { all[i].title = title }
                    all[i].tags = entry.tags ?? []
                }
                all[i].updatedAt = entry.updatedAt
                differs = true
            } else {
                // a removal of a feed that was never here is kept too: Safari must not bring it back
                all.append(Feed(url: entry.url, title: entry.title ?? "", tags: entry.tags ?? [], updatedAt: entry.updatedAt, removed: removed))
                differs = true
            }
        }
        guard differs else { return }
        save()
        Task { await refresh() }
    }

    /// Subscribes after a successful download, so a wrong address never ends up in the list.
    func add(_ input: String, title: String = "", tags: [String] = []) async throws {
        guard let url = FeedFetcher.normalize(input) else { throw FeedFetcher.Failure.address }
        let result = try await FeedFetcher.fetch(url, discovering: true)
        let address = result.url.absoluteString
        let feed = Feed(url: address, title: title.isEmpty ? (result.parsed?.title ?? "") : title, tags: tags, updatedAt: Self.now)
        if let i = all.firstIndex(where: { $0.url == address }) { all[i] = feed } else { all.append(feed) }
        apply(result, to: address)
        save()
        changed?()
    }

    func remove(_ url: String) {
        guard let i = all.firstIndex(where: { $0.url == url }) else { return }
        all[i].removed = true
        all[i].updatedAt = Self.now
        states[url] = nil
        save()
        changed?()
    }

    func setRead(_ entry: FeedEntry, _ read: Bool) {
        guard let i = states[entry.feed.url]?.items.firstIndex(where: { $0.item.id == entry.stored.item.id }),
              states[entry.feed.url]?.items[i].read != read else { return }
        states[entry.feed.url]?.items[i].read = read
        save()
    }

    /// Fetches every feed, four at a time. `ifOlderThan` skips feeds fetched recently.
    func refresh(ifOlderThan age: TimeInterval = 0) async {
        guard !samples, !refreshing else { return }
        let due = feeds.filter { feed in states[feed.url]?.lastFetched.map { Date.now.timeIntervalSince($0) >= age } ?? true }
        guard !due.isEmpty else { return }
        refreshing = true
        defer { refreshing = false }
        // what each download needs is read here, on the main actor; the tasks only use the network
        let jobs = due.compactMap { feed -> (address: String, url: URL, etag: String, modified: String)? in
            guard let url = URL(string: feed.url) else { return nil }
            return (feed.url, url, states[feed.url]?.etag ?? "", states[feed.url]?.modified ?? "")
        }
        for start in stride(from: 0, to: jobs.count, by: 4) {
            await withTaskGroup(of: (String, FeedFetcher.Result?).self) { group in
                for job in jobs[start..<min(start + 4, jobs.count)] {
                    group.addTask { (job.address, try? await FeedFetcher.fetch(job.url, etag: job.etag, modified: job.modified)) }
                }
                for await (address, result) in group {
                    if all.contains(where: { $0.url == address && !$0.removed }) {
                        if let result { apply(result, to: address) } else { states[address, default: FeedState()].failed = true }
                    }
                }
            }
        }
        save()
    }

    /// New items first; read marks stay; items that left the feed are kept for two weeks, loaded episodes for as long
    /// as they are loaded.
    func apply(_ result: FeedFetcher.Result, to url: String) {
        var state = states[url] ?? FeedState()
        state.failed = false
        state.lastFetched = .now
        state.etag = result.etag
        state.modified = result.modified
        if let parsed = result.parsed {
            let known = Dictionary(state.items.map { ($0.item.id, $0) }, uniquingKeysWith: { a, _ in a })
            var seen = Set<String>()
            var items = parsed.items.filter { seen.insert($0.id).inserted }.map { item -> StoredItem in
                var fresh = item
                if fresh.published == nil { fresh.published = known[item.id]?.item.published ?? .now }
                return StoredItem(item: fresh, read: known[item.id]?.read ?? false)
            }
            let cutoff = Date.now.addingTimeInterval(-Self.keep)
            let kept = { (item: StoredItem) in self.keeps(url + "\n" + item.item.id) }
            items += state.items.filter { !seen.contains($0.item.id) && (($0.item.published ?? .distantPast) > cutoff || kept($0)) }
                .map { var old = $0; if !kept($0) { old.item.body = "" }; return old }
            state.items = Array(items.prefix(Self.maxStored)) + items.dropFirst(Self.maxStored).filter(kept)
        }
        states[url] = state
    }

    private func save() {
        guard !samples else { return }
        SharedStore.write(Vault(feeds: all), to: Self.listFile)
        SharedStore.write(states, to: Self.stateFile)
    }

    #if DEBUG
    static func seed(_ feeds: [Feed], _ states: [String: FeedState]) {
        SharedStore.write(Vault(feeds: feeds), to: listFile)
        SharedStore.write(states, to: stateFile)
    }
    #endif

    private static var now: Int64 { Int64(Date.now.timeIntervalSince1970 * 1000) }
}
