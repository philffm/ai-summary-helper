import XCTest
@testable import Kaivo

/// Episodes kept on the device: loading them, how far they were heard, and that they stay.
@MainActor
final class PodcastTests: XCTestCase {
    private final class Fake: EpisodeDownloader {
        var events: ((DownloadEvent) -> Void)?
        var offWifi: ((Bool) -> Void)?
        var started: [(id: String, mobile: Bool)] = []
        var cancelled: [String] = []
        var going: [String] = []
        func begin() {}
        func start(_ id: String, url: URL, mobile: Bool) { started.append((id, mobile)); going.append(id) }
        func cancel(_ id: String) { cancelled.append(id); going.removeAll { $0 == id } }
        func running() async -> [String] { going }
    }

    private var folder = URL.temporaryDirectory
    private var settings = UserDefaults.standard
    private var fake = Fake()
    private let sound = URL(string: "https://example.org/episode.mp3")!

    override func setUp() async throws {
        folder = FileManager.default.temporaryDirectory.appending(path: "podcasts-" + UUID().uuidString)
        settings = UserDefaults(suiteName: "podcasts-" + UUID().uuidString)!
        fake = Fake()
    }

    override func tearDown() async throws { try? FileManager.default.removeItem(at: folder) }

    private func store() -> PodcastStore { PodcastStore(folder: folder, downloader: fake, settings: settings) }

    /// The download of `id` arrives, as the system hands it over.
    private func arrive(_ id: String, bytes: Int = 1000) throws {
        let name = PodcastStore.fileName(id, url: sound, mime: nil)
        try Data(count: bytes).write(to: folder.appending(path: name))
        fake.going.removeAll { $0 == id }
        fake.events?(.finished(id, name: name, bytes: Int64(bytes)))
    }

    func testAFileKeepsAnExtensionThePlayerKnows() {
        let name = { PodcastStore.fileName("a", url: URL(string: $0), mime: $1) }
        XCTAssertTrue(name("https://x.test/one.M4A?token=1", nil).hasSuffix(".m4a"))
        XCTAssertTrue(name("https://x.test/stream", "audio/x-m4a").hasSuffix(".m4a"))
        XCTAssertTrue(name("https://x.test/stream", "audio/mpeg").hasSuffix(".mp3"))
        XCTAssertEqual(name("https://x.test/one.mp3", nil), name("https://x.test/other.mp3", nil), "the same episode, the same file")
    }

