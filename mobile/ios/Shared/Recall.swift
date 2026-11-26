import Foundation

/// A highlight with one word left out.
struct Cloze: Equatable {
    var before: String
    var answer: String
    var after: String
}

/// A highlight that can be asked for.
struct RecallCard: Equatable {
    var articleID: String
    var title: String
    var text: String
    var key: String { articleID + "\n" + text }
}

/// When a highlight is asked again: the day (days since 1970) and how often it was known in a row.
struct Memo: Codable, Equatable {
    var due: Int
    var step: Int
}

/// "Remember?": one of your own highlights with a word missing. No AI: the word is one of the longest in the passage.
/// Known ones come back after 2, 4, 8 … 64 days, the others the next day. The same rules as Wake.kt on Android.
enum Recall {
    private static let common: Set<String> = [
        "about", "after", "again", "their", "there", "these", "those", "which", "while", "would", "could", "should", "being", "where", "other", "because", "before", "between",
        "nicht", "einen", "einer", "eines", "einem", "dieser", "diese", "dieses", "werden", "wurde", "haben", "hatte", "können", "könnte", "müssen", "sollte", "zwischen", "während",
    ]
    private static let waits = [2, 4, 8, 16, 32, 64]
    private static let word = try? NSRegularExpression(pattern: "[\\p{L}\\p{N}][\\p{L}\\p{M}\\p{N}'’-]*")

    private static func index(_ seed: Int, _ count: Int) -> Int { ((seed % count) + count) % count }

    /// Nil when the passage is too short to ask about. The same `seed` leaves out the same word.
    static func cloze(_ text: String, seed: Int) -> Cloze? {
        let matches = word?.matches(in: text, range: NSRange(text.startIndex..., in: text)) ?? []
        let words = matches.compactMap { Range($0.range, in: text) }
        guard words.count >= 5 else { return nil }
        let longest = words.enumerated()
            .filter { _, range in
                let w = text[range]
                return w.count >= 5 && !common.contains(w.lowercased()) && w.contains(where: \.isLetter)
            }
            .sorted { (text[$1.element].count, $0.offset) < (text[$0.element].count, $1.offset) }   // longest first, then reading order
            .prefix(3).map(\.element)
        guard !longest.isEmpty else { return nil }
        let range = longest[index(seed, longest.count)]
        return Cloze(before: String(text[..<range.lowerBound]), answer: String(text[range]), after: String(text[range.upperBound...]))
    }

    /// A highlight that is due: one never asked comes before one asked earlier. Nil when none is due.
    static func pick(_ cards: [RecallCard], memos: [String: Memo], day: Int, seed: Int) -> RecallCard? {
        let usable = cards.filter { cloze($0.text, seed: seed) != nil && (memos[$0.key]?.due ?? 0) <= day }
        let fresh = usable.filter { memos[$0.key] == nil }
        let pool = fresh.isEmpty ? usable : fresh
        return pool.isEmpty ? nil : pool[index(seed, pool.count)]
    }

    static func answer(_ memo: Memo?, knew: Bool, day: Int) -> Memo {
        guard knew else { return Memo(due: day + 1, step: 0) }
        let step = memo?.step ?? 0
        return Memo(due: day + waits[min(step, waits.count - 1)], step: step + 1)
    }

    static func today(_ date: Date = .now) -> Int {
        let local = date.timeIntervalSince1970 + Double(TimeZone.current.secondsFromGMT(for: date))
        return Int((local / 86400).rounded(.down))
    }
}
