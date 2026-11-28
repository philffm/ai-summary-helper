import XCTest
@testable import Kaivo

/// The extension's sync modules running in the app: the same answers as in a browser, and two devices that agree.
final class SyncTests: XCTestCase {
    private var folders: [URL] = []

    override func setUp() {
        FakeDAV.reset()
    }

    override func tearDown() {
        folders.forEach { try? FileManager.default.removeItem(at: $0) }
        folders = []
    }

    private func storage(at url: URL? = nil) throws -> SyncStorage {
        let folder = url?.deletingLastPathComponent() ?? FileManager.default.temporaryDirectory.appending(path: "sync-" + UUID().uuidString)
        folders.append(folder)
        return try SyncStorage(url: url ?? folder.appending(path: "library.sqlite"))
    }

    /// A device with an empty library whose network is the fake server below.
    private func device() throws -> SyncHost {
        let network = URLSessionConfiguration.ephemeral
        network.protocolClasses = [FakeDAV.self]
        return try SyncHost(storage: storage(), network: network)
    }

    private func fixture(_ name: String) throws -> String {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "json"), "\(name).json is not in the tests")
        return try String(contentsOf: url, encoding: .utf8)
    }

    private func answer(_ host: SyncHost, _ body: String, _ input: [String: Any] = [:]) async throws -> [String: Any] {
        let data = try await host.run(body, input: input)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any], String(decoding: data, as: UTF8.self))
    }

    private func problems(_ result: [String: Any], file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(result["bad"] as? [String], [], file: file, line: line)
        XCTAssertGreaterThan(result["checked"] as? Int ?? 0, 0, file: file, line: line)
    }

    // MARK: - The shared vector

    func testValueHashesMergesAndPassphrasesAsInTheExtension() async throws {
        let result = try await answer(try device(), """
        const v = JSON.parse(input.text), A = AISH_APP, bad = [];
        let checked = 0;
        const check = (ok, what) => { checked++; if (!ok) bad.push(what); };
        v.hashValues.forEach((c, i) => check(A.hashValue(c.value) === c.hash, 'hash ' + i));
        for (const c of v.mergeCases) {
            const r = A.mergeRecord(c.local, c.remote);
            check(A.hashValue(r.merged) === A.hashValue(c.merged) && r.changedLocal === c.changedLocal && r.changedRemote === c.changedRemote, 'merge: ' + c.name);
        }
        for (const c of v.passphrases.cases) check(A.canonicalPassphrase(c.input) === c.canonical, 'passphrase: ' + c.input);
        for (const c of v.phoneCodes) {
            const got = A.parsePhoneCode(c.code);
            check(!!got && got.kind === c.connection.service && got.url === c.connection.url && got.username === (c.connection.username || '')
                && got.password === c.password && got.root === c.root && (got.words || '') === (c.words || ''), 'phone code: ' + c.name);
        }
        return { bad, checked };
        """, ["text": try fixture("sync-vector")])
        problems(result)
    }

    func testKeysNamesAndFilesAsInTheExtension() async throws {
        let result = try await answer(try device(), """
        const c = JSON.parse(input.text).crypto, A = AISH_APP, bad = [];
        let checked = 0;
        const check = (ok, what) => { checked++; if (!ok) bad.push(what); };
        const same = (a, b) => A.hashValue(a) === A.hashValue(b);
        const salt = Uint8Array.from(c.saltHex.match(/../g), (h) => parseInt(h, 16));
        const master = await A.deriveMaster(c.passphrase, salt, c.iterations);
        check(A.toHex(master) === c.masterHex, 'master key');
        const keys = await A.subKeys(master);
        for (const n of c.names) check(await A.nameOf(keys, n.type, n.id) === n.name, 'file name of ' + n.id);
        check(A.toHex((await A.openMeta(c.meta, { passphrase: c.passphrase })).master) === c.masterHex, 'meta.json opens');
        check(same(await A.decryptJson(keys, A.fromB64(c.recordFile)), c.record), 'the extension\\'s record file');
        check(same(await A.decryptJson(keys, await A.encryptJson(keys, c.record)), c.record), 'its own record file');
        const refused = async (work) => { try { await work(); return ''; } catch (e) { return e.message; } };
        check(await refused(() => A.openMeta(c.meta, { passphrase: 'something else entirely' })) === 'Wrong passphrase.', 'a wrong passphrase');
        const damaged = A.fromB64(c.recordFile); damaged[damaged.length - 1] ^= 1;
        check(/decrypted/.test(await refused(() => A.decryptJson(keys, damaged))), 'a damaged file');
        return { bad, checked };
        """, ["text": try fixture("sync-vector")])
        problems(result)
    }

    // MARK: - The stand-ins of host.js

    func testAddressesAndPageKeysAsABrowserReadsThem() async throws {
        let result = try await answer(try device(), """
        const v = JSON.parse(input.text), bad = [];
        let checked = 0;
        for (const c of v.urls) {
            checked++;
            let got;
            try {
                const u = c.base === undefined ? new URL(c.input) : new URL(c.input, c.base);
                got = { href: u.href, protocol: u.protocol, host: u.host, hostname: u.hostname, origin: u.origin, pathname: u.pathname, search: u.search, query: [...u.searchParams.entries()] };
            } catch (e) { got = { invalid: true }; }
            for (const k of Object.keys(got.invalid || c.invalid ? { invalid: 1 } : got)) {
                if (JSON.stringify(got[k]) !== JSON.stringify(c[k])) bad.push(JSON.stringify(c.input) + ' ' + k + ': ' + JSON.stringify(got[k]) + ' instead of ' + JSON.stringify(c[k]));
            }
        }
        for (const c of v.pageKeys) { checked++; const key = AISH_APP.pageKeyForUrl(c.input); if (key !== c.key) bad.push('page key of ' + c.input + ': ' + key + ' instead of ' + c.key); }
        return { bad, checked };
        """, ["text": try fixture("url-vector")])
        problems(result)
    }

    func testS3SignatureAsPublished() async throws {
        // AWS's documented example "GET Object with a Range header", as in plugin/tests/test200.mjs
        let result = try await answer(try device(), """
        const empty = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
        const v = await AISH_APP.signV4({ method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt',
            headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9', 'x-amz-content-sha256': empty, 'x-amz-date': '20130524T000000Z' }, payloadHash: empty,
            accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', amzDate: '20130524T000000Z' });
        return { signature: v.signature };
        """)
        XCTAssertEqual(result["signature"] as? String, "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41")
    }

    func testTimersWaitAndCanBeCancelled() async throws {
        let result = try await answer(try device(), """
        const order = [], began = Date.now();
        const never = setTimeout(() => order.push('cancelled'), 10);
        await new Promise((resolve) => { setTimeout(() => { order.push('late'); resolve(); }, 120); setTimeout(() => order.push('early'), 20); clearTimeout(never); });
        return { order, waited: Date.now() - began };
        """)
        XCTAssertEqual(result["order"] as? [String], ["early", "late"])
        XCTAssertGreaterThanOrEqual(result["waited"] as? Int ?? 0, 100)
    }

    func testARedirectIsNotFollowed() async throws {
        let result = try await answer(try device(), """
        const store = AISH_APP.createSync({ storage }).service;
        const r = await store.testServer({ connection: { service: 'webdav', url: 'https://dav.test/moved/', username: 'u' }, secret: { password: 'p' } });
        return r;
        """)
        XCTAssertEqual(result["ok"] as? Bool, false)
        XCTAssertEqual((result["error"] as? [String: Any])?["message"] as? String, "The server redirected the request.")
        XCTAssertFalse(FakeDAV.paths.contains { $0.hasPrefix("/elsewhere") })
    }

    // MARK: - The library

    func testStorageWritesWholeAndStays() throws {
        let folder = FileManager.default.temporaryDirectory.appending(path: "sync-" + UUID().uuidString)
        let file = folder.appending(path: "library.sqlite")
        do {
            let first = try storage(at: file)
            try first.write(["a": "1", "b": "\"Grüße 🌍\"", "c": "[]"])
            try first.write(["a": "2"], remove: ["c", "never there"])
        }
        let again = try storage(at: file)
        XCTAssertEqual(try again.keys(), ["a", "b"])
        XCTAssertEqual(try again.get(["a", "b", "c"]), ["a": "2", "b": "\"Grüße 🌍\""])
    }

    func testStorageBehavesLikeTheExtensions() async throws {
        let result = try await answer(try device(), """
        const seen = [];
        storage.onChanged.addListener((changes) => seen.push(...Object.keys(changes).sort()));
        await storage.set({ one: { n: 1, none: undefined }, two: [2] });
        await storage.set({ one: { n: 1 } });
        const withDefault = await storage.get({ two: 0, three: 3 });
        await storage.remove('two');
        await new Promise((r) => setTimeout(r, 20));
        return { withDefault, rest: await storage.get(null), keys: await storage.getKeys(), seen };
        """)
        XCTAssertEqual(result["withDefault"] as? NSDictionary, ["two": [2], "three": 3])
        XCTAssertEqual(result["keys"] as? [String], ["one"])
        XCTAssertEqual(result["rest"] as? NSDictionary, ["one": ["n": 1]])
        XCTAssertEqual(result["seen"] as? [String], ["one", "two", "two"], "an unchanged value is no change")
    }

    // MARK: - Whole runs

    private static let join = """
    const place = await sync.service.add({ connection: { service: 'webdav', url: 'https://dav.test/files/', username: 'u' }, secret: { password: 'p' },
        place: { mode: 'encrypted', direction: 'twoway', root: 'kaivo-test', passphrase: input.passphrase, ackBackup: true } });
    const run = (await sync.writing.syncNow(place.id))[place.id];
    """

    func testJoinsAPlaceTheExtensionWrote() async throws {
        let made = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(fixture("sync-place").utf8)) as? [String: Any])
        let files = try XCTUnwrap(made["files"] as? [String: String])
        for (path, content) in files { FakeDAV.put("/files/kaivo-test/" + path, try XCTUnwrap(Data(base64Encoded: content))) }
        let phone = try device()
        let result = try await answer(phone, Self.join + """
        const got = await storage.get(['articles:index', 'articles:rec:x1']);
        const expect = JSON.parse(input.expect), h = AISH_APP.hashValue;
        const entry = got['articles:index'][0], bad = [];
        for (const k of ['id', 'url', 'title', 'tags', 'timestamp', 'progress', 'favorite']) if (h(entry[k]) !== h(expect.index[k])) bad.push(k);
        if (got['articles:rec:x1'].content !== expect.record.content) bad.push('content');
        // in whatever order they arrived
        const sorted = (list) => list.slice().sort((a, b) => a.id.localeCompare(b.id));
        const marks = await sync.highlights.all({ dismissed: true });
        if (h(sorted(marks)) !== h(sorted(expect.highlights))) bad.push('highlights ' + JSON.stringify(marks));
        return { run, bad, checked: 9 };
        """, ["passphrase": try XCTUnwrap(made["passphrase"] as? String),
              "expect": String(decoding: try JSONSerialization.data(withJSONObject: try XCTUnwrap(made["expect"])), as: UTF8.self)])
        let run = try XCTUnwrap(result["run"] as? [String: Any])
        XCTAssertNil(run["error"], "\(run)")
        XCTAssertEqual(run["errors"] as? [String], [])
        problems(result)
        XCTAssertEqual(FakeDAV.count("PUT"), 0, "joining a place that is up to date writes nothing")
    }

    func testTwoDevicesAgree() async throws {
        let first = try device(), second = try device()
        let words = ["passphrase": "abandon ability able about above"]
        let began = try await answer(first, """
        await storage.set({
            'articles:index': [{ id: 'a1', url: 'https://example.org/a', title: 'How sleep consolidates memory', tags: ['science'], timestamp: '2026-11-01T10:00:00.000Z', progress: 0.2, archived: false }],
            'articles:rec:a1': { content: '<h2>One</h2><p>Words that stay. Grüße 🌍</p><p>A suggestion of the AI.</p>', summary: '<p>Short.</p>' },
        });
        await sync.highlights.apply([
            { op: 'add', hl: { id: 'hl_mine', url: 'https://example.org/a', text: 'Words that stay.', type: 'user', timestamp: '2026-11-01T10:01:00.000Z' } },
            { op: 'add', hl: { id: 'hl_ai', url: 'https://example.org/a', text: 'A suggestion of the AI.', type: 'ghost', timestamp: '2026-11-01T10:02:00.000Z' } },
        ]);
        """ + Self.join + "return { run, id: place.id };", words)
        let pushed = try XCTUnwrap(began["run"] as? [String: Any])
        XCTAssertNil(pushed["error"], "\(pushed)")
        XCTAssertEqual(pushed["pushed"] as? Int, 3, "\(pushed)")

        let joined = try await answer(second, Self.join + """
        const got = await storage.get(['articles:index', 'articles:rec:a1']);
        return { run, id: place.id, title: got['articles:index'][0].title, content: got['articles:rec:a1'].content,
                 marks: (await sync.highlights.all({ dismissed: true })).map((m) => m.id).sort() };
        """, words)
        XCTAssertEqual(joined["title"] as? String, "How sleep consolidates memory")
        XCTAssertEqual(joined["content"] as? String, "<h2>One</h2><p>Words that stay. Grüße 🌍</p><p>A suggestion of the AI.</p>")
        XCTAssertEqual(joined["marks"] as? [String], ["hl_ai", "hl_mine"])
        let secondPlace = try XCTUnwrap(joined["id"] as? String), firstPlace = try XCTUnwrap(began["id"] as? String)
        let again = "const run = (await sync.writing.syncNow(input.id))[input.id];"

        let written = FakeDAV.count("PUT")
        let quiet = try await answer(second, again + "return run;", ["id": secondPlace])
        XCTAssertEqual(quiet["pushed"] as? Int, 0, "\(quiet)")
        XCTAssertEqual(FakeDAV.count("PUT"), written, "a second run with nothing new writes nothing")

        // read further and turn a suggestion down on the second, as the app will do it
        let changed = try await answer(second, """
        const index = (await storage.get('articles:index'))['articles:index'];
        index[0].progress = 0.9;
        await storage.set({ 'articles:index': index });
        await sync.highlights.apply([{ op: 'dismiss', page: 'https://example.org/a', id: 'hl_ai' }]);
        """ + again + "return run;", ["id": secondPlace])
        XCTAssertEqual(changed["pushed"] as? Int, 2, "\(changed)")

        let arrived = try await answer(first, again + """
        const got = await storage.get(['articles:index', 'articles:rec:a1']);
        return { run, progress: got['articles:index'][0].progress, content: got['articles:rec:a1'].content,
                 dismissed: (await sync.highlights.all({ dismissed: true })).filter((m) => m.dismissed).map((m) => m.id) };
        """, ["id": firstPlace])
        XCTAssertEqual(arrived["progress"] as? Double, 0.9)
        XCTAssertEqual(arrived["dismissed"] as? [String], ["hl_ai"])
        XCTAssertEqual(arrived["content"] as? String, joined["content"] as? String)

        // for the extension to read in turn (scripts/sync-compat.mjs check)
        if let folder = ProcessInfo.processInfo.environment["KAIVO_SYNC_OUT"] {
            let out = URL(fileURLWithPath: folder)
            try FakeDAV.write(below: "/files/kaivo-test/", to: out)
            let expect: [String: Any] = ["title": "How sleep consolidates memory", "progress": 0.9, "tags": ["science"], "content": joined["content"] ?? "",
                                         "highlights": [["hl_ai", "A suggestion of the AI.", true], ["hl_mine", "Words that stay.", false]]]
            try JSONSerialization.data(withJSONObject: expect).write(to: out.deletingLastPathComponent().appending(path: "expect.json"))
        }
    }
}

