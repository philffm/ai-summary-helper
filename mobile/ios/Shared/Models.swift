import Foundation

/// A subscription, in the shape of the encrypted feed sync (url, title, tags, updatedAt in ms, removed), so syncing the
/// list later needs no migration. A removed feed stays as a tombstone, as in the extension and the Android app.
struct Feed: Codable, Identifiable, Hashable {
    var url: String
    var title: String = ""
    var tags: [String] = []
    var updatedAt: Int64
    var removed: Bool = false
    var id: String { url }
    var name: String { title.isEmpty ? (URL(string: url)?.host() ?? url) : title }
}

/// One entry of a feed. `body` is plain text with blank lines between paragraphs: what the feed carries, often a teaser.
struct FeedItem: Codable, Identifiable, Hashable {
    var id: String
    var title: String
    var link: String
    var published: Date?
    var author: String = ""
    var summary: String = ""
    var body: String = ""
    /// The address of a podcast episode's sound; nil for everything else (and for items stored before podcasts were read).
    var audio: String?
}

struct StoredItem: Codable, Hashable {
    var item: FeedItem
    var read: Bool = false
}

/// What this device knows about one feed; never synced.
struct FeedState: Codable, Hashable {
    var items: [StoredItem] = []
    var lastFetched: Date?
    var etag: String = ""
    var modified: String = ""
    var failed: Bool = false
}

/// An article in the library, shaped like the extension's (title, host, tags, words, date).
struct Article: Codable, Identifiable, Hashable {
    let id: String
    var title: String
    var host: String
    var tags: [String]
    var words: Int
    var savedAt: Date
    /// 0 = not opened, 1 = read to the end.
    var progress: Double = 0
    var passages: [Passage] = []
    var summary: [String] = []
    /// The summary as it is stored, with its headings and lists; nil where only its lines are known.
    var summaryHTML: String?
    var link: String = ""
    /// The id the Safari extension knows it by, when it came from there.
    var safariID: String?
    /// What a research paper says about itself.
    var paper: Paper?
    /// What the app still has to do for an article that was shared to it.
    var pending: Pending?
    /// The questions about it that were saved to the notes in the browser.
    var questions: [Question]?
    /// The summary was written by the model on this device.
    var summaryOnDevice: Bool?

    var minutes: Int { max(1, Int((Double(words) / 220).rounded(.up))) }
    var minutesLeft: Int { max(1, Int((Double(minutes) * (1 - progress)).rounded(.up))) }
    var url: URL? { URL(string: link.isEmpty ? "https://\(host)" : link) }
    var isUnread: Bool { progress == 0 }
    /// The longest passage the reader marked: a single marked word is a poor thing to quote.
    var firstHighlight: String? {
        passages.flatMap { passage in passage.marks.filter { !$0.ai }.map { passage.words(of: $0) } }.max { $0.count < $1.count }
    }

    /// "7 min" and "yesterday" in the reader's language, from the system's formatters.
    var duration: String { Self.format(minutes: minutes) }
    var durationLeft: String { Self.format(minutes: minutesLeft) }
    var age: String { Dates.relativeDay(savedAt) }

    private static func format(minutes: Int) -> String {
        Duration.seconds(minutes * 60).formatted(.units(allowed: [.minutes], width: .abbreviated))
    }
}

/// A question about an article and its answer, as the browser keeps them with it.
struct Question: Codable, Identifiable, Hashable {
    var id: String
    var question: String
    var answer: String
    var date: String
}

struct Paper: Codable, Hashable {
    var authors: [String] = []
    var journal: String = ""
    var doi: String = ""
}

struct Pending: Codable, Hashable {
    var text: Bool
    var summary: Bool
}

/// Marked words inside a paragraph. Positions count UTF-16 units, as the system's text views do.
struct Mark: Codable, Identifiable, Hashable {
    var id = UUID()
    var start: Int
    var length: Int
    /// Suggested by the AI and not yet kept.
    var ai: Bool = false
    /// The id the library stores it under.
    var highlight: String?
    var range: NSRange { NSRange(location: start, length: length) }
}

