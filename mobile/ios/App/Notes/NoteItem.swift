import Foundation

/// One thing in "Notes": a note, a highlight of the reader or of the AI (with its comment), or a question about an
/// article that was saved to the notes in the browser.
struct NoteItem: Identifiable, Hashable, Decodable {
    enum Kind: String, Decodable { case note, user, ghost, question }

    var kind: Kind
    /// The note's, the highlight's or the question's id.
    var id: String
    /// The note, the marked words, or the question.
    var text: String
    var tags: [String]?
    var when: String
    var url: String?
    /// The passage a note quotes.
    var quote: String?
    /// What the reader wrote on a highlight.
    var comment: String?
    /// The answer to a question: paragraphs, "- " points and **bold**.
    var answer: String?
    /// Kept on this device only, while a library is joined.
    var here: Bool?
    /// The article it belongs to, where that is in the app.
    var article: String?
    var title: String?

    var date: Date { FeedParser.parseDate(when) ?? .distantPast }
    var isHighlight: Bool { kind == .user || kind == .ghost }

    /// What was written, with its tags as they were typed: for editing.
    var written: String {
        let words = kind == .note ? text : comment ?? ""
        return ([words] + (tags ?? []).map { "#" + $0 }).filter { !$0.isEmpty }.joined(separator: " ")
    }

    /// The four views the extension's "Notes" offers; questions stand with the notes.
    enum Filter: CaseIterable, Identifiable {
        case all, mine, ai, notes
        var id: Self { self }
        func holds(_ kind: Kind) -> Bool {
            switch self {
            case .all: true
            case .mine: kind == .user
            case .ai: kind == .ghost
            case .notes: kind == .note || kind == .question
            }
        }
    }

    /// Newest first, a day at a time.
    static func days(_ items: [NoteItem], calendar: Calendar = .current) -> [(day: Date, items: [NoteItem])] {
        Dictionary(grouping: items) { calendar.startOfDay(for: $0.date) }
            .map { (day: $0.key, items: $0.value.sorted { ($1.when, $0.id) < ($0.when, $1.id) }) }
            .sorted { $0.day > $1.day }
    }

    /// "#todo" at the end of what was typed becomes a tag, as in the browser (noteText.js). For the samples; a real
    /// library does this with the extension's own function.
    static func split(_ input: String) -> (text: String, tags: [String]) {
        var words = input.trimmingCharacters(in: .whitespacesAndNewlines).split(whereSeparator: \.isWhitespace).map(String.init)
        var tags: [String] = []
        while let last = words.last, last.hasPrefix("#"), last.count > 1 {
            tags.insert(String(last.dropFirst()), at: 0)
            words.removeLast()
        }
        return (words.joined(separator: " "), tags)
    }
}
