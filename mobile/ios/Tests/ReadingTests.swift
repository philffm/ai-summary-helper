import XCTest
@testable import Kaivo

/// Shared links, page text, research papers and summaries.
final class ReadingTests: XCTestCase {
    private func article(_ passages: [Passage], link: String = "https://example.org/a", host: String = "example.org", paper: Paper? = nil) -> Article {
        Article(id: "a", title: "t", host: host, tags: [], words: 1, savedAt: .now, passages: passages, link: link, paper: paper)
    }

    func testSafariHeadingsStayHeadings() {
        let blocks = SafariImport.blocks("<h2 class=\"x\">1. <em>Abstract</em></h2><p>Words.</p><img src=\"https://e.org/p.png\" alt=\"a\"><h3>More</h3><p>Rest.</p>", article: "x")
        XCTAssertEqual(blocks.map(\.text), ["1. Abstract", "Words.", "a", "More", "Rest."])
        XCTAssertEqual(blocks.map(\.heading), [1, nil, nil, 2, nil])
        XCTAssertEqual(blocks.map(\.kind), [.text, .text, .image, .text, .text])
    }

    func testOldLibrariesStillOpen() throws {
        let old = #"[{"id":"a","title":"t","host":"h","tags":[],"words":1,"savedAt":0,"progress":0,"passages":[{"kind":"text","text":"x"}],"summary":[],"link":""}]"#
        let read = try JSONDecoder().decode([Article].self, from: Data(old.utf8))
        XCTAssertNil(read[0].passages[0].heading)
        XCTAssertNil(read[0].pending)
    }

