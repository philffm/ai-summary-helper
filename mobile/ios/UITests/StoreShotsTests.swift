import XCTest

/// The screens for the App Store pictures (videos/scripts/ios-store-v2.mjs): the real app with its sample reading, walked
/// to the states worth showing. Skipped unless TEST_RUNNER_KAIVO_SHOTS names a folder; TEST_RUNNER_KAIVO_LANG and
/// TEST_RUNNER_KAIVO_REGION choose the language.
final class StoreShotsTests: XCTestCase {
    @MainActor
    func testShots() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let folder = environment["KAIVO_SHOTS"] else { throw XCTSkip("only for the store pictures") }
        let language = environment["KAIVO_LANG"] ?? "en"
        let region = environment["KAIVO_REGION"] ?? "en_US"
        // on the iPad the list and the article stand side by side: something is always open next to the list
        let pad = UIDevice.current.userInterfaceIdiom == .pad
        let beside = pad ? ["-KaivoStartArticle", "sleep-memory"] : []
        try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        let app = XCUIApplication()
        func start(_ more: [String], dark: Bool = false) {
            XCUIDevice.shared.appearance = dark ? .dark : .light
            app.terminate()
            app.launchArguments = ["-KaivoScreenshots", "YES", "-AppleLanguages", "(\(language))", "-AppleLocale", region] + more
            app.launch()
            XCTAssertTrue(app.wait(for: .runningForeground, timeout: 60))
        }
        func shot(_ name: String, after seconds: Double = 2.5) {
            Thread.sleep(forTimeInterval: seconds)
            let png = XCUIScreen.main.screenshot().pngRepresentation
            XCTAssertNoThrow(try png.write(to: URL(fileURLWithPath: "\(folder)/\(name).png")))
            // where everything is, so that the pictures can lift the same parts out in every language
            var elements: [[String: Any]] = []
            func walk(_ node: XCUIElementSnapshot) {
                let f = node.frame
                if f.width > 1 && f.height > 1 {
                    elements.append(["type": node.elementType.rawValue, "label": node.label, "x": f.minX, "y": f.minY, "w": f.width, "h": f.height])
                }
                node.children.forEach(walk)
            }
            if let tree = try? app.snapshot() {
                walk(tree)
                let json: [String: Any] = ["width": tree.frame.width, "height": tree.frame.height, "elements": elements]
                XCTAssertNoThrow(try JSONSerialization.data(withJSONObject: json).write(to: URL(fileURLWithPath: "\(folder)/\(name).json")))
            }
        }

        // the topics, then one of them chosen: what it connects to
        start(["-KaivoStartTab", "library"] + beside)
        shot("topics", after: 4)
        // the bubble named for the sample tag; with none (labels read right to left, say) the largest round button
        Thread.sleep(forTimeInterval: 1)
        let tag = environment["KAIVO_TOPIC"] ?? "science"
        let round = app.buttons.allElementsBoundByIndex.filter {
            let f = $0.frame
            return abs(f.width - f.height) < 3 && f.width >= 40 && f.minY > 100 && f.maxY < app.frame.height * 0.55
        }
        if let topic = round.first(where: { $0.label.contains(tag) }) ?? round.max(by: { $0.frame.width < $1.frame.width }) {
            topic.tap()
            shot("net", after: 3.5)
        }

        // an article with the reader's mark and a suggestion of the AI, then the suggestion's actions
        start(["-KaivoStartTab", "library", "-KaivoStartArticle", "sleep-memory"])
        shot("reader", after: 4)
        XCTAssertTrue(app.textViews.firstMatch.waitForExistence(timeout: 10))
        // the third paragraph carries the suggestion; each may be reported twice, and a tap beside the words means nothing
        var paragraphs: [CGRect] = []
        for frame in app.textViews.allElementsBoundByIndex.filter({ !$0.label.isEmpty }).map(\.frame).sorted(by: { $0.minY < $1.minY })
        where paragraphs.last.map({ frame.minY - $0.minY > 8 }) ?? true {
            paragraphs.append(frame)
        }
        XCTAssertGreaterThanOrEqual(paragraphs.count, 3)
        if paragraphs.count >= 3 {
            let suggested = paragraphs[2]
            for inset in [30.0, 60.0, 110.0] where app.menuItems.count == 0 {
                let x = language == "ar" ? suggested.maxX - inset : suggested.minX + inset
                app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: suggested.minY + 12)).tap()
                _ = app.menuItems.firstMatch.waitForExistence(timeout: 2)
            }
            XCTAssertGreaterThan(app.menuItems.count, 0, "the actions of the suggestion did not appear")
            shot("keep", after: 1.5)
        }

        start(["-KaivoStartTab", "library", "-KaivoStartArticle", "sleep-memory", "-KaivoShowSummary", "YES"])
        shot("summary", after: 6)

        start(["-KaivoStartTab", "library", "-KaivoStartArticle", "story-woodpecker", "-KaivoShowSummary", "YES"])
        shot("summary-study", after: 6)
        start(["-KaivoStartTab", "today"])
        shot("today", after: 4)
        start(["-KaivoStartTab", "feeds"])
        if pad {
            Thread.sleep(forTimeInterval: 5)
            app.cells.allElementsBoundByIndex.filter { $0.frame.height >= 60 }.min { $0.frame.minY < $1.frame.minY }?.tap()
        }
        shot("feeds", after: 6)
        start(["-KaivoStartTab", "library", "-KaivoStartArticle", "story-woodpecker"])
        shot("research", after: 4)
        XCUIDevice.shared.appearance = .light
    }
}
