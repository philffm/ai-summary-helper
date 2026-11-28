import CryptoKit
import Foundation

/// Between the library as it is stored (the extension's shapes: an index entry and a record per article, highlights per
/// page) and the articles the screens show. Text is taken apart into paragraphs only here.
enum LibraryRecords {
    /// A highlight as stored (plugin/src/modules/highlightRecords.js).
    struct Highlight: Decodable, Equatable {
        struct Quote: Decodable, Equatable {
            var prefix: String?
            var suffix: String?
        }
        var id: String?
        var url: String
        var text: String
        var type: String
        var dismissed: Bool?
        var quote: Quote?
        var ai: Bool { type == "ghost" }
    }

    /// What only the app knows about an article. Never synced.
    struct Extra: Codable, Equatable {
        var paper: Paper?
        var pending: Pending?
        /// Handed over by the Safari extension.
        var safari: Bool?
        /// The source shown, where it is not the one of the address.
        var host: String?
        /// A summary written here for an article of the synced library, which does not take it yet.
        var summary: String?
    }

    static let context = 32   // characters around a highlight, as plugin/src/content/anchor.js keeps them

    /// The library files everything by address; an article without one gets this stand-in, which is never shown.
    static func address(without id: String) -> String { "https://" + placeholder + "/" + id }
    private static let placeholder = "local.kaivo.invalid"

    // MARK: - Reading

    /// nil for what is no article of the list: a feed's stub, an archived one, a broken entry.
    static func article(entry: [String: Any], record: [String: Any], highlights: [Highlight], extra: Extra?,
                        pictures: URL = SharedStore.directory) -> Article? {
        guard let id = entry["id"] as? String, !flag(entry["feedStub"]), !flag(entry["archived"]) else { return nil }
        let stored = entry["url"] as? String ?? ""
        let link = URL(string: stored)?.host() == placeholder ? "" : stored
        let content = record["content"] as? String ?? ""
        var passages = SafariImport.blocks(inPlace(content, article: id, below: pictures), article: id)
        // plain text without any tags: its paragraphs as they are
        if passages.isEmpty && !content.isEmpty { passages = paragraphs(content).map { Passage(text: $0) } }
        for index in passages.indices { passages[index].id = uuid("\(id)/\(index)") }
        mark(highlights, in: &passages)
        let counted = (entry["contentWordCount"] as? NSNumber)?.intValue ?? 0
        let summary = extra?.summary ?? record["summary"] as? String ?? entry["summary"] as? String ?? ""
        return Article(id: id,
                       title: entry["title"] as? String ?? link,
                       host: extra?.host ?? URL(string: link)?.host() ?? link,
                       // the language mark the extension keeps among the tags is no topic
                       tags: (entry["tags"] as? [String] ?? []).filter { !$0.hasPrefix("🌐") },
                       words: counted > 0 ? counted : Library.words(in: passages.map(\.text).joined(separator: " ")),
                       savedAt: (entry["timestamp"] as? String).flatMap(FeedParser.parseDate) ?? .distantPast,
                       progress: min(1, max(0, (entry["progress"] as? NSNumber)?.doubleValue ?? 0)),
                       passages: passages,
                       summary: paragraphs(HTMLText.plain(summary)),
                       summaryHTML: summary.isEmpty ? nil : summary,
                       link: link,
                       safariID: extra?.safari == true ? id : nil,
                       paper: extra?.paper,
                       pending: extra?.pending)
    }

    private static func flag(_ value: Any?) -> Bool { (value as? NSNumber)?.boolValue ?? false }
    private static func paragraphs(_ text: String) -> [String] { text.components(separatedBy: "\n\n").filter { !$0.isEmpty } }

