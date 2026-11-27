import Foundation

/// Turns what Safari handed over into library articles.
enum SafariImport {
    /// What Safari handed over, as the library takes it: text and summary as they came, under the extension's own id.
    static func package(_ inbox: InboxArticle, pictures: URL = SafariInbox.directory) -> [String: Any] {
        var entry: [String: Any] = ["id": inbox.id, "url": inbox.url, "title": inbox.title, "tags": inbox.tags,
                                    "timestamp": inbox.savedAt, "progress": min(1, max(0, inbox.progress))]
        if inbox.words > 0 { entry["contentWordCount"] = inbox.words }
        // the pictures came beside the text: back into it, where the extension keeps them
        var content = inbox.content
        let folder = pictures.appending(path: "images/\(inbox.id)")
        let files = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
        for number in files.compactMap(Int.init).sorted(by: >) {
            guard let picture = LibraryRecords.inline(folder.appending(path: String(number))) else { continue }
            content = content.replacingOccurrences(of: "kaivo-image:\(number)", with: picture)
        }
        let marks = inbox.highlights.map { highlight in
            ["id": LibraryRecords.newHighlightID(), "text": highlight.text, "ai": highlight.ai, "timestamp": inbox.savedAt] as [String: Any]
        }
        return ["entry": entry, "record": ["content": content, "summary": inbox.summary], "highlights": marks, "fresher": true]
    }

    /// Headings, paragraphs and pictures in the order of the page.
    static func blocks(_ html: String, article id: String) -> [Passage] {
        guard let re = try? NSRegularExpression(pattern: "<h([1-6])\\b[^>]*>(.*?)</h\\1\\s*>|<img\\b[^>]*>",
                                                options: [.caseInsensitive, .dotMatchesLineSeparators]) else { return [] }
        var blocks: [Passage] = []
        var last = html.startIndex
        func addText(_ part: Substring) {
            blocks += HTMLText.plain(String(part)).components(separatedBy: "\n\n").filter { !$0.isEmpty }.map { Passage(kind: .text, text: $0) }
        }
        for match in re.matches(in: html, range: NSRange(html.startIndex..., in: html)) {
            guard let range = Range(match.range, in: html) else { continue }
            addText(html[last..<range.lowerBound])
            last = range.upperBound
            if let level = Range(match.range(at: 1), in: html).flatMap({ Int(html[$0]) }), let inner = Range(match.range(at: 2), in: html) {
                let text = HTMLText.plain(String(html[inner])).split(whereSeparator: \.isNewline).joined(separator: " ")
                if !text.isEmpty { blocks.append(Passage(text: text, heading: min(3, max(1, level - 1)))) }
                continue
            }
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
