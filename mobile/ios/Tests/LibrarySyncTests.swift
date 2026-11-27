import XCTest
@testable import Kaivo

/// Joining a library and fetching it: nothing is written on the server, and the logins stay in the Keychain.
final class LibrarySyncTests: XCTestCase {
    private var folder = URL.temporaryDirectory
    private var vault = SyncVault(scope: "tests")
    private let passphrase = "abandon ability able about above"

    override func setUp() {
        FakeDAV.reset()
        folder = FileManager.default.temporaryDirectory.appending(path: "library-" + UUID().uuidString)
        vault = SyncVault(scope: "tests-" + UUID().uuidString)
    }

    override func tearDown() {
        try? vault.write("sync:secrets", nil)
        try? FileManager.default.removeItem(at: folder)
    }

    /// A phone whose network is the fake server of SyncTests.
    private func phone() throws -> LibrarySync {
        let network = URLSessionConfiguration.ephemeral
        network.protocolClasses = [FakeDAV.self]
        return try LibrarySync(folder: folder, vault: vault, network: network)
    }

    private func code(root: String = "kaivo-test", password: String = "p") -> String {
        "aish-library://v1?k=webdav&u=https%3A%2F%2Fdav.test%2Ffiles%2F&n=u&p=\(password)&r=\(root)"
    }

