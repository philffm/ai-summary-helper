import XCTest
@testable import Kaivo

/// A recommendation as a file: what is written is read back, whatever the words hold, and a stranger's file is held to
/// limits.
@MainActor
final class RecommendationTests: XCTestCase {
    private let words = Recommendation.Words(recommendedBy: "Recommended by Phil", read: "Read the article", hint: "Open with Kaivo")

    private func full() -> Recommendation {
        Recommendation(url: "https://example.org/a?x=1&y=2", title: "Why <b> \"quotes\" & </script> matter", note: "Look at the second part.\nIt's good.",
                       from: "Phil 🌿", marks: ["A sentence that was marked.", "Zweite Stelle: Grüße"], summary: ["Short.", "要約"])
    }

    func testWhatIsWrittenIsReadBack() throws {
        let page = full().page(words)
        XCTAssertEqual(Recommendation.read(Data(page.utf8)), full())
        XCTAssertFalse(page.lowercased().contains("<script"), "no script, and none that words could open")
        XCTAssertTrue(page.contains("&lt;b&gt; &quot;quotes&quot; &amp; &lt;/script&gt;"))
        XCTAssertTrue(page.contains("href=\"https://example.org/a?x=1&amp;y=2\""))
        XCTAssertFalse(page.contains("src="), "nothing is loaded from elsewhere")
        if let folder = ProcessInfo.processInfo.environment["KAIVO_RECOMMENDATION_OUT"] {
            try page.write(toFile: folder, atomically: true, encoding: .utf8)
        }
    }

    /// The pages both phones' apps are tested against: one written here, one by the Android app.
    func testThePagesOfBothPhonesAreRead() throws {
        let fixtures = URL(filePath: #filePath).deletingLastPathComponent().appending(path: "../../../plugin/tests/fixtures").standardizedFileURL
        for name in ["recommendation-vector.html", "recommendation-android-vector.html"] {
            XCTAssertEqual(Recommendation.read(try Data(contentsOf: fixtures.appending(path: name))), full(), name)
        }
    }

    func testWhatIsNoRecommendationIsNone() {
        let page = full().page(words)
        XCTAssertNil(Recommendation.read(Data("<html><body>Hello</body></html>".utf8)))
        XCTAssertNil(Recommendation.read(Data(page.replacingOccurrences(of: "content=\"ey", with: "content=\"!!").utf8)))
        XCTAssertNil(Recommendation.read(Data((page + String(repeating: " ", count: Recommendation.maxBytes)).utf8)), "too large")
        for url in ["javascript:alert(1)", "file:///etc/passwd", "kaivo://today", "https://", "not an address"] {
            var bad = full()
            bad.url = url
            XCTAssertNil(bad.checked(), url)
            XCTAssertNil(Recommendation.read(Data(bad.page(words).utf8)), url)
        }
        var long = full()
        long.v = 2
        XCTAssertNil(long.checked(), "a later form is not guessed at")
        long = full()
        long.title = String(repeating: "t", count: 5000)
        long.marks = Array(repeating: "m", count: 90)
        long.from = "two\nlines"
        let cut = long.checked()
        XCTAssertEqual([cut?.title.count, cut?.marks.count], [300, 20])
        XCTAssertEqual(cut?.from, "two lines")
    }

    func testAFileNameFromAnyName() {
        XCTAssertEqual(Recommendation.fileName("Recommendation from Phil"), "Recommendation from Phil.html")
        XCTAssertEqual(Recommendation.fileName("From ../a/b: \"c\"\n"), "From .. a b c.html", "no path: dots alone lead nowhere")
        XCTAssertEqual(Recommendation.fileName(".hidden/.."), "hidden.html")
        let file = try? RecommendView.write(full())
        XCTAssertEqual(file?.pathExtension, "html")
        XCTAssertEqual(file.flatMap { try? Data(contentsOf: $0) }.flatMap { Recommendation.read($0) }, full())
    }

    /// The share extension is offered for links, text and HTML files, and for no other file.
    func testWhatKaivoIsOfferedFor() throws {
        let plist = try XCTUnwrap(Bundle.main.builtInPlugInsURL.flatMap { Bundle(url: $0.appending(path: "KaivoShare.appex")) }?.infoDictionary)
        let rule = try XCTUnwrap(((plist["NSExtension"] as? [String: Any])?["NSExtensionAttributes"] as? [String: Any])?["NSExtensionActivationRule"] as? String)
        let predicate = NSPredicate(format: rule)
        func offered(_ types: [String]) -> Bool { predicate.evaluate(with: ["extensionItems": [["attachments": [["registeredTypeIdentifiers": types]]]]]) }
        XCTAssertTrue(offered(["public.url"]), "a page")
        XCTAssertTrue(offered(["public.plain-text"]), "text with a link")
        XCTAssertTrue(offered(["public.html"]), "a recommendation")
        XCTAssertTrue(offered(["public.html", "public.file-url"]), "a recommendation as a file")
        XCTAssertFalse(offered(["com.adobe.pdf", "public.file-url"]))
        XCTAssertFalse(offered(["public.jpeg"]))
        XCTAssertFalse(offered(["public.plain-text", "public.file-url"]), "a text file")
    }

    func testASharedRecommendationBecomesAnArticleWithItsNoteAndMarks() async throws {
        let root = FileManager.default.temporaryDirectory.appending(path: "rec-" + UUID().uuidString)
        let inbox = root.appending(path: "inbox")
        try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: root.appending(path: "shared"), withIntermediateDirectories: true)
        let vault = SyncVault(scope: "rec-" + UUID().uuidString)
        func start() async throws -> Library {
            let library = Library(samples: false, store: try LibraryStore(folder: root.appending(path: "library"), shared: root.appending(path: "shared"), vault: vault))
            await library.settled()
            return library
        }
        let library = try await start()
        var r = full()
        r.url = "https://example.org/recommended"
        SharedLinks.add(SharedLink(url: r.url, title: r.title, summarize: false, date: .now, recommendation: r), to: inbox)
        await library.takeShared(from: inbox)
        let article = try XCTUnwrap(library.articles.first { $0.link == r.url })
        XCTAssertEqual(article.recommendation, r)
        library.fill(article.id, with: ExtractedPage(title: "The page", passages: [Passage(text: "Before. A sentence that was marked. After.")]))
        await library.settled()
        let filled = try XCTUnwrap(library.articles.first { $0.link == r.url })
        XCTAssertEqual(filled.passages.first?.marks.map { [filled.passages[0].words(of: $0), $0.ai ? "suggestion" : "own"] }, [["A sentence that was marked.", "suggestion"]])
        let note = try XCTUnwrap(library.entries.first { $0.kind == .note })
        XCTAssertTrue(note.text.contains("Phil") && note.text.contains("Look at the second part."))
        XCTAssertEqual(note.article, filled.id)
        let again = try await start()
        XCTAssertEqual(again.articles.first { $0.link == r.url }?.recommendation, r, "there at the next start")
    }
}
