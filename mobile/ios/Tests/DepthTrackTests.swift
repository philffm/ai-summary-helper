import XCTest
@testable import Kaivo

final class DepthTrackTests: XCTestCase {
    private let passages = [
        Passage(text: String(repeating: "a", count: 100)),
        Passage(kind: .image, text: "", image: "x"),
        Passage(text: String(repeating: "b", count: 500), marks: [Mark(start: 250, length: 50), Mark(start: 400, length: 100, ai: true)]),
    ]

    func testSpotsLieWhereTheWordsAre() {
        let spots = DepthTrack.spots(passages)   // 100 + 400 (picture) + 500
        XCTAssertEqual(spots.map(\.ai), [false, true])
        XCTAssertEqual(spots[0].from, 0.75, accuracy: 0.001)
        XCTAssertEqual(spots[0].to, 0.80, accuracy: 0.001)
        XCTAssertEqual(spots[1].to, 1, accuracy: 0.001)
        XCTAssertTrue(DepthTrack.spots([]).isEmpty)
    }

    func testWindowAndSeeking() throws {
        let window = try XCTUnwrap(DepthTrack.window(passages, visible: [0: (0.5, 1), 1: (0, 0.5)]))
        XCTAssertEqual(window.lowerBound, 0.05, accuracy: 0.001)
        XCTAssertEqual(window.upperBound, 0.30, accuracy: 0.001)
        XCTAssertNil(DepthTrack.window(passages, visible: [:]))
        XCTAssertEqual(DepthTrack.index(passages, at: 0), 0)
        XCTAssertEqual(DepthTrack.index(passages, at: 0.3), 1)
        XCTAssertEqual(DepthTrack.index(passages, at: 2), 2)
        XCTAssertNil(DepthTrack.index([], at: 0.5))
    }
}
