import Foundation
import Observation

/// The reader's own model server (Ollama, LM Studio or anything else that speaks their common interface).
struct ModelServer: Equatable {
    var address: String
    var model: String

    static var saved: ModelServer {
        ModelServer(address: UserDefaults.standard.string(forKey: "summaryServer") ?? "",
                    model: UserDefaults.standard.string(forKey: "summaryModel") ?? "")
    }

    func save() {
        UserDefaults.standard.set(address, forKey: "summaryServer")
        UserDefaults.standard.set(model, forKey: "summaryModel")
    }

    /// "192.168.1.20:11434", "mac.local:1234/v1" and full addresses all lead to the same place.
    var base: URL? {
        var text = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if !text.contains("://") { text = "http://" + text }
        while text.hasSuffix("/") { text.removeLast() }
        for tail in ["/chat/completions", "/api/chat", "/v1"] where text.hasSuffix(tail) { text.removeLast(tail.count) }
        guard let url = URL(string: text), SharedLinks.isWeb(url) else { return nil }
        return url
    }

    var isReady: Bool { base != nil && !model.isEmpty }
}

enum SummaryError: LocalizedError {
    case noServer, unreachable(String), refused(Int), signIn, empty

    var errorDescription: String? {
        switch self {
        case .noServer: String(localized: "Set up a model server first.")
        case .unreachable(let why): String(localized: "The model server cannot be reached: \(why)")
        case .refused(let code): String(localized: "The model server answered with error \(code).")
        case .signIn: String(localized: "The key or sign-in from Safari was not accepted. Open Kaivo in Safari once, then try again.")
        case .empty: String(localized: "The model gave no usable summary.")
        }
    }
}

/// Where one summary is asked for: the connection set in Safari, or the reader's own server.
struct ModelEndpoint: Equatable {
    enum Format { case openai, gemini }

    var url: URL
    var model: String
    var headers: [String: String] = [:]
    var format = Format.openai
    /// Said to a model on one's own server only: some hosted models refuse it, and the extension does not send it.
    var temperature: Double?
    var fromSafari = false
    /// Who gets the text, as the reader knows it.
    var name: String

    /// Addresses meaning "this device": what the extension keeps for the computer leads nowhere on a phone.
    static func pointsAtItself(_ url: URL) -> Bool { ["localhost", "127.0.0.1", "::1", "0.0.0.0"].contains(url.host()?.lowercased() ?? "") }

    /// The same request the extension makes (bg/aiComplete.js): its address as it is.
    static func safari(_ connection: ModelConnection, onDevice: Bool = !isSimulator) -> ModelEndpoint? {
        guard let url = URL(string: connection.url), SharedLinks.isWeb(url), !connection.model.isEmpty,
              !(onDevice && pointsAtItself(url)) else { return nil }
        let format: Format = connection.format == "gemini" ? .gemini : .openai
        var headers: [String: String] = [:]
        if !connection.key.isEmpty {
            // a key never travels unencrypted, except to a server in the reader's own network
            if url.scheme?.lowercased() != "https" && !isLocal(url) { return nil }
            if format == .gemini { headers["x-goog-api-key"] = connection.key } else { headers["Authorization"] = "Bearer " + connection.key }
        }
        if connection.mode == "cloud" {
            if !connection.installId.isEmpty { headers["X-Install-ID"] = connection.installId }
            if connection.region == "prefer-eu" { headers["X-AISH-Region"] = "prefer-eu" }
            headers["X-AISH-Feature"] = "summary"
        }
        return ModelEndpoint(url: url, model: connection.model, headers: headers, format: format, fromSafari: true, name: connection.name)
    }

    static func own(_ server: ModelServer) -> ModelEndpoint? {
        guard server.isReady, let base = server.base else { return nil }
        return ModelEndpoint(url: base.appending(path: "v1/chat/completions"), model: server.model, temperature: 0.3,
                             name: base.host() ?? server.address)
    }

    /// Safari's connection unless the reader chose the own server; whichever works when the other cannot.
    static func choose(safari: ModelEndpoint?, own: ModelEndpoint?, preferOwn: Bool) -> ModelEndpoint? {
        preferOwn ? own ?? safari : safari ?? own
    }

    static var current: ModelEndpoint? {
        choose(safari: SafariModel.load().flatMap { safari($0) }, own: own(.saved), preferOwn: UserDefaults.standard.bool(forKey: "summaryOwnServer"))
    }