    func testSharedLinks() throws {
        let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        XCTAssertEqual(SharedLinks.link(in: "Look: https://example.org/x?a=1 now")?.absoluteString, "https://example.org/x?a=1")
        XCTAssertNil(SharedLinks.link(in: "mail me at someone@example.org"))
        XCTAssertFalse(SharedLinks.add(SharedLink(url: "file:///etc/hosts", title: "", summarize: false, date: .now), to: folder))
        XCTAssertTrue(SharedLinks.add(SharedLink(url: "https://b.org", title: "B", summarize: true, date: Date(timeIntervalSince1970: 2)), to: folder))
        XCTAssertTrue(SharedLinks.add(SharedLink(url: "https://a.org", title: "A", summarize: false, date: Date(timeIntervalSince1970: 1)), to: folder))
        try Data("broken".utf8).write(to: folder.appending(path: "x.json"))
        XCTAssertEqual(SharedLinks.waiting(in: folder).map(\.link.title), ["A", "B"])
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: folder.path).count, 2, "the unreadable file is gone")
    }

    func testPageText() throws {
        let long = String(repeating: "words of the paper ", count: 15)
        let json = #"{"title":" A Paper ","authors":["Ada L","Alan T"],"journal":"J","doi":"doi:10.1234/ab.5.","blocks":[["h1","A Paper"],["h2","Abstract"],["p",""# + long + #""],["li","[1] Example A."],["li","one thing"]]}"#
        let page = try XCTUnwrap(PageExtract.page(from: json))
        XCTAssertEqual(page.title, "A Paper")
        XCTAssertEqual(page.passages.map(\.heading), [1, nil, nil, nil], "the page's own title is left out")
        XCTAssertEqual(page.passages[2].text, "[1] Example A.")
        XCTAssertEqual(page.passages.last?.text, "• one thing")
        XCTAssertEqual(page.paper, Paper(authors: ["Ada L", "Alan T"], journal: "J", doi: "10.1234/ab.5"))
        XCTAssertNil(PageExtract.page(from: #"{"title":"x","authors":[],"journal":"","doi":"","blocks":[["p","too short"]]}"#))
        XCTAssertNil(PageExtract.page(from: "not json"))
    }

    func testPapersAreToldApart() {
        let paper = [Passage(text: "Abstract", heading: 1), Passage(text: "What we did [1]."), Passage(text: "2. Methods", heading: 1), Passage(text: "How."),
                     Passage(text: "References", heading: 1), Passage(text: "[1] A."), Passage(text: "[2] B."), Passage(text: "Funding", heading: 1), Passage(text: "None.")]
        XCTAssertTrue(PaperSense.isPaper(article(paper)))
        XCTAssertEqual(PaperSense.abstract(paper), 1..<2)
        XCTAssertEqual(PaperSense.references(paper), 5..<7, "what follows the list stays visible")
        let blog = [Passage(text: "Summary", heading: 1), Passage(text: "x"), Passage(text: "Quellen", heading: 1), Passage(text: "y")]
        XCTAssertFalse(PaperSense.isPaper(article(blog)))
        XCTAssertTrue(PaperSense.isPaper(article(blog, link: "https://journals.plos.org/x", host: "journals.plos.org")))
        XCTAssertFalse(PaperSense.isPaper(article([Passage(text: "News.")], link: "https://www.nature.com/news", host: "www.nature.com")))
        XCTAssertTrue(PaperSense.isPaper(article([Passage(text: "x")], link: "https://arxiv.org/abs/2401.00001", host: "arxiv.org")))
        XCTAssertEqual(PaperSense.doi(in: "https://doi.org/10.1371/journal.pone.0026490."), "10.1371/journal.pone.0026490")
        XCTAssertEqual(PaperSense.citations(in: "as shown [3], [4–7, 9] but not [a] or [2024]").count, 2)
    }

    func testModelAddresses() {
        for (written, base) in [("192.168.1.20:11434", "http://192.168.1.20:11434"), (" mac.local:1234/v1/ ", "http://mac.local:1234"),
                                ("https://host/api/chat", "https://host"), ("http://localhost:11434/v1/chat/completions", "http://localhost:11434")] {
            XCTAssertEqual(ModelServer(address: written, model: "m").base?.absoluteString, base, written)
        }
        XCTAssertNil(ModelServer(address: "", model: "m").base)
        XCTAssertNil(ModelServer(address: "ftp://x", model: "m").base)
    }

    func testSummaryRepliesAndParts() async throws {
        let (summary, copied) = SummaryPrompt.split("About sleep.\n- one\n**KEY SENTENCES:**\n1. \"Sleep moves what you read into memory.\"\n- invented sentence that is nowhere at all")
        XCTAssertEqual(SummaryPrompt.lines(summary), ["About sleep.", "one"])
        XCTAssertEqual(SummaryPrompt.sentences(copied, in: ["Sleep moves what you read into memory. More."]), ["Sleep moves what you read into memory."])
        let inline = SummaryPrompt.split("KEY SENTENCES: Sleep moves what you read into memory. A short review keeps more than a second reading.")
        XCTAssertEqual(inline.0, "")
        XCTAssertEqual(SummaryPrompt.sentences(inline.1, in: ["Sleep moves what you read into memory.", "A short review keeps more than a second reading."]).count, 2, "taken apart when they stand apart")
        var turns = 0
        let again = try await SummaryPrompt.summarize(title: "T", paragraphs: [String(repeating: "words ", count: 60)], ask: { system, _ in
            turns += 1
            return system == SummaryPrompt.plain ? "A summary of the words, written out." : "KEY SENTENCES: words"
        }, progress: { _, _ in })
        XCTAssertEqual(turns, 2)
        XCTAssertEqual(again.lines, ["A summary of the words, written out."])
        let long = String(repeating: "A sentence of some length here. ", count: 600)
        let parts = SummaryPrompt.parts(long)
        XCTAssertEqual(parts.count, 4)
        XCTAssertTrue(parts.allSatisfy { $0.count <= SummaryPrompt.chunk })
        var asked: [String] = [], steps: [Int] = []
        let result = try await SummaryPrompt.summarize(title: "T", paragraphs: [long], ask: { system, _ in
            asked.append(system)
            return system == SummaryPrompt.join ? "The whole thing, in one line of text.\n- point" : "- note"
        }, progress: { at, _ in steps.append(at) })
        XCTAssertEqual(asked.count, 5)
        XCTAssertEqual(steps, [1, 2, 3, 4, 5])
        XCTAssertEqual(result.lines.count, 2)
    }

    private func connection(_ mode: String, _ url: String, key: String = "test-key", format: String = "openai") -> ModelConnection {
        ModelConnection(mode: mode, service: mode, name: "N", format: format, url: url, model: "m", key: key, installId: mode == "cloud" ? "inst" : "", region: mode == "cloud" ? "prefer-eu" : "")
    }

    private func body(_ request: URLRequest) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(request.httpBody)) as? [String: Any])
    }

    func testRequestsAreMadeLikeTheExtensions() throws {
        let cloud = try XCTUnwrap(ModelEndpoint.safari(connection("cloud", "https://api.byphil.eu/v1/projects/ai_summary_helper/chat")))
        let sent = try cloud.request(system: "s", user: "u")
        XCTAssertEqual(sent.url?.absoluteString, "https://api.byphil.eu/v1/projects/ai_summary_helper/chat")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "Bearer test-key")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "X-Install-ID"), "inst")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "X-AISH-Region"), "prefer-eu")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "X-AISH-Feature"), "summary")
        XCTAssertNil(try body(sent)["temperature"])
        let deepseek = try XCTUnwrap(ModelEndpoint.safari(connection("own", "https://api.deepseek.com/chat/completions")))
        XCTAssertEqual(try deepseek.request(system: "s", user: "u").url?.absoluteString, "https://api.deepseek.com/chat/completions", "the address as it is")
        XCTAssertNil(try deepseek.request(system: "s", user: "u").value(forHTTPHeaderField: "X-Install-ID"))
        let keyless = try XCTUnwrap(ModelEndpoint.safari(connection("own", "http://box.local:1234/v1/chat/completions", key: "")))
        XCTAssertNil(try keyless.request(system: "s", user: "u").value(forHTTPHeaderField: "Authorization"))
        XCTAssertNil(ModelEndpoint.safari(connection("own", "http://api.example.com/v1/chat/completions")), "no key over plain http to the internet")
        XCTAssertNotNil(ModelEndpoint.safari(connection("own", "http://192.168.1.5:8080/v1/chat/completions")))
        let gemini = try XCTUnwrap(ModelEndpoint.safari(connection("own", "https://generativelanguage.googleapis.com/v1beta/models/m:generateContent", format: "gemini")))
        let asked = try gemini.request(system: "s", user: "u")
        XCTAssertEqual(asked.value(forHTTPHeaderField: "x-goog-api-key"), "test-key")
        XCTAssertNil(asked.value(forHTTPHeaderField: "Authorization"))
        XCTAssertNotNil(try body(asked)["contents"])
        let desktop = connection("own", "http://localhost:11434/api/chat", key: "")
        XCTAssertNil(ModelEndpoint.safari(desktop, onDevice: true), "the computer's own address leads nowhere on a phone")
        XCTAssertNotNil(ModelEndpoint.safari(desktop, onDevice: false))
        let own = try XCTUnwrap(ModelEndpoint.own(ModelServer(address: "10.0.0.2:11434", model: "q")))
        XCTAssertEqual(ModelEndpoint.choose(safari: cloud, own: own, preferOwn: false), cloud)
        XCTAssertEqual(ModelEndpoint.choose(safari: cloud, own: own, preferOwn: true), own)
        XCTAssertEqual(ModelEndpoint.choose(safari: nil, own: own, preferOwn: false), own)
    }

    func testAnswersOfEveryKind() {
        for reply in [#"{"choices":[{"message":{"content":"Hi there"}}]}"#, #"{"message":{"content":"Hi there"}}"#,
                      #"{"candidates":[{"content":{"parts":[{"text":"Hi "},{"text":"there"}]}}]}"#,
                      "data: {\"choices\":[{\"delta\":{\"content\":\"Hi \"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"there\"}}]}\ndata: [DONE]",
                      "{\"message\":{\"content\":\"Hi \"}}\n{\"message\":{\"content\":\"there\"}}",
                      #"{"choices":[{"message":{"content":"<think>hm</think>Hi there"}}]}"#] {
            XCTAssertEqual(ModelEndpoint.text(of: Data(reply.utf8)), "Hi there", reply)
        }
        XCTAssertEqual(ModelEndpoint.text(of: Data("<html>".utf8)), "")
    }

    func testKeychainKeepsAndForgets() throws {
        let kept = connection("own", "https://api.example.com/v1/chat/completions")
        XCTAssertTrue(SafariModel.save(kept, account: "test"), "the shared group takes keychain items")
        XCTAssertEqual(SafariModel.load(account: "test"), kept)
        XCTAssertTrue(SafariModel.save(nil, account: "test"))
        XCTAssertNil(SafariModel.load(account: "test"))
        XCTAssertEqual(SafariModel.handle(["type": "model", "connection": ["mode": "own"]])["ok"] as? Bool, false, "half a connection is refused")
    }

    /// Against a real model on this Mac; runs only when asked to (TEST_RUNNER_KAIVO_MODEL=qwen2.5:3b).
    func testRealModel() async throws {
        guard let model = ProcessInfo.processInfo.environment["KAIVO_MODEL"] else { throw XCTSkip("no model asked for") }
        let client = ModelClient(), server = ModelServer(address: "127.0.0.1:11434", model: model)
        let endpoint = try XCTUnwrap(ModelEndpoint.own(server))
        let models = try await client.models(of: server)
        XCTAssertTrue(models.contains(model), "\(models)")
        let text = ["Sleep moves what you read today into what you know next week. During deep sleep the brain goes over the day again.",
                    "A short review the next morning keeps more than a second reading the same evening. Which stage of sleep matters most is still being discussed."]
        let result = try await SummaryPrompt.summarize(title: "How sleep consolidates memory", paragraphs: text,
                                                       ask: { try await client.ask(endpoint, system: $0, user: $1) }, progress: { _, _ in })
        print("MODEL SUMMARY:", result.lines, "SENTENCES:", result.sentences)
        XCTAssertGreaterThan(result.lines.count, 1)
    }

    /// Loads a real page; runs only when asked to (TEST_RUNNER_KAIVO_PAGE=<address>).
    @MainActor
    func testRealPage() async throws {
        guard let address = ProcessInfo.processInfo.environment["KAIVO_PAGE"], let url = URL(string: address) else { throw XCTSkip("no page asked for") }
        let page = try await XCTUnwrapAsync(await PageFetcher().fetch(url))
        print("PAGE:", page.title, page.passages.count, page.passages.compactMap { $0.heading == nil ? nil : $0.text }, page.paper as Any)
    }

    private func XCTUnwrapAsync<T>(_ value: T?) async throws -> T { try XCTUnwrap(value) }
}

