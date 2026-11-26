import Foundation

/// A small, tolerant reader for RSS 2.0, RSS 1.0 (RDF), Atom and JSON Feed, after the Android app's FeedXml.kt: nothing is
/// ever fetched while parsing (the DOCTYPE is dropped, external entities are off), and size and depth are limited.
enum FeedParser {
    static let maxItems = 100
    private static let maxBody = 20_000

    struct Parsed {
        var title: String
        var items: [FeedItem]
    }

    static func parse(_ data: Data, contentType: String = "", base: URL? = nil) -> Parsed? {
        let text = decode(data, contentType: contentType).trimmingCharacters(in: CharacterSet(charactersIn: "\u{FEFF} \n\r\t"))
        if text.hasPrefix("{") { return parseJSON(text, base: base) }
        guard let root = XMLTree.parse(prepare(text)) else { return nil }
        switch root.local {
        case "rss":
            guard let channel = root.child("channel") else { return nil }
            return build(channel, items: channel.all("item"), atom: false, base: base)
        case "rdf":
            guard let channel = root.child("channel") else { return nil }
            return build(channel, items: root.all("item"), atom: false, base: base)
        case "feed":
            return build(root, items: root.all("entry"), atom: true, base: base)
        default:
            return nil
        }
    }

    /// Feed addresses a web page announces (<link rel="alternate" type="application/rss+xml" …>).
    static func discover(_ html: String, base: URL) -> [URL] {
        var found: [URL] = []
        for tag in matches("<link\\b[^>]*>", in: html) {
            let attr = { (name: String) in firstGroup("\\b\(name)\\s*=\\s*[\"']([^\"']*)[\"']", in: tag) ?? "" }
            let type = attr("type").lowercased()
            guard attr("rel").lowercased().contains("alternate"), type.contains("rss") || type.contains("atom") || type.contains("feed+json") else { continue }
            if let url = resolve(HTMLText.decodeEntities(attr("href")), base: base), !found.contains(url) { found.append(url) }
        }
        return found
    }

    static func resolve(_ reference: String, base: URL?) -> URL? {
        let r = reference.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !r.isEmpty, let url = URL(string: r, relativeTo: base)?.absoluteURL, url.scheme == "https" || url.scheme == "http" else { return nil }
        return url
    }

    // MARK: - XML

    private static func build(_ head: XMLTree, items nodes: [XMLTree], atom: Bool, base: URL?) -> Parsed {
        let items = nodes.prefix(maxItems).compactMap { n -> FeedItem? in
            if atom {
                return item(guid: n.text("id"), title: n.text("title"), link: atomLink(n, base: base),
                            date: n.text("published", "updated"), author: n.child("author")?.text("name") ?? "",
                            summary: n.text("summary"), full: n.child("content")?.allText ?? "")
            }
            let guid = n.text("guid", "identifier")
            var link = resolve(n.text("link"), base: base)?.absoluteString ?? ""
            if link.isEmpty { link = atomLink(n, base: base) }
            if link.isEmpty, guid.hasPrefix("http") { link = resolve(guid, base: base)?.absoluteString ?? "" }
            let full = n.text("encoded").isEmpty ? n.text("content") : n.text("encoded")
            let author = n.text("creator", "author")
            // RSS: <enclosure>; Atom: <link rel="enclosure">
            let enclosures = n.all("enclosure").map { ($0.attributes["url"], $0.attributes["type"]) }
                + n.all("link").filter { $0.attributes["rel"] == "enclosure" }.map { ($0.attributes["href"], $0.attributes["type"]) }
            let audio = enclosures.compactMap { address, type in Self.audio(resolve(address ?? "", base: base), type: type) }.first
            return item(guid: guid, title: n.text("title"), link: link, date: n.text("pubdate", "date", "published", "updated"),
                        author: author, summary: n.text("description", "summary"), full: full, audio: audio)
        }
        return Parsed(title: HTMLText.plain(head.text("title")), items: items)
    }

