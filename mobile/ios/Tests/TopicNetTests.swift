import XCTest
@testable import Kaivo

final class TopicNetTests: XCTestCase {
    private func article(_ tags: [String]) -> Article {
        Article(id: UUID().uuidString, title: "t", host: "h", tags: tags, words: 1, savedAt: .now)
    }

    func testRelatedTopicsAreSharedByEveryChosenOne() {
        let articles = [article(["ai", "privacy"]), article(["ai", "privacy", "law"]), article(["ai", "climate", "climate"]),
                        article(["privacy", "law"]), article(["health"])]
        let one = Library.related(articles, to: ["ai"])
        XCTAssertEqual(one.map(\.name), ["privacy", "climate", "law"], "most shared first, ties by name")
        XCTAssertEqual(one.map(\.count), [2, 1, 1], "counted in articles, and the chosen topic is left out")
        let two = Library.related(articles, to: ["ai", "privacy"])
        XCTAssertEqual(two.map(\.name), ["law"])
        XCTAssertEqual(two.first?.count, 1)
        XCTAssertTrue(Library.related(articles, to: ["health"]).isEmpty)
        XCTAssertTrue(Library.related([], to: ["ai"]).isEmpty)
    }

    func testEitherOrderIsTheSame() {
        let articles = [article(["ai", "privacy"]), article(["privacy", "law", "ai"]), article(["ai"]), article(["privacy"])]
        func listed(_ chosen: [String]) -> [String] { articles.filter { a in chosen.allSatisfy(a.tags.contains) }.map(\.id) }
        XCTAssertEqual(listed(["ai", "privacy"]), listed(["privacy", "ai"]))
        XCTAssertEqual(Library.related(articles, to: ["ai", "privacy"]), Library.related(articles, to: ["privacy", "ai"]))
        XCTAssertEqual(NetLayout.together(["privacy", "Ai"]), ["Ai", "privacy"])
        XCTAssertEqual(NetLayout.together(["privacy", "ai"]), NetLayout.together(["ai", "privacy"]))
    }

    func testCirclesOfTheNetNeverOverlap() {
        for width: CGFloat in [288, 343, 440, 700] {
            for count in 0...NetLayout.most {
                let (centre, places) = NetLayout.positions(count, width: width)
                XCTAssertEqual(places.count, count)
                let r = NetLayout.satellite.upperBound
                XCTAssertTrue(centre.y >= NetLayout.centre && centre.y + NetLayout.centre <= NetLayout.height, "middle inside: \(count) at \(width)")
                for (i, p) in places.enumerated() {
                    XCTAssertGreaterThanOrEqual(hypot(p.x - centre.x, p.y - centre.y), NetLayout.centre + r, "\(count) at \(width)")
                    XCTAssertTrue(p.x - r >= 0 && p.x + r <= width && p.y - r >= 0 && p.y + r <= NetLayout.height, "inside: \(count) at \(width)")
                    for q in places.dropFirst(i + 1) { XCTAssertGreaterThanOrEqual(hypot(p.x - q.x, p.y - q.y), 2 * r, "\(count) at \(width)") }
                }
            }
        }
        XCTAssertGreaterThanOrEqual(NetLayout.satellite.lowerBound * 2, 44, "big enough for a finger")
    }

    func testSecondRingHoldsOnlyWhatIsReachedThroughTheFirst() {
        let articles = [article(["ai", "privacy"]), article(["privacy", "law"]), article(["privacy", "law"]), article(["climate", "ai"]),
                        article(["climate", "energy"]), article(["climate", "law"]), article(["health"])]
        let ring = Library.related(articles, to: ["ai"])
        XCTAssertEqual(ring.map(\.name), ["climate", "privacy"])
        let far = Library.beyond(articles, from: ["ai"], through: ring, most: 4)
        XCTAssertEqual(far.map(\.topic.name), ["law", "energy"], "neither the chosen topic, nor the ring, nor what nothing leads to")
        XCTAssertEqual(far.first?.via, "privacy", "by the way that leads there most often")
        XCTAssertEqual(far.first?.topic.count, 2)
        XCTAssertEqual(Library.beyond(articles, from: ["ai"], through: ring, most: 1).count, 1)
        XCTAssertTrue(Library.beyond(articles, from: ["health"], through: [], most: 4).isEmpty)
    }

    func testSecondRingKeepsClearOfTheFirst() {
        for width: CGFloat in [288, 343, 440, 700] {
            for count in 1...NetLayout.most {
                let (centre, places) = NetLayout.positions(count, width: width)
                let bridges = (0..<NetLayout.outerMost).map { $0 % count }
                let corners = NetLayout.corners(through: bridges, middle: centre, around: places, width: width).compactMap { $0 }
                XCTAssertGreaterThanOrEqual(corners.count, 2, "room for some: \(count) at \(width)")
                let r = NetLayout.outer
                for (i, p) in corners.enumerated() {
                    XCTAssertTrue(p.x - r >= 0 && p.x + r <= width && p.y - r >= 0 && p.y + r <= NetLayout.height, "inside: \(count) at \(width)")
                    XCTAssertGreaterThanOrEqual(hypot(p.x - centre.x, p.y - centre.y), NetLayout.centre + r)
                    for q in places { XCTAssertGreaterThanOrEqual(hypot(p.x - q.x, p.y - q.y), NetLayout.satellite.upperBound + r, "\(count) at \(width)") }
                    for q in corners.dropFirst(i + 1) { XCTAssertGreaterThanOrEqual(hypot(p.x - q.x, p.y - q.y), 2 * r, "\(count) at \(width)") }
                }
            }
        }
        XCTAssertGreaterThanOrEqual(NetLayout.outer * 2, 44, "big enough for a finger")
    }

    @MainActor
    func testReadingKeepsTheFurthestAndSavesOnce() async throws {
        let position = ReadingPosition()
        var saved: [Double] = []
        for progress in [0.2, 0.6, 0.4] { position.reach(progress, after: .milliseconds(80)) { saved.append($0) } }
        XCTAssertTrue(saved.isEmpty, "nothing while scrolling")
        try await Task.sleep(for: .milliseconds(400))
        XCTAssertEqual(saved, [0.6])
        position.reach(0.9, after: .seconds(60)) { saved.append($0) }
        position.settle { saved.append($0) }
        XCTAssertEqual(saved, [0.6, 0.9])
    }
}
