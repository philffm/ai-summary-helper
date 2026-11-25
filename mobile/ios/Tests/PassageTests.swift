import XCTest
@testable import Kaivo

final class PassageTests: XCTestCase {
    private func marked(_ p: Passage) -> [String] { p.marks.map { p.words(of: $0) } }

    func testSelectionBecomesWholeWords() {
        var p = Passage(text: "Sleep moves what you read, today. Über Nacht.")
        p.highlight((p.text as NSString).range(of: "ves wh"))
        XCTAssertEqual(marked(p), ["moves what"])
        p.highlight((p.text as NSString).range(of: ", tod"))
        XCTAssertEqual(marked(p), ["moves what", "today"])
        p.highlight((p.text as NSString).range(of: "hat you read, to"))
        XCTAssertEqual(marked(p), ["moves what you read, today"], "marks that touch become one")
        p.highlight(NSRange(location: (p.text as NSString).range(of: "Üb").location, length: 1))
        XCTAssertEqual(marked(p).last, "Über")
        p.highlight((p.text as NSString).range(of: ". "))
        XCTAssertEqual(p.marks.count, 2, "no word, no mark")
    }

    func testUnmarkAndSuggestions() {
        var p = Passage.marked("one two three", ai: true)
        XCTAssertFalse(p.isMarked(NSRange(location: 0, length: 3)))
        p.unmark(NSRange(location: 0, length: 3))
        XCTAssertEqual(p.marks.count, 1, "a suggestion is answered, not unmarked")
        p.highlight(NSRange(location: 4, length: 3))
        XCTAssertEqual(marked(p), ["two"], "the reader's mark replaces the suggestion")
        p.unmark(NSRange(location: 5, length: 1))
        XCTAssertTrue(p.marks.isEmpty)
    }

    func testOldLibrariesAreRead() throws {
        let old = #"[{"id":"6F9619FF-8B86-D011-B42D-00C04FC964FF","kind":"highlight","text":"Kept"},{"kind":"ghost","text":"Maybe"},{"kind":"text","text":"Plain"}]"#
        let passages = try JSONDecoder().decode([Passage].self, from: Data(old.utf8))
        XCTAssertEqual(passages.map(\.kind), [.text, .text, .text])
        XCTAssertEqual(passages.map { $0.marks.map(\.ai) }, [[false], [true], []])
        XCTAssertEqual(try JSONDecoder().decode([Passage].self, from: JSONEncoder().encode(passages)), passages)
    }
}
