import XCTest
@testable import Kaivo

final class SafariTests: XCTestCase {
    private let message: [String: Any] = ["type": "article", "article": [
        "id": "test_1", "url": "https://example.com/post?x=1", "title": "Post", "tags": ["a", "🌐 en"], "words": 0,
        "savedAt": "2026-11-25T10:00:00.123Z", "progress": 0.5, "summary": "<h2>Head</h2><p>Point.</p>",
        "content": "<div><p>First sentence. Marked words here. The end.</p><p>Second.</p></div>",
        "highlights": [["text": "Marked words here.", "ai": false], ["text": "Second.", "ai": true]],
    ] as [String: Any]]

    override func tearDown() {
        for item in SafariInbox.pending() where item.article.id.hasPrefix("test_") { try? FileManager.default.removeItem(at: item.file) }
    }

    func testHandlerAcceptsOnlyArticles() {
        XCTAssertEqual(SafariInbox.handle(["type": "hello"])["ok"] as? Bool, true)
        XCTAssertEqual(SafariInbox.handle(message)["ok"] as? Bool, true)
        XCTAssertTrue(SafariInbox.pending().contains { $0.article.id == "test_1" })
        var bad = message["article"] as! [String: Any]
        bad["id"] = "../escape"
        XCTAssertEqual(SafariInbox.handle(["type": "article", "article": bad])["ok"] as? Bool, false)
        XCTAssertEqual(SafariInbox.handle(["type": "article", "article": "text"])["ok"] as? Bool, false)
        XCTAssertEqual(SafariInbox.handle([:])["ok"] as? Bool, false)
    }

    func testPicturesAreTakenAndKeptInOrder() throws {
        let png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]).base64EncodedString()
        XCTAssertEqual(SafariInbox.handle(["type": "image", "id": "test_1", "name": "0", "data": png])["ok"] as? Bool, true)
        XCTAssertTrue(FileManager.default.fileExists(atPath: SafariInbox.images(of: "test_1").appending(path: "0").path))
        _ = SafariInbox.handle(["type": "image", "id": "test_1", "name": "../x", "data": png])
        _ = SafariInbox.handle(["type": "image", "id": "test_1", "name": "1", "data": Data("<svg/>".utf8).base64EncodedString()])
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: SafariInbox.images(of: "test_1").path), ["0"])
        try FileManager.default.removeItem(at: SafariInbox.images(of: "test_1"))

        let blocks = SafariImport.blocks("<p>One</p><img src=\"kaivo-image:0\" alt=\"A &amp; B\"><p>Two</p><img src=\"http://x/y.png\"><img src=\"https://x/z.png\">", article: "test_1")
        XCTAssertEqual(blocks.map(\.kind), [.text, .image, .text, .image])
        XCTAssertEqual(blocks[1].text, "A & B")
        XCTAssertEqual(blocks[1].image, "images/test_1/0")
        XCTAssertEqual(blocks[3].image, "https://x/z.png")
    }

    func testImportMarksAndKeepsWhatWasDoneInTheApp() throws {
        let data = try JSONSerialization.data(withJSONObject: message["article"]!)
        let inbox = try JSONDecoder().decode(InboxArticle.self, from: data)
        let article = SafariImport.article(inbox, existing: nil)
        XCTAssertEqual(article.id, "safari-test_1")
        XCTAssertEqual(article.host, "example.com")
        XCTAssertEqual(article.tags, ["a"])
        XCTAssertEqual(article.summary, ["Head", "Point."])
        XCTAssertEqual(article.passages.count, 2, "marking does not split a paragraph")
        XCTAssertEqual(article.passages[0].marks.map { article.passages[0].words(of: $0) }, ["Marked words here."])
        XCTAssertEqual(article.passages[1].marks.map(\.ai), [true])
        XCTAssertEqual(article.firstHighlight, "Marked words here.")
        XCTAssertGreaterThan(article.words, 0)

        var mine = article
        mine.progress = 0.9
        mine.passages[1].resolve(suggestion: mine.passages[1].marks[0].id, keep: true)   // kept in the app
        let again = SafariImport.article(inbox, existing: mine)
        XCTAssertEqual(again.progress, 0.9)
        XCTAssertEqual(again.passages.flatMap(\.marks).map(\.ai), [false, false])
    }
}
