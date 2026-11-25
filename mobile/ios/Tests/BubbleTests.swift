import XCTest
@testable import Kaivo

final class BubbleTests: XCTestCase {
    func testCirclesNeverOverlap() {
        for radii: [CGFloat] in [[1], [1, 1], [1, 0.8, 0.7, 0.6, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]] {
            let centers = CirclePacking.centers(radii: radii, gap: 0.05)
            XCTAssertEqual(centers.count, radii.count)
            for a in radii.indices {
                for b in radii.indices where b > a {
                    XCTAssertGreaterThanOrEqual(hypot(centers[a].x - centers[b].x, centers[a].y - centers[b].y), radii[a] + radii[b] + 0.049)
                }
            }
            let box = CirclePacking.bounds(centers: centers, radii: radii)
            if radii.count > 2 { XCTAssertGreaterThan(box.width, box.height, "the cluster is wider than tall") }
        }
    }
}
