import XCTest
@testable import Kaivo

final class SummaryTextTests: XCTestCase {
    private func read(_ html: String) -> [String] {
        SummaryText.blocks(html: html).map { block in
            let words = String(block.text.characters)
            switch block.kind {
            case .heading: return "# " + words
            case .paragraph: return words
            case .item(let number): return (number.map { "\($0). " } ?? "• ") + words
            }
        }
    }

    func testASummaryAsTheExtensionWritesIt() {
        let html = """
        <div>
          <h2>Sleep &amp; memory</h2>
          <p>The brain goes <strong>over the day</strong>
             <em>again</em>.</p>
          <ul><li>First point</li><li><p>Second, in a paragraph of its own</p></li></ul>
          <ol><li>One</li><li>Two<br>with a break</li></ol>
        </div>
        <!-- TAGS: sleep, memory --><!-- GHOST_HIGHLIGHTS: ["never shown"] -->
        <section class="aish-qa"><h3>From your question</h3><p><strong>Why?</strong></p><p>Because.</p></section>
        """
        XCTAssertEqual(read(html), ["# Sleep & memory", "The brain goes over the day again.", "• First point", "• Second, in a paragraph of its own",
                                    "1. One", "2. Two\nwith a break", "# From your question", "Why?", "Because."])
    }

    func testEmphasisIsKeptAndNothingElseComesThrough() throws {
        let blocks = SummaryText.blocks(html: "<p>a <b>bold</b> <a href=\"https://example.org\">link</a><script>alert(1)</script><img src=x></p><table><tr><td>x</td><td>y</td></tr></table>")
        XCTAssertEqual(blocks.map { String($0.text.characters) }, ["a bold link", "x · y"])
        let text = try XCTUnwrap(blocks.first?.text)
        XCTAssertEqual(text.runs.filter { $0.inlinePresentationIntent == .stronglyEmphasized }.map { String(text[$0.range].characters).trimmingCharacters(in: .whitespaces) }, ["bold"])
        XCTAssertTrue(text.runs.allSatisfy { $0.link == nil })
    }

    func testPlainWordsAndBrokenMarkup() {
        XCTAssertEqual(read("One.\n\nTwo &lt;three&gt;."), ["One.", "Two <three>."])
        XCTAssertEqual(read("<p>open and never closed <!-- a comment without an end"), ["open and never closed"])
        XCTAssertEqual(read("<p>2 < 3</p>"), ["2 < 3"])
        XCTAssertEqual(read(""), [])
    }
}