    private static func atomLink(_ node: XMLTree, base: URL?) -> String {
        let links = node.all("link")
        let pick = links.first { ($0.attributes["rel"] ?? "alternate") == "alternate" && $0.attributes["href"] != nil }
        return resolve(pick?.attributes["href"] ?? "", base: base)?.absoluteString ?? ""
    }

    /// An attachment that is sound, over https.
    private static func audio(_ url: URL?, type: String?) -> String? {
        guard let url, url.scheme == "https",
              type?.hasPrefix("audio/") == true || ["mp3", "m4a", "aac", "ogg"].contains(url.pathExtension.lowercased()) else { return nil }
        return url.absoluteString
    }

    private static func item(guid: String, title: String, link: String, date: String, author: String, summary: String, full: String, audio: String? = nil) -> FeedItem? {
        let body = String(HTMLText.plain(full.isEmpty ? summary : full).prefix(maxBody))
        let short = String(HTMLText.plain(summary.isEmpty ? full : summary).split(whereSeparator: \.isWhitespace).joined(separator: " ").prefix(400))
        let shown = HTMLText.plain(title).isEmpty ? String(short.prefix(80)) : HTMLText.plain(title)
        if shown.isEmpty && link.isEmpty { return nil }
        let id = guid.isEmpty ? (link.isEmpty ? shown + date : link) : guid
        return FeedItem(id: String(id.prefix(300)), title: shown, link: link, published: parseDate(date),
                        author: String(HTMLText.plain(author).prefix(120)), summary: short, body: body, audio: audio)
    }

    // MARK: - JSON Feed

    private static func parseJSON(_ text: String, base: URL?) -> Parsed? {
        guard let object = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
              let list = object["items"] as? [[String: Any]] else { return nil }
        let items = list.prefix(maxItems).compactMap { entry -> FeedItem? in
            let s = { (key: String) in entry[key] as? String ?? "" }
            let authors = entry["authors"] as? [[String: Any]]
            let sound = (entry["attachments"] as? [[String: Any]])?.compactMap { file in
                Self.audio(resolve(file["url"] as? String ?? "", base: base), type: file["mime_type"] as? String)
            }.first
            return item(guid: s("id"), title: s("title"), link: resolve(s("url"), base: base)?.absoluteString ?? "",
                        date: s("date_published"), author: authors?.first?["name"] as? String ?? "",
                        summary: s("summary").isEmpty ? s("content_text") : s("summary"),
                        full: s("content_html").isEmpty ? s("content_text") : s("content_html"), audio: sound)
        }
        return Parsed(title: HTMLText.plain(object["title"] as? String ?? ""), items: items)
    }

    // MARK: - text

    static func decode(_ data: Data, contentType: String) -> String {
        let head = String(decoding: data.prefix(200), as: UTF8.self)
        let declared = (firstGroup("charset=[\"']?([A-Za-z0-9_-]+)", in: contentType)
            ?? firstGroup("<\\?xml[^>]*encoding=[\"']([A-Za-z0-9_-]+)[\"']", in: head))?.lowercased()
        if let declared, declared != "utf-8" {
            let cf = CFStringConvertIANACharSetNameToEncoding(declared as CFString)
            if cf != kCFStringEncodingInvalidId,
               let text = String(data: data, encoding: String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(cf))) { return text }
        }
        return String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) ?? ""
    }

    /// Makes real-world XML digestible for the strict system parser: no DOCTYPE, no encoding declaration (the text is
    /// already decoded), HTML's named entities replaced, and a stray "&" escaped.
    private static func prepare(_ text: String) -> String {
        var t = replace("<!DOCTYPE[^\\[>]*(\\[[^\\]]*\\])?\\s*>", in: text, with: "")
        t = replace("^<\\?xml[^>]*\\?>", in: t, with: "")
        for (name, value) in HTMLText.named where !["amp", "lt", "gt", "quot", "apos"].contains(name) {
            t = t.replacingOccurrences(of: "&\(name);", with: value)
        }
        return replace("&(?!(amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)", in: t, with: "&amp;")
    }

    static func parseDate(_ raw: String) -> Date? {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return nil }
        let iso = ISO8601DateFormatter()
        for options: ISO8601DateFormatter.Options in [[.withInternetDateTime], [.withInternetDateTime, .withFractionalSeconds], [.withFullDate]] {
            iso.formatOptions = options
            if let date = iso.date(from: s) { return date }
        }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        for pattern in ["EEE, d MMM yyyy HH:mm:ss Z", "EEE, d MMM yyyy HH:mm:ss zzz", "EEE, d MMM yyyy HH:mm Z", "EEE, d MMM yyyy HH:mm zzz",
                        "d MMM yyyy HH:mm:ss Z", "d MMM yyyy HH:mm:ss zzz"] {
            f.dateFormat = pattern
            if let date = f.date(from: s) { return date }
        }
        return nil
    }

    // MARK: - regex helpers

    static func replace(_ pattern: String, in text: String, with template: String) -> String {
        guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive, .dotMatchesLineSeparators]) else { return text }
        return re.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: template)
    }
    private static func matches(_ pattern: String, in text: String) -> [String] {
        guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive, .dotMatchesLineSeparators]) else { return [] }
        return re.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap { Range($0.range, in: text).map { String(text[$0]) } }
    }
    static func firstGroup(_ pattern: String, in text: String) -> String? {
        guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
              let m = re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)), let r = Range(m.range(at: 1), in: text) else { return nil }
        return String(text[r])
    }
}