    func testLoadingGoesThroughItsStatesAndStays() async throws {
        let podcasts = store()
        XCTAssertEqual(podcasts.state("a"), .none)
        podcasts.load("a", title: "A", show: "S", url: sound)
        XCTAssertEqual(fake.started.map(\.mobile), [false], "on Wi-Fi only, as it is at first")
        XCTAssertEqual(podcasts.state("a"), .loading(done: 0, total: 0))
        fake.offWifi?(true)
        XCTAssertEqual(podcasts.state("a"), .waiting)
        podcasts.load("a", title: "A", show: "S", url: sound, mobile: true)
        XCTAssertEqual(fake.started.map(\.mobile), [false, true])
        XCTAssertEqual(podcasts.state("a"), .loading(done: 0, total: 0), "asked for on mobile data")
        fake.events?(.progress("a", done: 400, total: 1000))
        XCTAssertEqual(podcasts.state("a"), .loading(done: 400, total: 1000))
        try arrive("a")
        XCTAssertEqual(podcasts.state("a"), .loaded(1000))
        XCTAssertEqual(podcasts.totalBytes, 1000)
        XCTAssertNotNil(podcasts.file("a"))
        XCTAssertEqual(try folder.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
        // the next start knows it
        XCTAssertEqual(store().state("a"), .loaded(1000))
        podcasts.remove("a")
        XCTAssertEqual(podcasts.state("a"), .none)
        XCTAssertNil(store().file("a"))
    }

    func testWhatFailedOrWasCancelled() async throws {
        let podcasts = store()
        podcasts.load("a", title: "A", show: "S", url: sound)
        fake.events?(.failed("a"))
        XCTAssertEqual(podcasts.state("a"), .failed)
        podcasts.load("a", title: "A", show: "S", url: sound)
        XCTAssertEqual(podcasts.state("a"), .loading(done: 0, total: 0))
        podcasts.remove("a")
        XCTAssertTrue(fake.cancelled.contains("a"))
        try arrive("a")
        XCTAssertEqual(podcasts.state("a"), .none, "what arrives after it was cancelled is thrown away")
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: folder.path).filter { $0.hasSuffix(".mp3") }, [])
        // a download that is not going any more after a start has failed
        podcasts.load("b", title: "B", show: "S", url: sound)
        fake.going = []
        let again = store()
        await again.settle()
        XCTAssertEqual(again.state("b"), .failed)
    }

    func testHowFarItWasHeardAndWhatGoesAfterListening() async throws {
        let podcasts = store()
        podcasts.heard("a", at: 3, of: 600)
        XCTAssertNil(podcasts.resumeAt("a"), "a few seconds are no start")
        podcasts.heard("a", at: 200, of: 600)
        XCTAssertEqual(PodcastStore(folder: folder, downloader: Fake(), settings: settings).resumeAt("a"), 200, "kept for the next start")
        XCTAssertFalse(podcasts.listening("a").heard)
        podcasts.heard("a", at: 580, of: 600)
        XCTAssertTrue(podcasts.listening("a").heard)
        XCTAssertFalse(podcasts.finished("a"), "no file to remove")
        XCTAssertNil(podcasts.resumeAt("a"), "from the start the next time")

        for id in ["a", "b", "c"] { podcasts.load(id, title: id, show: "S", url: sound); try arrive(id, bytes: id == "c" ? 30 : 10) }
        podcasts.finished("c")
        XCTAssertEqual([podcasts.totalBytes, podcasts.heardBytes], [50, 40])
        podcasts.removeHeard(except: "a")
        XCTAssertEqual(Set(podcasts.loaded.map(\.id)), ["a", "b"], "the one playing stays")
        settings.set(true, forKey: PodcastStore.removeKey)
        XCTAssertTrue(podcasts.finished("b"))
    }

    func testThePlayerGoesOnWhereItStopped() async throws {
        let podcasts = store()
        podcasts.heard("a", at: 120, of: 600)
        let player = AudioPlayer(store: podcasts)
        player.toggle("a", url: sound, title: "A", show: "S")
        XCTAssertEqual(player.position, 120)
        player.stop()
        XCTAssertEqual(podcasts.resumeAt("a"), 120, "stopped before it could play: nothing is lost")
        player.toggle("b", url: sound, title: "B", show: "S")
        player.seek(to: 45)
        player.pause()
        XCTAssertEqual(podcasts.resumeAt("b"), 45)
        player.stop()
    }

    func testLoadedEpisodesStayInTheirFeed() throws {
        let feeds = FeedsModel(samples: true)
        let url = "https://example.org/podcast.xml"
        feeds.keeps = { $0 == url + "\nold" }
        func parsed(_ ids: [String], _ date: Date) -> FeedFetcher.Result {
            let items = ids.map { FeedItem(id: $0, title: $0, link: "https://example.org/" + $0, published: date, body: "words", audio: "https://example.org/\($0).mp3") }
            return FeedFetcher.Result(url: URL(string: url)!, parsed: FeedParser.Parsed(title: "P", items: items), etag: "", modified: "")
        }
        feeds.apply(parsed(["old", "older"], Date.now.addingTimeInterval(-60 * 24 * 3600)), to: url)
        feeds.apply(parsed(["new"], .now), to: url)
        XCTAssertEqual(feeds.states[url]?.items.map(\.item.id), ["new", "old"])
        XCTAssertEqual(feeds.states[url]?.items.last?.item.body, "words")
        // past the number that is stored too
        feeds.apply(parsed((0..<420).map { "n\($0)" }, .now), to: url)
        XCTAssertEqual(feeds.states[url]?.items.count, 401)
        XCTAssertTrue(feeds.states[url]?.items.contains { $0.item.id == "old" } == true)
    }

    func testTheSizeAFeedGives() throws {
        let xml = """
        <rss><channel><title>P</title>
        <item><guid>a</guid><title>A</title><enclosure url="https://example.org/a.mp3" type="audio/mpeg" length="49000000"/></item>
        <item><guid>b</guid><title>B</title><enclosure url="https://example.org/b.mp3" type="audio/mpeg" length="1"/></item>
        </channel></rss>
        """
        let parsed = try XCTUnwrap(FeedParser.parse(Data(xml.utf8), contentType: "application/rss+xml", base: URL(string: "https://example.org/")))
        XCTAssertEqual(parsed.items.map(\.audioBytes), [49_000_000, nil])
    }

    /// The categories of the feeds are the extension's tags, and they follow what Safari hands over.
    func testFeedCategoriesAreTheExtensions() {
        let feeds = FeedsModel(samples: true)
        let before = feeds.feeds.count
        feeds.take([InboxFeed(url: "https://a.example/feed", title: "A", tags: ["Tech", "Design"]), InboxFeed(url: "https://b.example/feed", title: "B", tags: ["design", "News"])])
        XCTAssertEqual(feeds.feeds.count, before + 2)
        XCTAssertEqual(feeds.categories.filter { ["design", "news", "tech"].contains($0.lowercased()) }.map { $0.lowercased() }, ["design", "news", "tech"], "each once")
        feeds.take([InboxFeed(url: "https://a.example/feed", title: "A", tags: ["Climate"])])
        XCTAssertEqual(feeds.feeds.first { $0.url == "https://a.example/feed" }?.tags, ["Climate"])
        feeds.take([InboxFeed(url: "https://a.example/feed", title: "A", tags: [])])
        XCTAssertEqual(feeds.feeds.first { $0.url == "https://a.example/feed" }?.tags, ["Climate"], "none named: what is there stays")
        feeds.remove("https://b.example/feed")
        feeds.take([InboxFeed(url: "https://b.example/feed", title: "B", tags: ["News"])])
        XCTAssertFalse(feeds.feeds.contains { $0.url == "https://b.example/feed" }, "removed here stays removed")
        XCTAssertTrue(feeds.feeds.contains { $0.has(category: "CLIMATE") })
    }
}
