import SwiftUI
import XCTest
@testable import Kaivo

/// The reader's size, typeface, spacing and background.
final class ReaderLookTests: XCTestCase {
    func testNothingChosenLooksAsBefore() {
        let look = ReaderLook()
        let before = UIFontDescriptor.preferredFontDescriptor(withTextStyle: .body,
                                                              compatibleWith: UITraitCollection(preferredContentSizeCategory: .large))
        let font = look.font(.body, system: .large)
        XCTAssertEqual(font, UIFont(descriptor: before.withDesign(.serif)!, size: 0))
        XCTAssertEqual(look.lineSpacing(for: font.pointSize), 4)
        XCTAssertNil(look.ground.page)
        XCTAssertNil(look.ground.scheme)
    }

    func testStepsMoveFromTheSystemSizeAndStopAtItsEnds() {
        let sizes = ReaderLook.steps.map { ReaderLook(step: $0).font(.body, system: .large).pointSize }
        XCTAssertEqual(sizes, [14, 15, 16, 17, 19, 21, 23, 28, 33])
        XCTAssertEqual(ReaderLook(step: -3).size(from: .xSmall), .xSmall)
        XCTAssertEqual(ReaderLook(step: 5).size(from: .accessibility5), .accessibility5)
        XCTAssertEqual(ReaderLook(step: 2).size(from: .xLarge), .xxxLarge)
    }

    func testEveryFaceIsThereRegularAndBold() {
        let expected: [ReaderLook.Face: String] = [.easy: "Atkinson Hyperlegible", .hanken: "Hanken Grotesk"]
        for face in ReaderLook.Face.allCases {
            let look = ReaderLook(face: face)
            let regular = look.font(.body, system: .large), bold = look.font(.body, bold: true, system: .large)
            if let family = expected[face] { XCTAssertEqual(regular.familyName, family, "\(face) is not bundled") }
            XCTAssertEqual(regular.pointSize, 17)
            let words = "Sleep turns what you read today into what you know" as NSString
            XCTAssertGreaterThan(words.size(withAttributes: [.font: bold]).width, words.size(withAttributes: [.font: regular]).width,
                                 "\(face) has no heavier weight")
        }
    }

    func testTheOldTextSizeIsCarriedOver() {
        for (old, step) in [("Small", -1), ("Default", 0), ("Large", 2)] {
            let name = "reader-look-" + UUID().uuidString
            let defaults = UserDefaults(suiteName: name)!
            defer { defaults.removePersistentDomain(forName: name) }
            defaults.set(old, forKey: "readerTextSize")
            ReaderLook.migrate(defaults)
            XCTAssertEqual(defaults.integer(forKey: StoredReaderLook.stepKey), step, old)
            XCTAssertNil(defaults.string(forKey: "readerTextSize"))
        }
    }

    func testAChosenLookReachesTheParagraph() {
        let passage = Passage(kind: .text, text: "Words to read.")
        var paragraph = PassageText(passage: passage, style: .body, highlight: { _ in }, unmark: { _ in }, resolve: { _, _ in })
        paragraph.look = ReaderLook(step: 3, face: .easy, spacing: .airy, ground: .paper)
        let text = paragraph.attributed()
        let font = text.attribute(.font, at: 0, effectiveRange: nil) as? UIFont
        XCTAssertEqual(font?.pointSize, 23)
        XCTAssertEqual(font?.familyName, "Atkinson Hyperlegible")
        XCTAssertEqual((text.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle)?.lineSpacing, 13)
        XCTAssertEqual(text.attribute(.foregroundColor, at: 0, effectiveRange: nil) as? UIColor, ReaderLook.Ground.paper.ink)
        // set twice, it must compare as the same text: otherwise every redraw would drop the reader's selection
        for ground in ReaderLook.Ground.allCases {
            paragraph.look.ground = ground
            paragraph.citations = true
            XCTAssertEqual(paragraph.attributed(), paragraph.attributed(), "\(ground)")
        }
    }
}
