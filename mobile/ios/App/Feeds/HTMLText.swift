import Foundation

/// Feed text is often (escaped) HTML: drops scripts and tags, keeps paragraphs and list bullets, decodes entities.
enum HTMLText {
    static let named: [String: String] = [
        "nbsp": " ", "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "mdash": "—", "ndash": "–", "hellip": "…",
        "lsquo": "‘", "rsquo": "’", "ldquo": "“", "rdquo": "”", "laquo": "«", "raquo": "»", "copy": "©", "reg": "®", "euro": "€",
        "auml": "ä", "ouml": "ö", "uuml": "ü", "Auml": "Ä", "Ouml": "Ö", "Uuml": "Ü", "szlig": "ß", "eacute": "é", "egrave": "è",
        "bull": "•", "middot": "·", "trade": "™", "times": "×", "deg": "°",
    ]

    static func plain(_ html: String) -> String {
        if html.isEmpty { return "" }
        var t = html
        if t.contains("<") {
            let r = FeedParser.replace
            t = r("<(script|style|noscript|svg|iframe|head)\\b.*?</\\1\\s*>", t, " ")
            t = r("<\\s*br\\s*/?>", t, "\n")
            t = r("<\\s*li\\b[^>]*>", t, "\n• ")
            t = r("<\\s*/?\\s*(p|div|h[1-6]|ul|ol|blockquote|pre|table|tr|section|article|figure|figcaption)\\b[^>]*>", t, "\n\n")
            t = r("<[^>]*>", t, "")
        }
        t = decodeEntities(t).replacingOccurrences(of: "\r", with: "")
        t = t.split(separator: "\n", omittingEmptySubsequences: false)
            .map { $0.split(whereSeparator: { $0 == " " || $0 == "\t" || $0 == "\u{00A0}" || $0 == "\u{200B}" }).joined(separator: " ") }
            .joined(separator: "\n")
        return FeedParser.replace("\n{3,}", in: t, with: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func decodeEntities(_ text: String) -> String {
        guard text.contains("&"), let re = try? NSRegularExpression(pattern: "&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z]{2,8});") else { return text }
        var out = ""
        var last = text.startIndex
        for m in re.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
            guard let whole = Range(m.range, in: text), let group = Range(m.range(at: 1), in: text) else { continue }
            out += text[last..<whole.lowerBound]
            let g = String(text[group])
            if g.hasPrefix("#") {
                let code = g.hasPrefix("#x") ? UInt32(g.dropFirst(2), radix: 16) : UInt32(g.dropFirst())
                out += code.flatMap(Unicode.Scalar.init).map { String(Character($0)) } ?? String(text[whole])
            } else {
                out += named[g] ?? String(text[whole])
            }
            last = whole.upperBound
        }
        return out + text[last...]
    }
}