/// A WebDAV server in memory, as far as the sync store talks to one.
final class FakeDAV: URLProtocol {
    private static let lock = NSLock()
    private static var files: [String: (data: Data, etag: String)] = [:]
    private static var folders: Set<String> = ["/files"]
    private static var requests: [(method: String, path: String)] = []
    private static var version = 0

    static func reset() { lock.withLock { files = [:]; folders = ["/files"]; requests = []; version = 0 } }
    static var paths: [String] { lock.withLock { requests.map(\.path) } }
    static func count(_ method: String) -> Int { lock.withLock { requests.filter { $0.method == method }.count } }

    static func put(_ path: String, _ data: Data) {
        lock.withLock {
            var folder = (path as NSString).deletingLastPathComponent
            while folder.count > 1 { folders.insert(folder); folder = (folder as NSString).deletingLastPathComponent }
            version += 1
            files[path] = (data, "v\(version)")
        }
    }

    static func write(below prefix: String, to folder: URL) throws {
        for (path, file) in lock.withLock({ files }) where path.hasPrefix(prefix) {
            let url = folder.appending(path: String(path.dropFirst(prefix.count)))
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try file.data.write(to: url)
        }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        let url = request.url!, method = request.httpMethod ?? "GET"
        var path = url.path(percentEncoded: false)
        while path.count > 1 && path.hasSuffix("/") { path.removeLast() }
        Self.lock.withLock { Self.requests.append((method, path)) }
        if path.hasPrefix("/moved") {
            let response = HTTPURLResponse(url: url, statusCode: 302, httpVersion: nil, headerFields: ["Location": "https://dav.test/elsewhere/"])!
            client?.urlProtocol(self, wasRedirectedTo: URLRequest(url: URL(string: "https://dav.test/elsewhere/")!), redirectResponse: response)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocolDidFinishLoading(self)
            return
        }
        guard request.value(forHTTPHeaderField: "authorization") == "Basic " + Data("u:p".utf8).base64EncodedString() else { return reply(401) }
        let parent = (path as NSString).deletingLastPathComponent
        let body = Self.body(of: request)
        let (status, headers, data): (Int, [String: String], Data) = Self.lock.withLock {
            switch method {
            case "MKCOL":
                if Self.folders.contains(path) { return (405, [:], Data()) }
                guard Self.folders.contains(parent) else { return (409, [:], Data()) }
                Self.folders.insert(path)
                return (201, [:], Data())
            case "PUT":
                guard Self.folders.contains(parent) else { return (409, [:], Data()) }
                let old = Self.files[path]
                if request.value(forHTTPHeaderField: "if-none-match") == "*" && old != nil { return (412, [:], Data()) }
                if let wanted = request.value(forHTTPHeaderField: "if-match"), wanted != old.map({ "\"\($0.etag)\"" }) { return (412, [:], Data()) }
                Self.version += 1
                Self.files[path] = (body, "v\(Self.version)")
                return (old == nil ? 201 : 204, ["ETag": "\"v\(Self.version)\""], Data())
            case "GET":
                guard let file = Self.files[path] else { return (404, [:], Data()) }
                return (200, ["ETag": "\"\(file.etag)\""], file.data)
            case "DELETE":
                return (Self.files.removeValue(forKey: path) == nil ? 404 : 204, [:], Data())
            case "PROPFIND":
                let isFolder = Self.folders.contains(path)
                guard isFolder || Self.files[path] != nil else { return (404, [:], Data()) }
                func entry(_ href: String, _ inner: String) -> String { "<d:response><d:href>\(href)</d:href><d:propstat><d:prop>\(inner)</d:prop></d:propstat></d:response>" }
                var list = entry(path + "/", "<d:resourcetype><d:collection/></d:resourcetype>")
                if request.value(forHTTPHeaderField: "depth") == "1" {
                    for (name, file) in Self.files where (name as NSString).deletingLastPathComponent == path {
                        list += entry(name, "<d:getetag>\"\(file.etag)\"</d:getetag><d:getcontentlength>\(file.data.count)</d:getcontentlength><d:resourcetype/>")
                    }
                }
                return (207, ["Content-Type": "application/xml"], Data("<?xml version=\"1.0\"?><d:multistatus xmlns:d=\"DAV:\">\(list)</d:multistatus>".utf8))
            default:
                return (405, [:], Data())
            }
        }
        reply(status, headers, data)
    }

    private func reply(_ status: Int, _ headers: [String: String] = [:], _ data: Data = Data()) {
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: headers)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    private static func body(of request: URLRequest) -> Data {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open()
        defer { stream.close() }
        var data = Data(), chunk = [UInt8](repeating: 0, count: 16 * 1024)
        while true {
            let read = stream.read(&chunk, maxLength: chunk.count)
            if read <= 0 { return data }
            data.append(contentsOf: chunk[0 ..< read])
        }
    }
}