/// The element tree of an XML document. Names are lower-cased; `local` drops a namespace prefix.
final class XMLTree {
    let name: String
    let attributes: [String: String]
    private(set) var children: [XMLTree] = []
    private(set) var ownText = ""

    init(name: String, attributes: [String: String] = [:]) {
        self.name = name
        self.attributes = attributes
    }

    var local: String { name.split(separator: ":").last.map(String.init) ?? name }
    /// Text of this element and everything inside it (Atom's xhtml content).
    var allText: String { ownText + children.map(\.allText).joined() }
    func child(_ names: String...) -> XMLTree? { children.first { names.contains($0.name) || names.contains($0.local) } }
    func all(_ wanted: String) -> [XMLTree] { children.filter { $0.name == wanted || $0.local == wanted } }
    func text(_ names: String...) -> String {
        for n in names {
            if let c = children.first(where: { $0.name == n || $0.local == n }) {
                let value = c.ownText.trimmingCharacters(in: .whitespacesAndNewlines)
                if !value.isEmpty { return value }
                if let inner = c.children.first { return inner.ownText.trimmingCharacters(in: .whitespacesAndNewlines) }
            }
        }
        return ""
    }

    static func parse(_ text: String) -> XMLTree? {
        let builder = Builder()
        let parser = XMLParser(data: Data(text.utf8))
        parser.shouldResolveExternalEntities = false
        parser.delegate = builder
        parser.parse()   // a broken tail still leaves what was read
        return builder.root.children.first
    }

    private final class Builder: NSObject, XMLParserDelegate {
        let root = XMLTree(name: "#root")
        private lazy var stack: [XMLTree] = [root]
        private var nodes = 0

        func parser(_ parser: XMLParser, didStartElement element: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String]) {
            nodes += 1
            guard nodes <= 200_000, stack.count < 64 else { parser.abortParsing(); return }
            let node = XMLTree(name: element.lowercased(), attributes: Dictionary(attributes.map { ($0.key.lowercased(), $0.value) }, uniquingKeysWith: { a, _ in a }))
            stack[stack.count - 1].children.append(node)
            stack.append(node)
        }
        func parser(_ parser: XMLParser, didEndElement element: String, namespaceURI: String?, qualifiedName: String?) {
            if stack.count > 1 { stack.removeLast() }
        }
        func parser(_ parser: XMLParser, foundCharacters string: String) {
            if stack[stack.count - 1].ownText.count < 200_000 { stack[stack.count - 1].ownText += string }
        }
        func parser(_ parser: XMLParser, foundCDATA block: Data) {
            self.parser(parser, foundCharacters: String(decoding: block, as: UTF8.self))
        }
    }
}