    /// The place the extension wrote (scripts/sync-compat.mjs make).
    private func serveTheBrowsersPlace() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sync-place", withExtension: "json"))
        let made = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        for (path, content) in try XCTUnwrap(made["files"] as? [String: String]) {
            FakeDAV.put("/files/kaivo-test/" + path, try XCTUnwrap(Data(base64Encoded: content)))
        }
    }

    private var changesOnTheServer: Int { FakeDAV.count("PUT") + FakeDAV.count("MKCOL") + FakeDAV.count("DELETE") }

    private func message(_ work: () async throws -> Void) async -> String {
        do { try await work(); return "" } catch { return "\(error)" }
    }

    private var databaseBytes: Data {
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        return files.reduce(into: Data()) { $0.append((try? Data(contentsOf: $1)) ?? Data()) }
    }

    func testJoinFetchLeave() async throws {
        try serveTheBrowsersPlace()
        let library = try phone()
        let nothing = try await library.state()
        XCTAssertNil(nothing)

        try await library.join(code: code(), passphrase: passphrase)
        let first = try await library.run()
        XCTAssertEqual(first.pulled, 2)
        XCTAssertEqual(first.pushed, 0)
        XCTAssertEqual(first.errors, [])
        let joined = try await library.state()
        let state = try XCTUnwrap(joined)
        XCTAssertEqual(state.articles, 1)
        XCTAssertEqual(state.root, "kaivo-test")
        XCTAssertEqual(state.last?.ok, true)

        let second = try await library.run()
        XCTAssertEqual(second.pulled, 0, "what is here is not fetched again")
        XCTAssertEqual(changesOnTheServer, 0, "fetching writes nothing on the server")

        // the login and the key are in the Keychain, and nowhere in the database
        let secrets = try XCTUnwrap(vault.read("sync:secrets"))
        let held = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(secrets.utf8)) as? [String: [String: String]])
        let master = try XCTUnwrap(held.values.compactMap { $0["master"] }.first)
        XCTAssertNil(databaseBytes.range(of: Data(master.utf8)))
        XCTAssertNil(databaseBytes.range(of: Data("\"password\"".utf8)))
        XCTAssertNotNil(databaseBytes.range(of: Data("Written in the browser".utf8)), "the search above looks at the right files")

        // after a new start the library is still joined
        let again = try phone()
        let kept = try await again.state()
        XCTAssertEqual(kept?.id, state.id)
        let third = try await again.run()
        XCTAssertEqual(third.errors, [])

        try await again.leave()
        let gone = try await again.state()
        XCTAssertNil(gone)
        XCTAssertFalse(try vault.read("sync:secrets")?.contains(master) ?? false)
        let rest = try await again.host.run("return (await storage.get('articles:index'))['articles:index'].length;")
        XCTAssertEqual(String(decoding: rest, as: UTF8.self), "1", "what was fetched stays")
        XCTAssertEqual(changesOnTheServer, 0)
    }

    func testAFolderWithoutALibraryIsLeftAlone() async throws {
        let library = try phone()
        let said = await message { try await library.join(code: self.code(root: "nothing-here"), passphrase: self.passphrase) }
        XCTAssertTrue(said.contains("no Kaivo library"), said)
        XCTAssertEqual(changesOnTheServer, 0, "not even its folder is made")
        let state = try await library.state()
        XCTAssertNil(state)
        XCTAssertNil(try vault.read("sync:secrets"))
    }

    func testWrongWordsAndLoginsJoinNothing() async throws {
        try serveTheBrowsersPlace()
        let library = try phone()
        let words = await message { try await library.join(code: self.code(), passphrase: "zoo zoo zoo zoo zoo") }
        XCTAssertTrue(words.contains("Wrong passphrase"), words)
        let login = await message { try await library.join(code: self.code(password: "x"), passphrase: self.passphrase) }
        XCTAssertTrue(login.contains("401"), login)
        let nonsense = await message { try await library.join(code: "https://example.org", passphrase: self.passphrase) }
        XCTAssertTrue(nonsense.contains("not a Kaivo library code"), nonsense)
        let plain = await message {
            try await library.join(code: self.code().replacingOccurrences(of: "https%3A%2F%2Fdav.test", with: "http%3A%2F%2Fdav.test"), passphrase: self.passphrase)
        }
        XCTAssertTrue(plain.contains("HTTPS"), "plain http only inside one's own network: \(plain)")
        let state = try await library.state()
        XCTAssertNil(state)
        XCTAssertNil(try vault.read("sync:secrets"))
        XCTAssertEqual(changesOnTheServer, 0)
    }

    /// Over a real connection, with a large library: `node mobile/ios/scripts/sync-test-server.mjs --out=<file>` and
    /// TEST_RUNNER_KAIVO_SYNC_SERVER=<file>.
    func testFetchesALargeLibraryOverTheNetwork() async throws {
        guard let file = ProcessInfo.processInfo.environment["KAIVO_SYNC_SERVER"] else { throw XCTSkip("only with the test server") }
        let info = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: file))) as? [String: Any])
        let expect = try XCTUnwrap(info["expect"] as? [String: Any])
        let library = try LibrarySync(folder: folder, vault: vault)
        let began = Date()
        try await library.join(code: try XCTUnwrap(info["code"] as? String), passphrase: try XCTUnwrap(info["passphrase"] as? String))
        let joined = Date()
        let run = try await library.run()
        let fetched = Date()
        XCTAssertEqual(run.errors, [])
        XCTAssertEqual(run.pushed, 0)
        let data = try await library.host.run("""
            const index = (await storage.get('articles:index'))['articles:index'].slice().sort((a, b) => a.id.localeCompare(b.id));
            const records = await storage.get(index.map((e) => 'articles:rec:' + e.id));
            return { articles: index.length, highlights: (await sync.highlights.all({ dismissed: true })).length,
                     hash: AISH_APP.hashValue(index.map((e) => [e.id, e.url, e.title, e.tags, e.progress, records['articles:rec:' + e.id].content])) };
            """)
        let got = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(got as NSDictionary, expect as NSDictionary)
        let before = Date()
        let again = try await library.run()
        XCTAssertEqual(again.pulled, 0)
        print(String(format: "KaivoSync: %d records, join %.2f s, first fetch %.2f s, run with nothing new %.2f s",
                     run.pulled, joined.timeIntervalSince(began), fetched.timeIntervalSince(joined), Date().timeIntervalSince(before)))
        let url = try XCTUnwrap(URL(string: try XCTUnwrap(info["stats"] as? String)))
        let (answer, _) = try await URLSession.shared.data(from: url)
        let asked = try XCTUnwrap(JSONSerialization.jsonObject(with: answer) as? [String: Int])
        XCTAssertNil(asked["PUT"], "\(asked)")
        XCTAssertNil(asked["MKCOL"], "\(asked)")
        XCTAssertNil(asked["DELETE"], "\(asked)")
        try await library.leave()
    }
}