    /// The same for the same text, so that a paragraph keeps its identity when the library is read again.
    static func uuid(_ text: String) -> UUID {
        let b = Array(SHA256.hash(data: Data(text.utf8)).prefix(16))
        return UUID(uuid: (b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]))
    }

    /// Puts each highlight on its words. Where they stand more than once, the surroundings decide (as in the browser).
    /// The reader's own marks come first; one that would lie on another is left out.
    static func mark(_ highlights: [Highlight], in passages: inout [Passage]) {
        for highlight in highlights.filter({ $0.dismissed != true }).sorted(by: { !$0.ai && $1.ai }) {
            let wanted = highlight.text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
            guard !wanted.isEmpty else { continue }
            var best: (passage: Int, range: NSRange, score: Double)?
            for index in passages.indices where passages[index].kind == .text {
                let text = passages[index].text as NSString
                var from = 0
                while from < text.length {
                    let range = text.range(of: wanted, range: NSRange(location: from, length: text.length - from))
                    if range.location == NSNotFound { break }
                    from = range.location + 1
                    guard passages[index].marks.allSatisfy({ NSIntersectionRange($0.range, range).length == 0 }) else { continue }
                    var score = 0.0
                    if let prefix = highlight.quote?.prefix, !prefix.isEmpty {
                        score += Double(common(before(range, in: text).reversed(), prefix.reversed())) / Double(prefix.count)
                    }
                    if let suffix = highlight.quote?.suffix, !suffix.isEmpty {
                        score += Double(common(after(range, in: text), suffix)) / Double(suffix.count)
                    }
                    if score > best?.score ?? -1 { best = (index, range, score) }
                }
            }
            guard let best else { continue }
            var mark = Mark(start: best.range.location, length: best.range.length, ai: highlight.ai, highlight: highlight.id)
            if let id = highlight.id { mark.id = uuid(id) }
            passages[best.passage].marks.append(mark)
            passages[best.passage].marks.sort { $0.start < $1.start }
        }
    }

    static func before(_ range: NSRange, in text: NSString) -> String {
        let start = max(0, range.location - context)
        return text.substring(with: text.rangeOfComposedCharacterSequences(for: NSRange(location: start, length: range.location - start)))
    }

    static func after(_ range: NSRange, in text: NSString) -> String {
        let end = range.location + range.length
        return text.substring(with: text.rangeOfComposedCharacterSequences(for: NSRange(location: end, length: min(context, text.length - end))))
    }

    private static func common(_ a: some Sequence<Character>, _ b: some Sequence<Character>) -> Int {
        zip(a, b).prefix { $0 == $1 }.count
    }

    // MARK: - Pictures

    private static let inlinePicture = try! NSRegularExpression(pattern: "data:image/(?:jpe?g|png|gif|webp);base64,([A-Za-z0-9+/=]+)", options: .caseInsensitive)

    /// Pictures saved inside the text move into files once; in the text each becomes "kaivo-image:<n>".
    static func inPlace(_ html: String, article id: String, below folder: URL) -> String {
        guard html.contains("data:image/"), SafariInbox.isValid(id: id) else { return html }
        let text = html as NSString
        var out = "", last = 0
        let directory = folder.appending(path: "images/\(id)")
        for (number, match) in inlinePicture.matches(in: html, range: NSRange(location: 0, length: text.length)).enumerated() {
            out += text.substring(with: NSRange(location: last, length: match.range.location - last)) + "kaivo-image:\(number)"
            last = match.range.location + match.range.length
            let file = directory.appending(path: String(number))
            let coded = text.substring(with: match.range(at: 1))
            // the size tells whether the file already holds this picture
            let size = (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? -1
            if size >= 0 && abs(size - coded.utf8.count / 4 * 3) <= 2 { continue }
            guard let data = Data(base64Encoded: coded), SafariInbox.isPicture(data) else { continue }
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try? data.write(to: file, options: .atomic)
        }
        return out + text.substring(from: last)
    }

    /// A picture file as the extension keeps pictures: inside the text.
    static func inline(_ file: URL) -> String? {
        guard let data = try? Data(contentsOf: file), SafariInbox.isPicture(data) else { return nil }
        let head = [UInt8](data.prefix(4))
        let kind = head.starts(with: [0x89, 0x50]) ? "png" : head.starts(with: [0x47, 0x49]) ? "gif" : head.starts(with: [0x52, 0x49]) ? "webp" : "jpeg"
        return "data:image/\(kind);base64," + data.base64EncodedString()
    }

    // MARK: - Writing (only text the app made itself; what came from elsewhere is kept as it came)

    static func escape(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }

    private static func lines(_ text: String) -> String { escape(text).replacingOccurrences(of: "\n", with: "<br>") }

    static func html(_ passages: [Passage], pictures: URL = SharedStore.directory) -> String {
        passages.map { passage in
            if passage.kind == .image {
                let source = passage.image ?? ""
                let address = source.hasPrefix("https://") ? source : inline(pictures.appending(path: source)) ?? ""
                return address.isEmpty ? "" : "<img src=\"\(escape(address))\" alt=\"\(escape(passage.text))\">"
            }
            guard let level = passage.heading else { return "<p>\(lines(passage.text))</p>" }
            return "<h\(level + 1)>\(lines(passage.text))</h\(level + 1)>"
        }.joined()
    }

    static func summaryHTML(_ summary: [String]) -> String { summary.map { "<p>\(lines($0))</p>" }.joined() }

    /// As the extension writes it: "2026-11-01T10:00:00.000Z".
    static func timestamp(_ date: Date) -> String { Date.ISO8601FormatStyle(includingFractionalSeconds: true).format(date) }

    /// A highlight on its way into the library.
    static func new(_ mark: Mark, in passage: Passage, id: String, at date: Date = .now) -> [String: Any] {
        let text = passage.text as NSString
        return ["id": id, "text": passage.words(of: mark), "ai": mark.ai, "timestamp": timestamp(date),
                "prefix": before(mark.range, in: text), "suffix": after(mark.range, in: text)]
    }

    static func newHighlightID() -> String { "hl_app_" + UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: "") }

    /// An article made in the app (saved from a feed, shared to it, or from the library the app kept before), as the
    /// library takes it over.
    static func package(_ article: Article, id: String? = nil, pictures: URL = SharedStore.directory) -> [String: Any] {
        let id = id ?? article.id
        var entry: [String: Any] = ["id": id, "url": article.link.isEmpty ? address(without: id) : article.link, "title": article.title, "tags": article.tags,
                                    "timestamp": timestamp(article.savedAt), "progress": article.progress]
        if article.words > 0 { entry["contentWordCount"] = article.words }
        var record: [String: Any] = [:]
        if !article.passages.isEmpty { record["content"] = html(article.passages, pictures: pictures) }
        if !article.summary.isEmpty { record["summary"] = summaryHTML(article.summary) }
        let marks = article.passages.flatMap { passage in
            passage.marks.map { new($0, in: passage, id: $0.highlight ?? newHighlightID(), at: article.savedAt) }
        }
        return ["entry": entry, "record": record, "highlights": marks]
    }
}
