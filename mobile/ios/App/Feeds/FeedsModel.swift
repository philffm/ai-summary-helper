import Foundation
import Observation
import WidgetKit

struct FeedEntry: Identifiable, Hashable {
    var feed: Feed
    var stored: StoredItem
    var id: String { feed.url + "\n" + stored.item.id }
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

    /// Subscribes after a successful download, so a wrong address never ends up in the list.
    func add(_ input: String, title: String = "", tags: [String] = []) async throws {
        guard let url = FeedFetcher.normalize(input) else { throw FeedFetcher.Failure.address }
        let result = try await FeedFetcher.fetch(url, discovering: true)
        let address = result.url.absoluteString
        let feed = Feed(url: address, title: title.isEmpty ? (result.parsed?.title ?? "") : title, tags: tags, updatedAt: Self.now)
        if let i = all.firstIndex(where: { $0.url == address }) { all[i] = feed } else { all.append(feed) }
        apply(result, to: address)
        save()
    }

    func remove(_ url: String) {
        guard let i = all.firstIndex(where: { $0.url == url }) else { return }
        all[i].removed = true
        all[i].updatedAt = Self.now
        states[url] = nil
        save()
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

    /// New items first; read marks stay; items that left the feed are kept for two weeks.
    private func apply(_ result: FeedFetcher.Result, to url: String) {
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
            items += state.items.filter { !seen.contains($0.item.id) && ($0.item.published ?? .distantPast) > cutoff }
                .map { var old = $0; old.item.body = ""; return old }
            state.items = Array(items.prefix(Self.maxStored))
        }
        states[url] = state
    }

    private func save() {
        guard !samples else { return }
        SharedStore.write(Vault(feeds: all), to: Self.listFile)
        SharedStore.write(states, to: Self.stateFile)
    }

    private static var now: Int64 { Int64(Date.now.timeIntervalSince1970 * 1000) }
}