struct Passage: Codable, Identifiable, Hashable {
    enum Kind: String, Codable { case text, image }
    var id = UUID()
    var kind: Kind
    /// The paragraph, or a picture's description.
    var text: String
    /// A picture: an https address, or a file in the shared folder.
    var image: String?
    /// 1 to 3 for a heading, nil for running text.
    var heading: Int?
    /// In reading order, never overlapping.
    var marks: [Mark] = []

    init(kind: Kind = .text, text: String, image: String? = nil, marks: [Mark] = [], heading: Int? = nil) {
        self.kind = kind
        self.text = text
        self.image = image
        self.marks = marks
        self.heading = heading
    }

    /// A paragraph that is marked as a whole.
    static func marked(_ text: String, ai: Bool = false) -> Passage {
        Passage(text: text, marks: [Mark(start: 0, length: (text as NSString).length, ai: ai)])
    }

    // libraries written before words could be marked had the kinds "highlight" and "ghost" for a whole paragraph
    private enum CodingKeys: String, CodingKey { case id, kind, text, image, marks, heading }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        text = try c.decode(String.self, forKey: .text)
        image = try c.decodeIfPresent(String.self, forKey: .image)
        heading = try c.decodeIfPresent(Int.self, forKey: .heading)
        marks = try c.decodeIfPresent([Mark].self, forKey: .marks) ?? []
        let raw = try c.decode(String.self, forKey: .kind)
        kind = raw == Kind.image.rawValue ? .image : .text
        if marks.isEmpty && (raw == "highlight" || raw == "ghost") { marks = [Mark(start: 0, length: (text as NSString).length, ai: raw == "ghost")] }
    }

    func words(of mark: Mark) -> String {
        let all = text as NSString
        guard mark.start >= 0, mark.length >= 0, mark.start + mark.length <= all.length else { return "" }
        return all.substring(with: mark.range)
    }

    /// Grows a selection to whole words, and drops the space or punctuation around it. nil when it holds no word.
    func wholeWords(_ selection: NSRange) -> NSRange? {
        let all = text as NSString
        var first: Int?, end = 0
        all.enumerateSubstrings(in: NSRange(location: 0, length: all.length), options: [.byWords, .substringNotRequired]) { _, word, _, _ in
            if word.location < selection.location + selection.length && word.location + word.length > selection.location {
                if first == nil { first = word.location }
                end = word.location + word.length
            }
        }
        return first.map { NSRange(location: $0, length: end - $0) }
    }

    /// Marks the words of the selection as the reader's own; own marks it touches become one, suggestions under it go.
    mutating func highlight(_ selection: NSRange) {
        guard var range = wholeWords(selection) else { return }
        for mark in marks where !mark.ai && NSIntersectionRange(mark.range, range).length > 0 { range = NSUnionRange(range, mark.range) }
        marks.removeAll { NSIntersectionRange($0.range, range).length > 0 }
        marks.append(Mark(start: range.location, length: range.length))
        marks.sort { $0.start < $1.start }
    }

    /// Removes the reader's marks the selection touches.
    mutating func unmark(_ selection: NSRange) {
        marks.removeAll { !$0.ai && NSIntersectionRange($0.range, selection).length > 0 }
    }

    func isMarked(_ selection: NSRange) -> Bool { marks.contains { !$0.ai && NSIntersectionRange($0.range, selection).length > 0 } }

    mutating func resolve(suggestion id: Mark.ID, keep: Bool) {
        guard let i = marks.firstIndex(where: { $0.id == id }) else { return }
        if keep { marks[i].ai = false } else { marks.remove(at: i) }
    }
}

enum Dates {
    /// "today", "yesterday", "3 days ago".
    static func relativeDay(_ date: Date, now: Date = .now, calendar: Calendar = .current) -> String {
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: now)).day ?? 0
        let formatter = RelativeDateTimeFormatter()
        formatter.dateTimeStyle = .named
        return formatter.localizedString(from: DateComponents(day: -max(0, days)))
    }
}
