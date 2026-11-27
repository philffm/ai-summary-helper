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
        let stored = try await second.store!.sync.host.run("return (await sync.library.marks()).highlights.length;")
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
        let kept = try await one.sync.host.run("return (await storage.get('local:articles:rec:p'))['local:articles:rec:p'].content;")
        XCTAssertEqual(try JSONDecoder().decode(String.self, from: kept), content, "the stored text is not touched")
    }

    private func serveTheBrowsersPlace() throws -> [String: Any] {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sync-place", withExtension: "json"))
        let made = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        for (path, text) in try XCTUnwrap(made["files"] as? [String: String]) {
            FakeDAV.put("/files/kaivo-test/" + path, try XCTUnwrap(Data(base64Encoded: text)))
        }
        return made
    }

    private var changesOnTheServer: Int { FakeDAV.count("PUT") + FakeDAV.count("MKCOL") + FakeDAV.count("DELETE") }

    /// Writing back, as far as it goes: how far an article of the library was read, and its highlights. The result is read
    /// by the extension's own code (TEST_RUNNER_KAIVO_SYNC_BACK=<folder>/place, then scripts/sync-compat.mjs back <folder>).
    func testWritesBackReadingAndHighlightsAndNothingElse() async throws {
        let made = try serveTheBrowsersPlace()
        // before joining: an article only this phone has, and a copy of the browser's own, saved here earlier and read further
        var copy = Passage(text: "Grüße aus dem Browser 🌍, with a \"quote\" & more.")
        copy.highlight((copy.text as NSString).range(of: "Grüße aus dem Browser"))
        var mine = Passage(text: "Only my words.")
        mine.highlight((mine.text as NSString).range(of: "my words"))
        var more = Passage(text: "Marked on the phone before joining.")
        more.highlight((more.text as NSString).range(of: "before joining"))
        try saveAsBefore([
            Article(id: "mine", title: "Only on this phone", host: "example.org", tags: [], words: 3, savedAt: .now,
                    passages: [mine], link: "https://example.org/mine"),
            Article(id: "copy", title: "Saved here first", host: "example.org", tags: [], words: 12,
                    savedAt: Date(timeIntervalSince1970: 1_700_000_000), progress: 0.9, passages: [copy, more], link: "https://example.org/from-the-browser"),
            Article(id: "nowhere", title: "No address", host: "A feed", tags: [], words: 2, savedAt: .now, passages: [Passage(text: "No link.")]),
        ])
        let network = URLSessionConfiguration.ephemeral
        network.protocolClasses = [FakeDAV.self]
        let store = try LibraryStore(folder: root.appending(path: "library"), shared: shared, vault: vault, writeBack: true, network: network)
        let library = Library(samples: false, store: store)
        await library.settled()
        let model = SyncModel(library: library)
        await model.read("aish-library://v1?k=webdav&u=https%3A%2F%2Fdav.test%2Ffiles%2F&n=u&p=p&r=kaivo-test")
        model.passphrase = try XCTUnwrap(made["passphrase"] as? String)
        await model.connect()
        XCTAssertNil(model.problem)
        XCTAssertEqual(Set(library.articles.map(\.title)), ["Only on this phone", "No address", "Written in the browser"],
                       "the copy saved here is folded into the library's article")
        var browser = try XCTUnwrap(library.article("x1"))
        XCTAssertEqual(browser.progress, 0.9)

        // read on, keep a suggestion, turn one down, remove a mark, mark something new, and ask for a summary
        func paragraph(_ start: String) throws -> Passage { try XCTUnwrap(browser.passages.first { $0.text.hasPrefix(start) }, start) }
        library.read("x1", upTo: 0.95)
        library.change(try paragraph("Keep this").id, in: "x1") { $0.resolve(suggestion: $0.marks[0].id, keep: true) }
        library.change(try paragraph("Turn this").id, in: "x1") { $0.resolve(suggestion: $0.marks[0].id, keep: false) }
        library.change(try paragraph("Remove this").id, in: "x1") { $0.unmark(NSRange(location: 0, length: 6)) }
        library.change(try paragraph("Grüße").id, in: "x1") { $0.highlight(($0.text as NSString).range(of: "quote")) }
        library.setSummary("x1", ["Written on the phone."], marking: [])
        // Safari on this phone hands the same page over, with its own title and text
        try await store.take([["entry": ["id": "safari1", "url": "https://example.org/from-the-browser", "title": "Another title", "progress": 0.1],
                               "record": ["content": "<p>Other text.</p>", "summary": "<p>Other summary.</p>"], "fresher": true]])
        await library.settled()
        await model.fetch()
        XCTAssertNil(model.problem)
        browser = try XCTUnwrap(library.article("x1"))
        XCTAssertEqual(browser.summary, ["Written on the phone."], "kept by the app")
        XCTAssertEqual(browser.title, "Written in the browser")

        let written = changesOnTheServer
        XCTAssertGreaterThan(FakeDAV.count("PUT"), 0)
        XCTAssertEqual(FakeDAV.count("DELETE"), 0)
        await model.fetch()
        XCTAssertEqual(changesOnTheServer, written, "a run with nothing new writes nothing")

        if let folder = ProcessInfo.processInfo.environment["KAIVO_SYNC_BACK"] {
            try FakeDAV.write(below: "/files/kaivo-test/", to: URL(fileURLWithPath: folder))
        }
    }

    func testTheSameWordsElsewhereAreAnotherMark() async throws {
        let store = try store()
        let result = try await store.sync.host.run("""
            const page = 'https://example.org/p';
            const one = { entry: { id: 'p', url: page, title: 'P', timestamp: '2026-11-01T10:00:00.000Z' }, record: {} };
            const mark = (id, prefix, suffix) => ({ id, text: 'the same', ai: false, timestamp: '2026-11-01T10:00:00.000Z', prefix, suffix });
            await sync.library.take({ articles: [{ ...one, highlights: [mark('a', 'First: ', ' words.')] }] });
            await sync.library.take({ articles: [{ ...one, highlights: [mark('b', 'Second: ', ' words.')] }] });
            await sync.library.take({ articles: [{ ...one, highlights: [mark('c', 'Longer. First: ', ' words. And more.')] }] });
            return (await sync.library.marks()).highlights.map((h) => h.id).sort();
            """)
        XCTAssertEqual(try JSONDecoder().decode([String].self, from: result), ["a", "b"])
    }

    /// A large library must not be written again for every article.
    func testALargeLibraryMovesWithAHandfulOfWrites() async throws {
        let store = try store()
        let result = try await store.sync.host.run("""
            const writes = {}, set = storage.set;
            storage.set = (items) => { for (const k of Object.keys(items)) if (k.endsWith('articles:index')) writes[k] = (writes[k] || 0) + 1; return set(items); };
            const count = () => { const c = { ...writes }; for (const k of Object.keys(writes)) delete writes[k]; return c; };
            const article = (id, n, progress) => ({ entry: { id, url: 'https://example.org/' + n, title: id, timestamp: '2026-11-01T10:00:00.000Z', progress },
                record: { content: '<p>Words of ' + n + '.</p>' }, highlights: [{ id: 'hl_app_' + id, text: 'Words of ' + n, ai: false, timestamp: '2026-11-01T10:00:00.000Z' }] });
            const ids = await sync.library.take({ articles: Array.from({ length: 700 }, (_, i) => article('own' + i, i, 0.5)) });
            const taking = count();
            // a library of 300 of the same pages arrives: its articles and what the server knows of them
            const theirs = Array.from({ length: 300 }, (_, i) => ({ id: 'srv' + i, url: 'https://example.org/' + i, title: 'srv' + i, timestamp: '2026-11-02T10:00:00.000Z', progress: 0.1 }));
            await storage.set({ 'articles:index': theirs, 'hl:schema': 2,
                ...Object.fromEntries(theirs.map((e, i) => ['articles:rec:' + e.id, { content: '<p>Words of ' + i + '.</p>' }])),
                'sync:ledger:p': { items: Object.fromEntries(theirs.map((e) => ['article:' + e.id, {}])) } });
            count();
            const moved = await sync.library.settle('p');
            const settling = count();
            const index = (await storage.get('articles:index'))['articles:index'];
            const rest = (await storage.get('local:articles:index'))['local:articles:index'];
            const marks = (await sync.library.marks()).highlights;
            return { first: ids[0], taking, settling, moved, theirs: index.length, ours: rest.length,
                     further: index.every((e) => e.progress === 0.5), marks: marks.length };
            """)
        let got = try XCTUnwrap(JSONSerialization.jsonObject(with: result) as? [String: Any])
        XCTAssertEqual(got["first"] as? String, "own0")
        XCTAssertEqual(got["taking"] as? [String: Int], ["local:articles:index": 1])
        XCTAssertEqual(got["settling"] as? [String: Int], ["articles:index": 1, "local:articles:index": 1])
        XCTAssertEqual(got["moved"] as? Int, 300)
        XCTAssertEqual(got["theirs"] as? Int, 300)
        XCTAssertEqual(got["ours"] as? Int, 400)
        XCTAssertEqual(got["further"] as? Bool, true, "how far each was read came along")
        XCTAssertEqual(got["marks"] as? Int, 700, "no highlight lost, none doubled")
    }

    /// The build before this one kept the app's own articles under the extension's keys, beside a joined library.
    func testWhatAnEarlierBuildLeftBesideTheLibraryStaysHere() async throws {
        let made = try serveTheBrowsersPlace()
        let network = URLSessionConfiguration.ephemeral
        network.protocolClasses = [FakeDAV.self]
        let store = try LibraryStore(folder: root.appending(path: "library"), shared: shared, vault: vault, writeBack: true, network: network)
        let library = Library(samples: false, store: store)
        await library.settled()
        let model = SyncModel(library: library)
        await model.read("aish-library://v1?k=webdav&u=https%3A%2F%2Fdav.test%2Ffiles%2F&n=u&p=p&r=kaivo-test")
        model.passphrase = try XCTUnwrap(made["passphrase"] as? String)
        await model.connect()
        XCTAssertNil(model.problem)
        XCTAssertEqual(changesOnTheServer, 0)
        _ = try await store.sync.host.run("""
            const index = (await storage.get('articles:index'))['articles:index'];
            const old = (id, url, progress) => ({ id, url, title: id, timestamp: '2026-10-01T10:00:00.000Z', progress, archived: false });
            await storage.set({ 'articles:rec:alone': { content: '<p>Alone here.</p>' }, 'articles:rec:twin': { content: '<p>quote</p>' } });
            await storage.set({ 'articles:index': [old('alone', 'https://example.org/alone', 0.4), old('twin', 'https://example.org/from-the-browser', 0.99), ...index] });
            await sync.highlights.apply([{ op: 'add', hl: { id: 'hl_app_alone', url: 'https://example.org/alone', text: 'Alone here', type: 'user', timestamp: '2026-10-01T10:00:00.000Z' } }]);
            await new Promise((resolve) => setTimeout(resolve, 100));
            """)
        await model.fetch()
        XCTAssertNil(model.problem)
        XCTAssertEqual(FakeDAV.count("PUT"), 1, "only how far the library's article was read")
        XCTAssertEqual(FakeDAV.count("DELETE"), 0)
        XCTAssertEqual(Set(library.articles.map(\.id)), ["alone", "x1"], "the screen shows what is there now")
        XCTAssertEqual(library.article("x1")?.progress, 0.99)
        XCTAssertEqual(library.article("alone")?.passages.first?.marks.count, 1)
    }

    func testWithoutTheSwitchNothingIsWritten() async throws {
        let made = try serveTheBrowsersPlace()
        let library = try await start()
        let model = SyncModel(library: library)
        await model.read("aish-library://v1?k=webdav&u=https%3A%2F%2Fdav.test%2Ffiles%2F&n=u&p=p&r=kaivo-test")
        model.passphrase = try XCTUnwrap(made["passphrase"] as? String)
        await model.connect()
        XCTAssertEqual(model.state?.writesBack, false)
        library.read("x1", upTo: 0.99)
        await library.settled()
        await model.fetch()
        XCTAssertEqual(changesOnTheServer, 0)
        let again = try await start()
        XCTAssertEqual(again.article("x1")?.progress, 0.99, "kept here")
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
        XCTAssertEqual(model.state?.articles, 1, "what came from the library")
        XCTAssertEqual(Set(library.articles.map(\.title)), ["Only on this phone", "Written in the browser"])
        let browser = try XCTUnwrap(library.article("x1"))
        XCTAssertEqual(browser.progress, 0.35)
        XCTAssertEqual(browser.passages.flatMap { passage in passage.marks.map { passage.words(of: $0) } },
                       ["Grüße aus dem Browser", "Keep this suggestion.", "Turn this down.", "Remove this mark."])
        XCTAssertTrue(FileManager.default.fileExists(atPath: library.store!.sync.backupBeforeJoin.path))
        XCTAssertEqual(FakeDAV.count("PUT") + FakeDAV.count("MKCOL") + FakeDAV.count("DELETE"), 0)
        await model.leave()
        XCTAssertNil(model.state)
        XCTAssertEqual(library.articles.count, 2, "what was fetched stays")
    }
}
