import Foundation
import JavaScriptCore
import os

/// Runs the extension's sync modules (app-sync.js) in JavaScriptCore, on the library in `storage`. js/host.js gives them
/// what a browser would; this is its other half. One queue owns the context: calls, timers and the network all come back
/// to it, which also makes it the only writer of the library.
final class SyncHost: @unchecked Sendable {
    struct Failure: Error, CustomStringConvertible {
        let description: String
    }

    private let storage: SyncStoring
    private let queue = DispatchQueue(label: "kaivo.sync", qos: .utility)
    private let context: JSContext
    private let session: URLSession
    private var timers: [Int: DispatchWorkItem] = [:]
    private var requests: [Int: URLSessionDataTask] = [:]
    private var thrown: String?
    private static let logger = Logger(subsystem: "eu.byphil.kaivo", category: "sync")
    private static let maxAnswer = 25 * 1024 * 1024

    /// `pullOnly`: runs only fetch; nothing on the server changes.
    init(storage: SyncStoring, pullOnly: Bool = false, bundle: Bundle = .main, network: URLSessionConfiguration = .ephemeral) throws {
        self.storage = storage
        guard let context = JSContext() else { throw Failure(description: "JavaScript is not available.") }
        self.context = context
        // nothing of the system comes along with a request: no cookies, no cache, no saved logins
        network.httpCookieStorage = nil
        network.httpShouldSetCookies = false
        network.urlCache = nil
        network.urlCredentialStorage = nil
        network.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: network, delegate: NoRedirects(), delegateQueue: nil)
        let sources = try ["host", "app-sync"].map { name -> (String, URL) in
            guard let url = bundle.url(forResource: name, withExtension: "js") else { throw Failure(description: "\(name).js is not in the app.") }
            return (try String(contentsOf: url, encoding: .utf8), url)
        }
        try queue.sync {
            context.exceptionHandler = { [weak self] _, exception in
                let text = exception.map { "\($0) (line \($0.forProperty("line")?.toInt32() ?? 0))" } ?? "unknown error"
                self?.thrown = text
                Self.logger.error("\(text, privacy: .public)")
            }
            context.setObject(makeHost(), forKeyedSubscript: "__host" as NSString)
            for (source, url) in sources { context.evaluateScript(source, withSourceURL: url) }
            context.evaluateScript("var storage = __createStorage(); var sync = AISH_APP.createSync({ storage: storage, log: console.log, engine: { pullOnly: \(pullOnly) } });")
            if let thrown { throw Failure(description: thrown) }
        }
    }

    deinit {
        timers.values.forEach { $0.cancel() }
        session.invalidateAndCancel()
    }

    /// Runs the body of an async JavaScript function. `sync`, `storage` and `AISH_APP` are there, and what is passed in
    /// arrives as `input`. Answers with what the function returns, as JSON.
    func run(_ body: String, input: [String: Any] = [:]) async throws -> Data {
        let given = String(decoding: try JSONSerialization.data(withJSONObject: input), as: UTF8.self)
        return try await withCheckedThrowingContinuation { continuation in
            queue.async { [self] in
                var finished = false
                let finish = { (result: Result<Data, Error>) in
                    guard !finished else { return }
                    finished = true
                    continuation.resume(with: result)
                }
                let resolve: @convention(block) (String) -> Void = { finish(.success(Data($0.utf8))) }
                let reject: @convention(block) (JSValue) -> Void = { finish(.failure(Failure(description: $0.toString() ?? "unknown error"))) }
                thrown = nil
                let function = context.evaluateScript("(async function (input) {\n\(body)\n})")
                guard thrown == nil, let function else { return finish(.failure(Failure(description: thrown ?? "The script could not be read."))) }
                let parsed = context.objectForKeyedSubscript("JSON").invokeMethod("parse", withArguments: [given])
                let promise = function.call(withArguments: [parsed as Any])
                context.evaluateScript("(function (p, ok, no) { p.then(function (v) { ok(JSON.stringify(v === undefined ? null : v)); }).catch(no); })")
                    .call(withArguments: [promise as Any, unsafeBitCast(resolve, to: AnyObject.self), unsafeBitCast(reject, to: AnyObject.self)])
            }
        }
    }

    // MARK: - What host.js asks of Swift

    private static func data(_ value: JSValue) -> Data? {
        let ref = value.context.jsGlobalContextRef
        guard JSValueGetTypedArrayType(ref, value.jsValueRef, nil) == kJSTypedArrayTypeUint8Array,
              let object = JSValueToObject(ref, value.jsValueRef, nil) else { return nil }
        let count = JSObjectGetTypedArrayByteLength(ref, object, nil)
        guard count > 0 else { return Data() }
        // host.js hands over arrays that own their buffer, from its first byte
        guard let bytes = JSObjectGetTypedArrayBytesPtr(ref, object, nil) else { return nil }
        return Data(bytes: bytes, count: count)
    }

    /// A Uint8Array with these bytes, or null.
    private static func array(_ data: Data?, in context: JSContext) -> JSValue {
        let ref = context.jsGlobalContextRef
        guard let data, let object = JSObjectMakeTypedArray(ref, kJSTypedArrayTypeUint8Array, data.count, nil) else {
            return JSValue(nullIn: context)
        }
        if !data.isEmpty, let bytes = JSObjectGetTypedArrayBytesPtr(ref, object, nil) {
            data.copyBytes(to: bytes.assumingMemoryBound(to: UInt8.self), count: data.count)
        }
        return JSValue(jsValueRef: object, in: context)
    }

    private func makeHost() -> JSValue {
        let host = JSValue(newObjectIn: context)!
        func offer<Block>(_ name: String, _ block: Block) {
            host.setObject(unsafeBitCast(block, to: AnyObject.self), forKeyedSubscript: name as NSString)
        }
        /// A function from bytes to bytes; null where it fails.
        func bytes(_ name: String, _ work: @escaping (Data) -> Data?) {
            let block: @convention(block) (JSValue) -> JSValue = { input in
                Self.array(Self.data(input).flatMap(work), in: input.context)
            }
            offer(name, block)
        }
        bytes("sha256") { SyncPrimitives.sha256($0) }
        bytes("gzip") { SyncPrimitives.gzip($0) }
        bytes("gunzip") { SyncPrimitives.gunzip($0) }

        let hmac: @convention(block) (JSValue, JSValue) -> JSValue = { key, input in
            guard let key = Self.data(key), let data = Self.data(input) else { return Self.array(nil, in: input.context) }
            return Self.array(SyncPrimitives.hmac(key: key, data), in: input.context)
        }
        offer("hmac", hmac)
        let hkdf: @convention(block) (JSValue, JSValue, JSValue, Int) -> JSValue = { master, salt, info, count in
            guard let master = Self.data(master), let salt = Self.data(salt), let data = Self.data(info) else {
                return Self.array(nil, in: info.context)
            }
            return Self.array(SyncPrimitives.hkdf(master: master, salt: salt, info: data, count: count), in: info.context)
        }
        offer("hkdf", hkdf)
        let pbkdf2: @convention(block) (JSValue, JSValue, Int, Int) -> JSValue = { password, salt, iterations, count in
            guard let password = Self.data(password), let data = Self.data(salt) else { return Self.array(nil, in: salt.context) }
            return Self.array(SyncPrimitives.pbkdf2(password: password, salt: data, iterations: iterations, count: count), in: salt.context)
        }
        offer("pbkdf2", pbkdf2)
        let aes: @convention(block) (Bool, JSValue, JSValue, JSValue) -> JSValue = { seal, key, nonce, input in
            guard let key = Self.data(key), let nonce = Self.data(nonce), let data = Self.data(input) else {
                return Self.array(nil, in: input.context)
            }
            let out = seal ? SyncPrimitives.aesGcmSeal(key: key, nonce: nonce, data) : SyncPrimitives.aesGcmOpen(key: key, nonce: nonce, data)
            return Self.array(out, in: input.context)
        }
        offer("aesGcm", aes)
        let random: @convention(block) (Int) -> JSValue = { Self.array(SyncPrimitives.random($0), in: JSContext.current()) }
        offer("random", random)
        let uuid: @convention(block) () -> String = { UUID().uuidString.lowercased() }
        offer("uuid", uuid)

        let utf8: @convention(block) (JSValue) -> String = { String(decoding: Self.data($0) ?? Data(), as: UTF8.self) }
        offer("utf8", utf8)
        let base64: @convention(block) (JSValue) -> String = { (Self.data($0) ?? Data()).base64EncodedString() }
        offer("base64", base64)
        let unbase64: @convention(block) (String) -> JSValue = { text in
            var plain = text.filter { !$0.isWhitespace }
            while plain.count % 4 != 0 { plain += "=" }
            return Self.array(Data(base64Encoded: plain), in: JSContext.current())
        }
        offer("unbase64", unbase64)
        // a name with letters beyond ASCII in the form the network knows it by
        let asciiHost: @convention(block) (String) -> String = { name in
            var parts = URLComponents()
            parts.scheme = "https"
            parts.host = name
            return parts.encodedHost?.lowercased() ?? name.lowercased()
        }
        offer("asciiHost", asciiHost)
        let log: @convention(block) (String, String) -> Void = { level, message in
            // the modules log hosts, status codes and progress, never logins or contents
            if level == "error" { Self.logger.error("\(message, privacy: .public)") } else { Self.logger.info("\(message, privacy: .public)") }
        }
        offer("log", log)

        let after: @convention(block) (Int, Double) -> Void = { [unowned self] id, milliseconds in
            let item = DispatchWorkItem { [weak self] in
                guard let self, timers.removeValue(forKey: id) != nil else { return }
                context.objectForKeyedSubscript("__timer").call(withArguments: [id])
            }
            timers[id] = item
            queue.asyncAfter(deadline: .now() + milliseconds / 1000, execute: item)
        }
        offer("after", after)
        let cancelTimer: @convention(block) (Int) -> Void = { [unowned self] id in timers.removeValue(forKey: id)?.cancel() }
        offer("cancelTimer", cancelTimer)

        let storageGet: @convention(block) ([String]) -> [String: String] = { [unowned self] keys in
            do { return try storage.get(keys) } catch { return fail(error, [:]) }
        }
        offer("storageGet", storageGet)
        let storageKeys: @convention(block) () -> [String] = { [unowned self] in
            do { return try storage.keys() } catch { return fail(error, []) }
        }
        offer("storageKeys", storageKeys)
        let storageWrite: @convention(block) ([String: String], [String]) -> Bool = { [unowned self] set, remove in
            do {
                try storage.write(set, remove: remove)
                return true
            } catch {
                Self.logger.error("\(String(describing: error), privacy: .public)")
                return false
            }
        }
        offer("storageWrite", storageWrite)

        let fetch: @convention(block) (Int, String, String, [String: String], JSValue, JSValue) -> Void = { [unowned self] id, url, method, headers, body, answer in
            request(id, url: url, method: method, headers: headers, body: Self.data(body), answer: answer)
        }
        offer("fetch", fetch)
        let abort: @convention(block) (Int) -> Void = { [unowned self] id in
            // the cancelled task reports back as a failure, which settles the promise
            requests[id]?.cancel()
        }
        offer("abort", abort)
        return host
    }

    /// A library that cannot be read must stop the run: an empty answer would look like an empty library.
    private func fail<Value>(_ error: Error, _ value: Value) -> Value {
        let context = JSContext.current()!
        context.exception = JSValue(newErrorFromMessage: "The library could not be read: \(error)", in: context)
        return value
    }

    private func request(_ id: Int, url: String, method: String, headers: [String: String], body: Data?, answer: JSValue) {
        guard let address = URL(string: url, encodingInvalidCharacters: false) ?? URL(string: url),
              address.scheme == "https" || address.scheme == "http" else {
            answer.call(withArguments: ["Invalid address."])
            return
        }
        var request = URLRequest(url: address)
        request.httpMethod = method
        request.httpBody = body
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        let task = session.dataTask(with: request) { [weak self] data, response, error in
            self?.queue.async {
                guard let self, self.requests.removeValue(forKey: id) != nil else { return }
                guard error == nil, let response = response as? HTTPURLResponse else {
                    answer.call(withArguments: [error?.localizedDescription ?? "No answer."])
                    return
                }
                let data = data ?? Data()
                guard data.count <= Self.maxAnswer else {
                    answer.call(withArguments: ["The answer is too large."])
                    return
                }
                var received: [String: String] = [:]
                for (name, value) in response.allHeaderFields { received["\(name)".lowercased()] = "\(value)" }
                answer.call(withArguments: [NSNull(), response.statusCode, received, Self.array(data, in: self.context)])
            }
        }
        requests[id] = task
        task.resume()
    }
}

/// A redirect is answered as it stands; safeFetch refuses it.
private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
