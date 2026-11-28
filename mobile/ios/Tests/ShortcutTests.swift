import AppIntents
import XCTest
@testable import Kaivo

/// What Siri and the Shortcuts app can ask for.
@MainActor
final class ShortcutTests: XCTestCase {
    private final class Quiet: EpisodeDownloader {
        var events: ((DownloadEvent) -> Void)?
        var offWifi: ((Bool) -> Void)?
        func begin() {}
        func start(_ id: String, url: URL, mobile: Bool) {}
        func cancel(_ id: String) {}
        func running() async -> [String] { [] }
    }

    func testTheEpisodeListenedToLastGoesOn() async throws {
        let folder = FileManager.default.temporaryDirectory.appending(path: "shortcut-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let podcasts = PodcastStore(folder: folder, downloader: Quiet())
        let feeds = FeedsModel(samples: true)
        let url = "https://example.org/cast.xml"
        feeds.take([InboxFeed(url: url, title: "Cast", tags: [])])
        let items = ["one", "two"].map { FeedItem(id: $0, title: $0, link: "https://example.org/" + $0, published: .now, audio: "https://example.org/\($0).mp3") }
        feeds.apply(FeedFetcher.Result(url: URL(string: url)!, parsed: FeedParser.Parsed(title: "Cast", items: items), etag: "", modified: ""), to: url)
        XCTAssertNil(RootView.episodeToContinue(podcasts, feeds), "nothing started")
        podcasts.heard(url + "\none", at: 100, of: 600)
        try await Task.sleep(for: .milliseconds(20))
        podcasts.heard(url + "\ntwo", at: 50, of: 600)
        XCTAssertEqual(RootView.episodeToContinue(podcasts, feeds)?.2, "two")
        podcasts.finished(url + "\ntwo")
        XCTAssertEqual(RootView.episodeToContinue(podcasts, feeds)?.2, "one")
        podcasts.heard("gone\nitem", at: 80, of: 600)
        XCTAssertEqual(RootView.episodeToContinue(podcasts, feeds)?.2, "one", "one that cannot be played any more is passed over")
    }

    func testRequestsReachTheApp() async throws {
        AppRequests.shared.pending = nil
        _ = try await PlayBriefingIntent().perform()
        XCTAssertEqual(AppRequests.shared.pending, .briefing)
        _ = try await ContinueReadingIntent().perform()
        XCTAssertEqual(AppRequests.shared.pending, .continueReading)
        AppRequests.shared.pending = nil
        XCTAssertEqual(KaivoShortcuts.appShortcuts.count, 4)
    }
}
