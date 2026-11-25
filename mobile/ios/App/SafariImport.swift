import Foundation

/// Turns what Safari handed over into library articles.
enum SafariImport {
    /// The article in the app. What the reader did here (further read, own highlights) is kept.
    static func article(_ inbox: InboxArticle, existing: Article?) -> Article {
        var passages = blocks(inbox.content, article: inbox.id)
        if passages.isEmpty { passages = existing?.passages.map { Passage(kind: $0.kind, text: $0.text, image: $0.image) } ?? [] }
        let paragraphs = passages.filter { $0.kind != .image }.map(\.text)
        // the reader's own marks win over the AI's suggestions for the same words
        let here = existing?.passages.flatMap { passage in passage.marks.filter { !$0.ai }.map { passage.words(of: $0) } } ?? []
        for text in inbox.highlights.filter({ !$0.ai }).map(\.text) + here { mark(text, ai: false, in: &passages) }
        for suggestion in inbox.highlights where suggestion.ai { mark(suggestion.text, ai: true, in: &passages) }

        let words = inbox.words > 0 ? inbox.words : Library.words(in: paragraphs.joined(separator: " "))
        return Article(id: existing?.id ?? "safari-" + inbox.id,
                       title: inbox.title,
                       host: URL(string: inbox.url)?.host() ?? inbox.url,
                       tags: inbox.tags.isEmpty ? existing?.tags ?? [] : inbox.tags.filter { !$0.hasPrefix("🌐") },   // the language mark is no topic
                       words: words,
                       savedAt: FeedParser.parseDate(inbox.savedAt) ?? existing?.savedAt ?? .now,
                       progress: max(inbox.progress, existing?.progress ?? 0),
                       passages: passages,
                       summary: HTMLText.plain(inbox.summary).components(separatedBy: "\n\n").filter { !$0.isEmpty },
                       link: inbox.url,
                       safariID: inbox.id)
    }

    /// Paragraphs and pictures in the order of the page.
    static func blocks(_ html: String, article id: String) -> [Passage] {
        guard let re = try? NSRegularExpression(pattern: "<img\\b[^>]*>", options: [.caseInsensitive]) else { return [] }
        var blocks: [Passage] = []
        var last = html.startIndex
        func addText(_ part: Substring) {
            blocks += HTMLText.plain(String(part)).components(separatedBy: "\n\n").filter { !$0.isEmpty }.map { Passage(kind: .text, text: $0) }
        }
        for match in re.matches(in: html, range: NSRange(html.startIndex..., in: html)) {
            guard let range = Range(match.range, in: html) else { continue }
            addText(html[last..<range.lowerBound])
            last = range.upperBound
            let tag = String(html[range])
            let source = HTMLText.decodeEntities(FeedParser.firstGroup("\\ssrc\\s*=\\s*[\"']([^\"']+)[\"']", in: tag) ?? "")
            let alt = HTMLText.decodeEntities(FeedParser.firstGroup("\\salt\\s*=\\s*\"([^\"]*)\"", in: tag) ?? "")
            if source.hasPrefix("kaivo-image:"), let number = Int(source.dropFirst("kaivo-image:".count)) {
                blocks.append(Passage(kind: .image, text: alt, image: "images/\(id)/\(number)"))
            } else if source.hasPrefix("https://") {
                blocks.append(Passage(kind: .image, text: alt, image: source))
            }
        }
        addText(html[last...])
        return blocks
    }

    /// Marks these words in the first paragraph that holds them, unless something is marked there already.
    static func mark(_ text: String, ai: Bool, in passages: inout [Passage]) {
        let wanted = text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        guard !wanted.isEmpty else { return }
        for index in passages.indices where passages[index].kind == .text {
            let range = (passages[index].text as NSString).range(of: wanted)
            if range.location == NSNotFound { continue }
            if passages[index].marks.allSatisfy({ NSIntersectionRange($0.range, range).length == 0 }) {
                passages[index].marks.append(Mark(start: range.location, length: range.length, ai: ai))
                passages[index].marks.sort { $0.start < $1.start }
            }
            return
        }
    }
}
