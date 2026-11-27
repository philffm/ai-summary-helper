import XCTest
@testable import Kaivo

/// The library in the extension's format: what the app kept before comes over whole, and every change the app makes is
/// there again at the next start.
@MainActor
final class LibraryStoreTests: XCTestCase {
    private var root = URL.temporaryDirectory
    private var vault = SyncVault(scope: "store-tests")

    override func setUp() async throws {
        FakeDAV.reset()
        root = FileManager.default.temporaryDirectory.appending(path: "store-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root.appending(path: "shared"), withIntermediateDirectories: true)
        vault = SyncVault(scope: "store-" + UUID().uuidString)
    }

    override func tearDown() async throws {
        try? vault.write("sync:secrets", nil)
        try? FileManager.default.removeItem(at: root)
    }

    private var shared: URL { root.appending(path: "shared") }

    private func store() throws -> LibraryStore {
        let network = URLSessionConfiguration.ephemeral
        network.protocolClasses = [FakeDAV.self]
        return try LibraryStore(folder: root.appending(path: "library"), shared: shared, vault: vault, network: network)
    }

    /// A start of the app on this library.
    private func start() async throws -> Library {
        let library = Library(samples: false, store: try store())
        await library.settled()
        XCTAssertNil(library.failure)
        XCTAssertTrue(library.loaded)
        return library
    }

    private func saveAsBefore(_ articles: [Article]) throws {
        try JSONEncoder().encode(articles).write(to: shared.appending(path: LibraryStore.oldFile))
    }

    /// What must come through a conversion unchanged.
    private func picture(_ article: Article) -> [String] {
        [article.title, article.host, article.link, article.tags.joined(separator: ","), String(format: "%.3f", article.progress),
         article.summary.joined(separator: "|"), article.pending.map { "\($0)" } ?? "", article.paper.map { "\($0.doi) \($0.journal)" } ?? ""]
            + article.passages.map { passage in
                let marks = passage.marks.map { "\($0.start)+\($0.length)\($0.ai ? "ai" : "")" }.joined(separator: ",")
                return "\(passage.kind)/\(passage.heading ?? 0)/\(passage.text)/\(marks)"
            }
    }

    func testTheSampleLibraryComesOverWhole() async throws {
        let before = SampleData.articles
        try saveAsBefore(before)
        let library = try await start()
        XCTAssertEqual(library.articles.count, before.count)
        for article in before {
            let now = try XCTUnwrap(library.article(article.id), article.title)
            XCTAssertEqual(picture(now), picture(article), article.title)
            XCTAssertLessThan(abs(now.savedAt.timeIntervalSince(article.savedAt)), 0.01, article.title)
        }
        // the newest first (samples of one day lie microseconds apart, and the library keeps milliseconds)
        XCTAssertEqual(library.articles.map(\.savedAt), library.articles.map(\.savedAt).sorted(by: >))
        // the old file stays for an earlier version of the app, and a copy of it lies beside it
        let old = try Data(contentsOf: shared.appending(path: "library.json"))
        XCTAssertEqual(try Data(contentsOf: shared.appending(path: "library.before-sync.json")), old)
        // the next start reads the same, paragraphs and marks with the same identity
        let again = try await start()
        XCTAssertEqual(again.articles, library.articles)
    }

    func testConvertingTwiceAddsNothing() async throws {
        let words = "The same words twice."
        var passages = [Passage(text: "First: " + words + " And more."), Passage(text: "Second: " + words + " The end.")]
        passages[1].highlight((passages[1].text as NSString).range(of: words))
        let article = Article(id: "twice", title: "Twice", host: "example.org", tags: [], words: 8, savedAt: .now, passages: passages,
                              link: "https://example.org/twice")
        try saveAsBefore([article])
        let first = try await start()
        XCTAssertEqual(first.article("twice")?.passages.map(\.marks.count), [0, 1], "the mark stays on the second of two alike")
        try saveAsBefore([article])
        let second = try await start()
        XCTAssertEqual(second.articles.count, 1)
        XCTAssertEqual(second.article("twice")?.passages.map(\.marks.count), [0, 1])
        let stored = try await second.store!.sync.host.run("return (await sync.highlights.all({ dismissed: true })).length;")
        XCTAssertEqual(String(decoding: stored, as: UTF8.self), "1")
    }

    func testBackToTheEarlierVersionAndForwardAgain() async throws {
        let first = Article(id: "one", title: "One", host: "example.org", tags: [], words: 3, savedAt: .now.addingTimeInterval(-100),
                            passages: [Passage(text: "Words of one.")], link: "https://example.org/one")
        try saveAsBefore([first])
        let original = try Data(contentsOf: shared.appending(path: "library.json"))
        let library = try await start()
        library.read("one", upTo: 0.8)
        let passage = try XCTUnwrap(library.article("one")?.passages.first)
        library.change(passage.id, in: "one") { $0.highlight(($0.text as NSString).range(of: "Words")) }
        await library.settled()
        try await library.store!.change("one", record: ["content": "<p>Words of one.</p><p>Richer text from elsewhere.</p>"])

        // the earlier version again: it finds its library, reads further and saves another article
        var changed = first
        changed.progress = 0.3
        let second = Article(id: "two", title: "Two", host: "example.org", tags: [], words: 3, savedAt: .now,
                             passages: [Passage(text: "Words of two.")], link: "https://example.org/two")
        try saveAsBefore([second, changed])

        let again = try await start()
        XCTAssertEqual(again.articles.map(\.id), ["two", "one"], "what the earlier version saved comes over")
        let one = try XCTUnwrap(again.article("one"))
        XCTAssertEqual(one.progress, 0.8)
        XCTAssertEqual(one.passages.map(\.text), ["Words of one.", "Richer text from elsewhere."], "a text that is here is not replaced")
        XCTAssertEqual(one.passages[0].marks.count, 1)
        XCTAssertEqual(try Data(contentsOf: shared.appending(path: "library.before-sync.json")), original, "the first copy is never replaced")
        // with nothing new in the file, nothing is taken over again
        again.remove("two")
        await again.settled()
        let last = try await start()
        XCTAssertEqual(last.articles.map(\.id), ["one"])
    }

    func testAFileThatCannotBeReadStaysWhereItIs() async throws {
        try Data("not a library".utf8).write(to: shared.appending(path: "library.json"))
        let library = Library(samples: false, store: try store())
        await library.settled()
        XCTAssertNotNil(library.failure)
        XCTAssertTrue(FileManager.default.fileExists(atPath: shared.appending(path: "library.json").path))
    }

    func testWhatIsDoneInTheAppIsThereAtTheNextStart() async throws {
        var passage = Passage(text: "A suggestion of the AI stands here. Plain words follow.")
        passage.marks = [Mark(start: 0, length: 35, ai: true)]
        let other = Passage(text: "Another paragraph with a second suggestion in it.")
        var second = other
        second.marks = [Mark(start: 0, length: 17, ai: true)]
        try saveAsBefore([Article(id: "a", title: "A", host: "example.org", tags: ["x"], words: 20, savedAt: .now,
                                  passages: [passage, second], link: "https://example.org/a")])
        let library = try await start()
        var article = try XCTUnwrap(library.article("a"))
        library.read("a", upTo: 0.6)
        library.read("a", upTo: 0.4)
        library.change(article.passages[0].id, in: "a") { $0.resolve(suggestion: $0.marks[0].id, keep: true) }
        library.change(article.passages[1].id, in: "a") { $0.resolve(suggestion: $0.marks[0].id, keep: false) }
        library.change(article.passages[0].id, in: "a") { $0.highlight(($0.text as NSString).range(of: "Plain words")) }
        library.setSummary("a", ["One line.", "Two <lines> & more."], marking: ["with a second suggestion"])
        await library.settled()

        var again = try await start()
        article = try XCTUnwrap(again.article("a"))
        XCTAssertEqual(article.progress, 0.6)
        XCTAssertEqual(article.passages[0].marks.map { article.passages[0].words(of: $0) }, ["A suggestion of the AI stands here.", "Plain words"])
        XCTAssertEqual(article.passages[0].marks.map(\.ai), [false, false])
        XCTAssertEqual(article.passages[1].marks.map { article.passages[1].words(of: $0) }, ["with a second suggestion"], "the one turned down is gone")
        XCTAssertEqual(article.summary, ["One line.", "Two <lines> & more."])

        again.change(article.passages[0].id, in: "a") { $0.unmark(($0.text as NSString).range(of: "Plain words")) }
        await again.settled()
        again = try await start()
        XCTAssertEqual(again.article("a")?.passages[0].marks.count, 1)
    }

    func testSavedRemovedAndSavedAgain() async throws {
        let library = try await start()
        let item = FeedItem(id: "1", title: "From a feed", link: "https://example.org/feed-item", published: .now, summary: "Short.",
                            body: "First paragraph.\n\nSecond <b>one</b>.")
        let feed = Feed(url: "https://example.org/feed", title: "Feed", tags: ["news"], updatedAt: 0)
        library.save(item, from: feed)
        await library.settled()
        let saved = try XCTUnwrap(library.articles.first)
        XCTAssertEqual(saved.passages.map(\.text), ["First paragraph.", "Second <b>one</b>."], "words that look like tags stay words")
        XCTAssertEqual(saved.tags, ["news"])
        library.remove(saved.id)
        await library.settled()
        var again = try await start()
        XCTAssertEqual(again.articles, [])
        again.save(item, from: feed)
        await again.settled()
        again = try await start()
        XCTAssertEqual(again.articles.map(\.title), ["From a feed"])
    }

    func testSharedLinksAndTheirText() async throws {
        let folder = root.appending(path: "links")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        XCTAssertTrue(SharedLinks.add(SharedLink(url: "https://example.org/shared", title: "", summarize: true, date: .now), to: folder))
        let library = try await start()
        await library.takeShared(from: folder)
        let article = try XCTUnwrap(library.articles.first)
        XCTAssertEqual(article.pending, Pending(text: true, summary: true))
        XCTAssertEqual(SharedLinks.waiting(in: folder).count, 0)
        library.fill(article.id, with: ExtractedPage(title: "The page", passages: [Passage(text: "Its words.")], paper: Paper(doi: "10.1/x")))
        await library.settled()
        let again = try await start()
        XCTAssertEqual(again.articles.map(\.title), ["The page"])
        XCTAssertEqual(again.articles.first?.passages.map(\.text), ["Its words."])
        XCTAssertEqual(again.articles.first?.paper?.doi, "10.1/x")
        XCTAssertEqual(again.articles.first?.pending, Pending(text: false, summary: true))
    }

    func testPicturesStayInTheTextAndShowFromFiles() async throws {
        let png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0])
        let content = "<p>Before</p><img src=\"data:image/png;base64,\(png.base64EncodedString())\" alt=\"A drawing\"><p>After</p>"
        let one = try store()
        try await one.take([["entry": ["id": "p", "url": "https://example.org/p", "title": "P", "timestamp": "2026-11-01T10:00:00.000Z"],
                             "record": ["content": content]]])
        let article = try await one.articles()[0]
        XCTAssertEqual(article.passages.map(\.kind), [.text, .image, .text])
        let path = try XCTUnwrap(article.passages[1].image)
        XCTAssertEqual(try Data(contentsOf: shared.appending(path: path)), png)
        let kept = try await one.sync.host.run("return (await storage.get('articles:rec:p'))['articles:rec:p'].content;")
        XCTAssertEqual(try JSONDecoder().decode(String.self, from: kept), content, "the stored text is not touched")
    }

    func testJoiningBringsTheBrowsersArticlesAndKeepsTheAppsOwn() async throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sync-place", withExtension: "json"))
        let made = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        for (path, text) in try XCTUnwrap(made["files"] as? [String: String]) {
            FakeDAV.put("/files/kaivo-test/" + path, try XCTUnwrap(Data(base64Encoded: text)))
        }
        try saveAsBefore([Article(id: "mine", title: "Only on this phone", host: "example.org", tags: [], words: 2, savedAt: .now,
                                  passages: [Passage(text: "My words.")], link: "https://example.org/mine")])
        let library = try await start()
        let model = SyncModel(library: library)
        await model.read("aish-library://v1?k=webdav&u=https%3A%2F%2Fdav.test%2Ffiles%2F&n=u&p=p&r=kaivo-test")
        XCTAssertEqual(model.offer?.info, LibrarySync.Code(service: "webdav", server: "dav.test", folder: "kaivo-test", words: false, plain: false))
        model.passphrase = "zoo zoo zoo zoo zoo"
        await model.connect()
        XCTAssertEqual(model.problem, .wrongWords)
        XCTAssertNil(model.state)
        model.passphrase = try XCTUnwrap(made["passphrase"] as? String)
        await model.connect()
        XCTAssertNil(model.problem)
        XCTAssertNil(model.offer)
        XCTAssertEqual(model.state?.articles, 2)
        XCTAssertEqual(Set(library.articles.map(\.title)), ["Only on this phone", "Written in the browser"])
        let browser = try XCTUnwrap(library.article("x1"))
        XCTAssertEqual(browser.progress, 0.35)
        XCTAssertEqual(browser.passages.flatMap { passage in passage.marks.map { passage.words(of: $0) } }, ["Grüße aus dem Browser"])
        XCTAssertTrue(FileManager.default.fileExists(atPath: library.store!.sync.backupBeforeJoin.path))
        XCTAssertEqual(FakeDAV.count("PUT") + FakeDAV.count("MKCOL") + FakeDAV.count("DELETE"), 0)
        await model.leave()
        XCTAssertNil(model.state)
        XCTAssertEqual(library.articles.count, 2, "what was fetched stays")
    }
}
