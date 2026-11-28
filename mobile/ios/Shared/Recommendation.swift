import Foundation

/// A recommendation as it travels: a small web page anyone can read, which carries the same as data for Kaivo. It holds
/// the article's address and title, what the sender adds, and nothing that identifies them beyond the name they give.
struct Recommendation: Codable, Hashable {
    var v = 1
    var url: String
    var title: String
    var note = ""
    /// The name as the sender gives it; nothing checks it.
    var from = ""
    /// Passages the sender marked.
    var marks: [String] = []
    var summary: [String] = []

    /// What the page may weigh, and what each part may hold: it comes from someone else.
    static let maxBytes = 256_000
    private static let meta = "kaivo:recommendation"

    /// Within the limits, and about a web page; nil otherwise.
    func checked() -> Recommendation? {
        guard v == 1, url.count <= 2000, let address = URL(string: url), ["http", "https"].contains(address.scheme?.lowercased() ?? ""),
              address.host() != nil else { return nil }
        func cut(_ text: String, _ most: Int) -> String { String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(most)) }
        var out = self
        out.title = cut(title, 300)
        if out.title.isEmpty { out.title = address.host() ?? url }
        out.note = cut(note, 2000)
        out.from = cut(from, 60).split(whereSeparator: \.isNewline).joined(separator: " ")
        out.marks = marks.prefix(20).map { cut($0, 1000) }.filter { !$0.isEmpty }
        out.summary = summary.prefix(20).map { cut($0, 1000) }.filter { !$0.isEmpty }
        return out
    }

    /// The words the page is written in, in the sender's language.
    struct Words {
        var recommendedBy: String
        var read: String
        var hint: String
    }

    /// The page: readable on its own, without scripts and without anything loaded from elsewhere.
    func page(_ words: Words) -> String {
        func safe(_ text: String) -> String {
            text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
                .replacingOccurrences(of: "\"", with: "&quot;").replacingOccurrences(of: "'", with: "&#39;")
        }
        let coded = JSONEncoder()
        coded.outputFormatting = .sortedKeys
        let data = ((try? coded.encode(self)) ?? Data()).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        var body = "<p class=\"by\">\(safe(words.recommendedBy))</p>\n<h1>\(safe(title))</h1>\n"
        if !note.isEmpty { body += "<p class=\"note\">\(safe(note))</p>\n" }
        for mark in marks { body += "<blockquote>\(safe(mark))</blockquote>\n" }
        if !summary.isEmpty { body += summary.map { "<p>\(safe($0))</p>\n" }.joined() }
        body += "<p><a class=\"read\" href=\"\(safe(url))\">\(safe(words.read))</a></p>\n<p class=\"small\">\(safe(url))</p>\n<p class=\"small\">\(safe(words.hint))</p>"
        return """
        <!doctype html>
        <html><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
        <meta name="\(Self.meta)" content="\(data)">
        <title>\(safe(title))</title>
        <style>
        body{font:17px/1.55 -apple-system,system-ui,sans-serif;max-width:34em;margin:0 auto;padding:28px 20px;color:#111;background:#fff}
        h1{font:700 1.5em/1.25 ui-serif,Georgia,serif}
        .by{color:#0f6675;font-weight:600}
        .note{background:#f2f2f7;border-radius:14px;padding:12px 16px;white-space:pre-wrap}
        blockquote{border-left:3px solid #0f6675;margin:16px 0;padding:2px 0 2px 14px;font-family:ui-serif,Georgia,serif}
        .read{display:inline-block;background:#0f6675;color:#fff;border-radius:24px;padding:12px 24px;text-decoration:none;font-weight:600}
        .small{color:#666;font-size:.8em;word-break:break-all}
        @media (prefers-color-scheme:dark){body{color:#eee;background:#111}.note{background:#222}}
        </style></head><body>
        \(body)
        </body></html>

        """
    }

    /// The recommendation a page carries; nil for any other page, a broken one or one that is too large.
    static func read(_ data: Data) -> Recommendation? {
        guard data.count <= maxBytes, let page = String(data: data, encoding: .utf8),
              let found = page.range(of: "<meta name=\"\(meta)\" content=\"[A-Za-z0-9_-]+\"", options: .regularExpression) else { return nil }
        var code = String(page[found].dropLast().split(separator: "\"").last ?? "")
            .replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while code.count % 4 != 0 { code += "=" }
        guard let json = Data(base64Encoded: code), let read = try? JSONDecoder().decode(Recommendation.self, from: json) else { return nil }
        return read.checked()
    }

    /// A file name from words that may hold anything.
    static func fileName(_ words: String) -> String {
        let clean = words.components(separatedBy: CharacterSet(charactersIn: "/\\:*?\"<>|").union(.controlCharacters)).joined(separator: " ")
            .split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return String(clean.prefix(80)).trimmingCharacters(in: CharacterSet(charactersIn: ". ")) + ".html"
    }
}