    /// This device or the reader's own network.
    static func isLocal(_ url: URL) -> Bool {
        let host = url.host()?.lowercased() ?? ""
        if host.contains(":") {
            return pointsAtItself(url) || host.hasPrefix("fe80:") || host.range(of: "^f[cd][0-9a-f]{2}:", options: .regularExpression) != nil
        }
        return pointsAtItself(url) || host.hasSuffix(".local") || !host.contains(".")
            || host.range(of: "^(10\\.|192\\.168\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|100\\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\\.)[0-9.]+$", options: .regularExpression) != nil
    }

    private static var isSimulator: Bool {
        #if targetEnvironment(simulator)
        true
        #else
        false
        #endif
    }

    func request(system: String, user: String) throws -> URLRequest {
        let body: [String: Any]
        switch format {
        case .gemini:
            body = ["contents": [["role": "user", "parts": [["text": system + "\n\n" + user]]]]]
        case .openai:
            var all: [String: Any] = ["model": model, "stream": false,
                                      "messages": [["role": "system", "content": system], ["role": "user", "content": user]]]
            if let temperature { all["temperature"] = temperature }
            body = all
        }
        var request = URLRequest(url: url, timeoutInterval: 240)
        request.httpMethod = "POST"
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        return request
    }

    /// The words of an answer, whichever way it is written: one object, or a stream of them (some services stream even
    /// when asked not to).
    static func text(of data: Data) -> String {
        func words(_ object: [String: Any]) -> String {
            let choice = (object["choices"] as? [[String: Any]])?.first
            if let text = (choice?["message"] as? [String: Any])?["content"] as? String { return text }
            if let text = (choice?["delta"] as? [String: Any])?["content"] as? String { return text }
            if let text = (object["message"] as? [String: Any])?["content"] as? String { return text }
            if let text = choice?["text"] as? String { return text }
            let parts = ((object["candidates"] as? [[String: Any]])?.first?["content"] as? [String: Any])?["parts"] as? [[String: Any]]
            return parts?.compactMap { $0["text"] as? String }.joined() ?? ""
        }
        func object(_ text: Substring) -> [String: Any]? { try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any] }
        let raw = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        let reply: String
        if let one = object(raw[...]) {
            reply = words(one)
        } else {
            reply = raw.split(whereSeparator: \.isNewline).compactMap { line -> String? in
                var line = line
                if line.hasPrefix("data:") { line = line.dropFirst(5).drop { $0 == " " } }
                return object(line).map(words)
            }.joined()
        }
        // some models think aloud first
        return reply.replacingOccurrences(of: "(?s)<think>.*?</think>", with: "", options: .regularExpression)
    }
}

struct ModelClient {
    var session: URLSession = .shared

    private func answer(_ request: URLRequest, fromSafari: Bool) async throws -> Data {
        do {
            let (data, response) = try await session.data(for: request)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 200
            if fromSafari && (code == 401 || code == 403) { throw SummaryError.signIn }
            guard (200..<300).contains(code) else { throw SummaryError.refused(code) }
            return data
        } catch let error as URLError {
            throw SummaryError.unreachable(error.localizedDescription)
        }
    }

    /// What an own server offers.
    func models(of server: ModelServer) async throws -> [String] {
        struct List: Decodable { struct Model: Decodable { var id: String }; var data: [Model] }
        guard let base = server.base else { throw SummaryError.noServer }
        let data = try await answer(URLRequest(url: base.appending(path: "v1/models"), timeoutInterval: 15), fromSafari: false)
        return try JSONDecoder().decode(List.self, from: data).data.map(\.id).sorted()
    }

    func ask(_ endpoint: ModelEndpoint, system: String, user: String) async throws -> String {
        ModelEndpoint.text(of: try await answer(endpoint.request(system: system, user: user), fromSafari: endpoint.fromSafari))
    }
}

/// Who may receive text. A server in the reader's own network is no third party; anyone else needs a yes first
/// (App Review 5.1.2(i)). The yes is per host, kept on this device, and can be withdrawn under Model.
struct AIConsent {
    var store = UserDefaults.standard
    private static let key = "aiConsent"

    var hosts: [String] { store.stringArray(forKey: Self.key) ?? [] }

    func isNeeded(for endpoint: ModelEndpoint) -> Bool {
        guard !ModelEndpoint.isLocal(endpoint.url), let host = endpoint.url.host()?.lowercased() else { return false }
        return !hosts.contains(host)
    }

