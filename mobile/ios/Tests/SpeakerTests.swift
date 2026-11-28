import XCTest
@testable import Kaivo

/// Reading aloud: which sentence is being read, and that one voice speaks at a time.
@MainActor
final class SpeakerTests: XCTestCase {
    func testTheSentenceThatIsBeingRead() throws {
        let texts = ["A title", "First sentence here. Second one follows. 🌿 Third.", "Another paragraph."]
        func at(_ words: String) throws -> (Int, String)? {
            let joined = texts.joined(separator: " ") as NSString
            return Speaker.place(of: joined.range(of: words).location, in: texts).map { ($0.part, (texts[$0.part] as NSString).substring(with: $0.sentence)) }
        }
        XCTAssertEqual(try at("title")?.0, 0)
        XCTAssertEqual(try at("sentence here")?.1, "First sentence here.")
        XCTAssertEqual(try at("follows")?.1, "Second one follows.")
        XCTAssertEqual(try at("Third")?.1, "🌿 Third.")
        XCTAssertEqual(try at("Another")?.0, 2)
        XCTAssertNil(Speaker.place(of: 10_000, in: texts))
        XCTAssertNil(Speaker.place(of: 7, in: texts), "the space between two parts belongs to neither")
    }

    func testOneThingIsHeardAtATime() throws {
        let speaker = Speaker()
        speaker.toggle("a", text: "Words to be read aloud, quite a few of them.", title: "A")
        XCTAssertEqual(speaker.current, "a")
        XCTAssertTrue(NowPlaying.shared.owner === speaker)
        speaker.remotePause()
        XCTAssertTrue(speaker.paused && !speaker.isPlaying)
        speaker.toggle("a", text: "Words to be read aloud, quite a few of them.")
        XCTAssertEqual(speaker.current, "a", "paused: the button goes on")
        XCTAssertFalse(speaker.paused)
        // a podcast starts: the reading waits
        let player = AudioPlayer(store: PodcastStore(folder: FileManager.default.temporaryDirectory.appending(path: UUID().uuidString),
                                                     downloader: Silent()))
        player.toggle("p", url: URL(string: "https://example.org/a.mp3")!, title: "P", show: "S")
        XCTAssertTrue(speaker.paused)
        XCTAssertTrue(NowPlaying.shared.owner === player)
        speaker.stop()
        XCTAssertTrue(NowPlaying.shared.owner === player, "stopping the one that waits leaves the other its place")
        player.stop()
        XCTAssertNil(NowPlaying.shared.owner)
        XCTAssertNil(speaker.current)
    }
}

/// A downloader that loads nothing.
private final class Silent: EpisodeDownloader {
    var events: ((DownloadEvent) -> Void)?
    var offWifi: ((Bool) -> Void)?
    func begin() {}
    func start(_ id: String, url: URL, mobile: Bool) {}
    func cancel(_ id: String) {}
    func running() async -> [String] { [] }
}