/// Nothing goes to a service on the internet before the reader said yes to that host.
final class ConsentTests: XCTestCase {
    private let store = UserDefaults(suiteName: "consent-test")!
    override func setUp() { store.removePersistentDomain(forName: "consent-test") }
    private func endpoint(_ url: String) -> ModelEndpoint { ModelEndpoint(url: URL(string: url)!, model: "m", name: "Service") }

    func testOnlyOutsideHostsNeedAYes() {
        let consent = AIConsent(store: store)
        for url in ["http://192.168.1.20:11434/v1", "http://mac.local:1234/v1", "http://localhost:11434/v1", "http://100.100.2.3/v1", "http://[fd12:3456::1]:8080/v1"] {
            XCTAssertFalse(consent.isNeeded(for: endpoint(url)), url)
        }
        for url in ["https://api.byphil.eu/v1", "https://api.deepseek.com/v1", "https://[2001:db8::1]/v1"] {
            XCTAssertTrue(consent.isNeeded(for: endpoint(url)), url)
        }
        let cloud = endpoint("https://api.byphil.eu/v1")
        XCTAssertTrue(cloud.recipient.contains("OpenRouter"))
        consent.allow(cloud)
        XCTAssertFalse(consent.isNeeded(for: cloud))
        XCTAssertTrue(consent.isNeeded(for: endpoint("https://api.deepseek.com/v1")), "every host needs its own yes")
        consent.withdraw("api.byphil.eu")
        XCTAssertTrue(consent.isNeeded(for: cloud))
    }

    @MainActor
    func testNothingStartsWithoutTheYes() {
        let summaries = Summaries(), library = Library()
        summaries.consent = AIConsent(store: store)
        let outside = endpoint("https://api.deepseek.com/v1")
        summaries.endpoint = { outside }
        let id = "no-such-article"
        summaries.summarize(id, in: library, asking: false)
        XCTAssertFalse(summaries.isWaiting(id), "a shared link waits")
        XCTAssertNil(summaries.question)
        summaries.summarize(id, in: library)
        XCTAssertFalse(summaries.isWaiting(id))
        XCTAssertEqual(summaries.question?.article, id)
        summaries.answer(summaries.question!, allow: false, in: library)
        XCTAssertNil(summaries.question)
        XCTAssertTrue(summaries.consent.hosts.isEmpty)
    }
}