    func allow(_ endpoint: ModelEndpoint) {
        guard let host = endpoint.url.host()?.lowercased(), !hosts.contains(host) else { return }
        store.set(hosts + [host], forKey: Self.key)
    }

    func withdraw(_ host: String) { store.set(hosts.filter { $0 != host }, forKey: Self.key) }
}

extension ModelEndpoint {
    /// Who receives the text, in words a person can judge.
    var recipient: String {
        let host = url.host()?.lowercased() ?? ""
        if host == "api.byphil.eu" { return String(localized: "byPhil Cloud, which passes it on to OpenRouter and the company behind the chosen model") }
        return name.isEmpty || name == host ? host : "\(name) (\(host))"
    }
}

/// The same instructions and limits as the Android app (PageSummary.kt).
enum SummaryPrompt {
    static let chunk = 6000, maxChunks = 5, minText = 200, maxPassages = 5
    static let marker = "KEY SENTENCES:"
    private static let language = "Reply in the language of the page."
    private static let copy = "copy 3 to 5 sentences that carry the main points word for word, exactly as written in the text and in the text's own language, one per line, without numbering or quotation marks."

    static let plain = "You summarise a web page for a reader who is short of time. \(language) Start with one sentence saying what the page is about, then give 3 to 5 short key points, one per line, each starting with '- '. Use only what the text says: no opinions, no added facts, no preamble, no markdown other than the leading '- '. Keep it under 150 words."
    static let system = plain + " After the summary write a line saying exactly \(marker) and below it \(copy)"
    static let part = "Condense this part of a longer web page into its key facts, as at most 5 short lines starting with '- '. Use only what the text says. Keep the language of the text. After the lines write a line saying exactly \(marker) and below it copy 1 or 2 sentences of this part that carry its main points word for word, one per line, without numbering or quotation marks."
    static let join = "These are notes from consecutive parts of one web page. Write the summary of the whole page: one sentence on what it is about, then 3 to 5 key points, one per line, each starting with '- '. Use only the notes; no preamble. Keep it under 150 words. Reply in the language of the notes."

    /// The text cut into model-sized parts at paragraph or sentence ends, at most `maxChunks`.
    static func parts(_ text: String, size: Int = chunk) -> [String] {
        var rest = Substring(text.trimmingCharacters(in: .whitespacesAndNewlines)), out: [String] = []
        while !rest.isEmpty && out.count < maxChunks {
            if rest.count <= size { out.append(String(rest)); break }
            let window = rest.prefix(size)
            var cut = window.endIndex
            for end in ["\n", ". ", "! ", "? ", "。", " "] {
                if let found = window.range(of: end, options: .backwards),
                   window.distance(from: window.startIndex, to: found.upperBound) > size / 2 { cut = found.upperBound; break }
            }
            out.append(rest[..<cut].trimmingCharacters(in: .whitespacesAndNewlines))
            rest = rest[cut...]
        }
        return out
    }

    /// The summary, and the copied sentences after the marker line.
    static func split(_ reply: String) -> (String, String) {
        // small models also write the first sentence on the marker's own line
        guard let marker = reply.range(of: "(?im)^[\\s*#>_-]*key\\s+sentences?\\s*(:|$)[\\s*_]*", options: .regularExpression) else { return (reply, "") }
        return (String(reply[..<marker.lowerBound]), String(reply[marker.upperBound...]))
    }

    /// The summary as lines, without the markdown a model adds.
    static func lines(_ reply: String) -> [String] {
        reply.split(whereSeparator: \.isNewline).map {
            String($0).replacingOccurrences(of: "^\\s*([-*•]|#{1,6})\\s+", with: "", options: .regularExpression)
                .replacingOccurrences(of: "[*_`]+", with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespaces)
        }.filter { $0.count > 2 }
    }

