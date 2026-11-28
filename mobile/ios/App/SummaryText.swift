import Foundation

/// A summary as the extension writes it (headings, paragraphs and lists, sometimes with the reader's own questions),
/// taken apart for the screen. Only words and their emphasis come through: no links, pictures or scripts, since the text
/// was written by a model from whatever stood on a page.
enum SummaryText {
    struct Block: Identifiable, Equatable {
        enum Kind: Equatable {
            case heading, paragraph
            /// A point of a list; with its number in a numbered one.
            case item(Int?)
        }
        let id: Int
        var kind: Kind
        var text: AttributedString
    }

    /// The lines of a summary written in the app, or of a sample.
    static func blocks(lines: [String]) -> [Block] {
        lines.enumerated().map { Block(id: $0.offset, kind: .paragraph, text: AttributedString($0.element)) }
    }

    static func blocks(html: String) -> [Block] {
        // plain text: its paragraphs as they are
        guard html.range(of: "<[A-Za-z/!]", options: .regularExpression) != nil else {
            return blocks(lines: HTMLText.decodeEntities(html).components(separatedBy: "\n\n")
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })
        }
        let clean = FeedParser.replace("<(script|style|noscript|svg|iframe|head)\\b.*?</\\1\\s*>",
                                       in: FeedParser.replace("<!--.*?(-->|$)", in: html, with: " "), with: " ")
        guard let tokens = try? NSRegularExpression(pattern: "<[^<>]*>|[^<]+|<") else { return [] }

        var result: [Block] = []
        var text = AttributedString()
        var kind = Block.Kind.paragraph
        var bold = 0, italic = 0
        /// One entry per open list: the next number of a numbered one, nil for bullets.
        var lists: [Int?] = []
        var inItem = false

        func lastCharacter() -> Character? { text.characters.last }
        func flush() {
            while let last = lastCharacter(), last.isWhitespace { text.characters.removeLast() }
            if !text.characters.isEmpty {
                result.append(Block(id: result.count, kind: kind, text: text))
                // a second paragraph of the same point is no second point
                if case .item = kind { kind = .paragraph }
            }
            text = AttributedString()
        }
        func add(_ words: String) {
            var piece = words.split(whereSeparator: \.isWhitespace).joined(separator: " ")
            let startsApart = words.first?.isWhitespace == true, endsApart = words.last?.isWhitespace == true
            if piece.isEmpty {
                if startsApart, let last = lastCharacter(), !last.isWhitespace { text.append(AttributedString(" ")) }
                return
            }
            if startsApart, let last = lastCharacter(), !last.isWhitespace { piece = " " + piece }
            if endsApart { piece += " " }
            var run = AttributedString(piece)
            var intent: InlinePresentationIntent = []
            if bold > 0 { intent.insert(.stronglyEmphasized) }
            if italic > 0 { intent.insert(.emphasized) }
            if !intent.isEmpty { run.inlinePresentationIntent = intent }
            text.append(run)
        }

        for match in tokens.matches(in: clean, range: NSRange(clean.startIndex..., in: clean)) {
            guard let range = Range(match.range, in: clean) else { continue }
            let token = String(clean[range])
            guard token.count > 1, token.hasPrefix("<"), token.hasSuffix(">") else {
                add(HTMLText.decodeEntities(token))
                continue
            }
            let closing = token.hasPrefix("</")
            let name = token.dropFirst(closing ? 2 : 1).prefix { $0.isLetter || $0.isNumber }.lowercased()
            switch name {
            case "b", "strong": bold = max(0, bold + (closing ? -1 : 1))
            case "i", "em": italic = max(0, italic + (closing ? -1 : 1))
            case "br": if !text.characters.isEmpty { text.append(AttributedString("\n")) }
            case "td", "th": if !closing && !text.characters.isEmpty { add(" · ") }
            case "ul", "ol":
                flush()
                if closing { _ = lists.popLast() } else { lists.append(name == "ol" ? 1 : nil) }
                kind = .paragraph
            case "li":
                flush()
                inItem = !closing
                if closing {
                    kind = .paragraph
                } else {
                    let number = lists.last ?? nil
                    kind = .item(number)
                    if let number { lists[lists.count - 1] = number + 1 }
                }
            case "h1", "h2", "h3", "h4", "h5", "h6":
                flush()
                kind = closing ? .paragraph : .heading
            case "p", "div", "blockquote", "pre", "table", "tr", "section", "article", "figure", "figcaption", "details", "summary":
                // the paragraph inside a point belongs to the point
                if inItem && !closing && text.characters.isEmpty { break }
                flush()
                if !inItem { kind = .paragraph }
            default: break
            }
        }
        flush()
        return result
    }
}
