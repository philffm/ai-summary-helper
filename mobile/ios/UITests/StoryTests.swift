import XCTest

/// The demo with the home screen: a widget opens the article, words get marked, and back home the highlight widget shows
/// what was kept. Needs a device with the three Kaivo widgets placed and the demo data (`-KaivoSeed YES`).
/// Recorded by videos/scripts/ios-preview.mjs --story.
final class StoryTests: XCTestCase {
    private var marks: [String] = []

    private func mark(_ name: String, _ point: CGPoint? = nil) {
        let at = point.map { " \(Int($0.x)) \(Int($0.y))" } ?? ""
        marks.append("\(name) \(Date().timeIntervalSince1970)\(at)")
        if let path = ProcessInfo.processInfo.environment["KAIVO_MARKS"] {
            try? marks.joined(separator: "\n").write(toFile: path, atomically: true, encoding: .utf8)
        }
    }

    private func pause(_ seconds: Double) { Thread.sleep(forTimeInterval: seconds) }

    @MainActor
    func testStory() throws {
        continueAfterFailure = false
        let home = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let app = XCUIApplication()
        app.terminate()
        XCUIDevice.shared.press(.home)
        pause(1)
        // the widget that continues reading, wherever it was put
        let widget = home.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'How sleep consolidates' OR label CONTAINS 'Continue reading'")).firstMatch
        if !(widget.waitForExistence(timeout: 5) && widget.isHittable) { XCUIDevice.shared.press(.home); pause(1) }
        XCTAssertTrue(widget.waitForExistence(timeout: 10), "put the Continue reading widget on the first home screen page")
        mark("start")
        pause(2.6)
        let point = CGPoint(x: widget.frame.midX, y: widget.frame.midY)
        mark("tap", point)
        widget.tap()
        let paragraph = app.textViews.matching(NSPredicate(format: "value CONTAINS 'During deep sleep'")).firstMatch
        XCTAssertTrue(paragraph.waitForExistence(timeout: 30), "the widget opens the article")
        mark("app")
        pause(1.6)
        mark("select")
        paragraph.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.25)).press(forDuration: 0.8)
        let highlight = app.menuItems["Highlight"].firstMatch.exists ? app.menuItems["Highlight"].firstMatch : app.buttons["Highlight"].firstMatch
        XCTAssertTrue(highlight.waitForExistence(timeout: 8), "the selection menu offers Highlight")
        pause(0.9)
        highlight.tap()
        pause(1.4)
        mark("keep")
        // a suggestion of the AI offers its actions where it is tapped
        let suggested = app.textViews.matching(NSPredicate(format: "value CONTAINS 'A short review'")).firstMatch
        if suggested.waitForExistence(timeout: 5) { suggested.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.2)).tap() }
        let keep = app.menuItems["Keep"].firstMatch.waitForExistence(timeout: 3) ? app.menuItems["Keep"].firstMatch : app.buttons["Keep"].firstMatch
        XCTAssertTrue(keep.waitForExistence(timeout: 8), "the suggestion offers Keep")
        pause(0.8)
        keep.tap()
        pause(1.8)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let climate = app.buttons["Topic software"]
        XCTAssertTrue(climate.waitForExistence(timeout: 10))
        pause(0.8)
        mark("topics")
        climate.tap()
        pause(1.6)
        climate.tap()
        pause(1.0)
        mark("leave")
        pause(0.4)
        mark("home")
        XCUIDevice.shared.press(.home)
        pause(4.5)
        mark("end")
    }
}