    /// The copied sentences that really are in one of the paragraphs.
    static func sentences(_ copied: String, in paragraphs: [String]) -> [String] {
        var out: [String] = []
        // one per line was asked for; several in a line are taken apart
        let lines = copied.split(whereSeparator: \.isNewline).flatMap { line -> [String] in
            let all = String(line)
            if paragraphs.contains(where: { $0.contains(all.trimmingCharacters(in: .whitespaces)) }) { return [all] }
            var parts: [String] = []
            all.enumerateSubstrings(in: all.startIndex..., options: .bySentences) { part, _, _, _ in if let part { parts.append(part) } }
            return parts
        }
        for line in lines {
            let text = line.replacingOccurrences(of: "^[\\s\\-*•0-9.)\"“”'‘’]+|[\"“”'‘’\\s]+$", with: "", options: .regularExpression)
            if text.count >= 20 && text.count <= 400 && !out.contains(text) && paragraphs.contains(where: { $0.contains(text) }) { out.append(text) }
            if out.count >= maxPassages { break }
        }
        return out
    }

    /// One request for a short text; for a long one a request per part and one to join the notes.
    static func summarize(title: String, paragraphs: [String], ask: (String, String) async throws -> String,
                          progress: (Int, Int) async -> Void) async throws -> (lines: [String], sentences: [String]) {
        let body = paragraphs.joined(separator: "\n")
        guard body.count >= minText else { throw SummaryError.empty }
        let parts = parts(title + "\n\n" + body)
        var copied = "", summary = ""
        if parts.count == 1 {
            await progress(1, 1)
            (summary, copied) = split(try await ask(system, parts[0]))
            // a model that skipped the summary and only copied sentences is asked again for the summary alone
            if self.lines(summary).joined().count < 20 { summary = split(try await ask(plain, parts[0])).0 }
        } else {
            var notes: [String] = []
            for (i, text) in parts.enumerated() {
                await progress(i + 1, parts.count + 1)
                let (note, sentences) = split(try await ask(part, text))
                notes.append(note)
                copied += "\n" + sentences
            }
            await progress(parts.count + 1, parts.count + 1)
            summary = split(try await ask(join, notes.joined(separator: "\n"))).0
        }
        let lines = lines(summary)
        guard lines.joined().count >= 20 else { throw SummaryError.empty }
        return (lines, sentences(copied, in: paragraphs))
    }
}

/// The summaries being written, one article at a time; they go on when the reader moves elsewhere.
@MainActor
@Observable
final class Summaries {
    private(set) var running: Article.ID?
    private(set) var step = (at: 0, of: 0)
    var failure: String?
    /// Waiting for the reader's yes before anything is sent.
    var question: Question?
    var consent = AIConsent()
    @ObservationIgnored var endpoint: () -> ModelEndpoint? = { ModelEndpoint.current }
    private var queue: [Article.ID] = []

    struct Question: Equatable {
        var article: Article.ID
        var endpoint: ModelEndpoint
    }

    /// `asking` is false when no one is looking (a shared link): then nothing is sent and the summary stays asked for.
    func summarize(_ id: Article.ID, in library: Library, asking: Bool = true) {
        guard running != id, !queue.contains(id) else { return }
        if let endpoint = endpoint(), consent.isNeeded(for: endpoint) {
            if asking { question = Question(article: id, endpoint: endpoint) }
            return
        }
        queue.append(id)
        guard running == nil else { return }
        Task { await work(library) }
    }

    func answer(_ question: Question, allow: Bool, in library: Library) {
        self.question = nil
        if allow {
            consent.allow(question.endpoint)
            summarize(question.article, in: library)
        } else {
            // not asked again by itself; the Summarize button stays
            library.nothingPending(question.article)
        }
    }

    func isWaiting(_ id: Article.ID) -> Bool { running == id || queue.contains(id) }

    private func work(_ library: Library) async {
        while let id = queue.first {
            queue.removeFirst()
            guard let article = library.article(id) else { continue }
            running = id
            step = (0, 0)
            // the list of sources of a paper is not what it says
            let skip = PaperSense.references(article.passages) ?? 0..<0
            let paragraphs = article.passages.enumerated().filter { $0.element.kind == .text && !skip.contains($0.offset) }.map(\.element.text)
            let client = ModelClient()
            do {
                guard let endpoint = endpoint() else { throw SummaryError.noServer }
                // the model may have been changed while this waited in line
                guard !consent.isNeeded(for: endpoint) else {
                    running = nil
                    continue
                }
                let result = try await SummaryPrompt.summarize(title: article.title, paragraphs: paragraphs,
                                                               ask: { try await client.ask(endpoint, system: $0, user: $1) },
                                                               progress: { at, of in await MainActor.run { self.step = (at, of) } })
                library.setSummary(id, result.lines, marking: result.sentences)
            } catch {
                failure = error.localizedDescription
            }
            running = nil
        }
    }
}
