import XCTest

/// The App Store preview: real touches on the real app with its sample data, recorded by videos/scripts/ios-preview.mjs.
/// Run with the scheme KaivoTour only. When the environment variable KAIVO_MARKS names a file, the time of every step is
/// written there, so that the captions can follow.
final class TourTests: XCTestCase {
    private var marks: [String] = []

    private func mark(_ name: String) {
        marks.append("\(name) \(Date().timeIntervalSince1970)")
        if let path = ProcessInfo.processInfo.environment["KAIVO_MARKS"] {
            try? marks.joined(separator: "\n").write(toFile: path, atomically: true, encoding: .utf8)
        }
    }

    private func pause(_ seconds: Double) { Thread.sleep(forTimeInterval: seconds) }

    @MainActor
    func testTour() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-KaivoScreenshots", "YES", "-KaivoTouches", "YES", "-KaivoStartTab", "library", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let climate = app.buttons["Topic climate"]
        XCTAssertTrue(climate.waitForExistence(timeout: 30))
        mark("start")
        pause(2.2)
        mark("topics")
        climate.tap()
        pause(1.4)
        climate.tap()
        pause(0.8)
        app.staticTexts["How sleep consolidates memory"].firstMatch.tap()
        let paragraph = app.textViews.matching(NSPredicate(format: "value CONTAINS 'During deep sleep'")).firstMatch
        XCTAssertTrue(paragraph.waitForExistence(timeout: 10))
        pause(0.8)
        mark("select")
        paragraph.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.25)).press(forDuration: 0.8)
        let highlight = app.menuItems["Highlight"].firstMatch.exists ? app.menuItems["Highlight"].firstMatch : app.buttons["Highlight"].firstMatch
        XCTAssertTrue(highlight.waitForExistence(timeout: 8), "the selection menu offers Highlight")
        pause(0.9)
        highlight.tap()
        pause(1.4)
        mark("keep")
        app.buttons["Keep"].firstMatch.tap()
        pause(1.6)
        mark("summary")
        app.buttons["Summary"].firstMatch.tap()
        pause(2.6)
        app.buttons["Done"].firstMatch.tap()
        pause(0.6)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        pause(0.6)
        mark("today")
        app.tabBars.buttons["Today"].tap()
        pause(2.0)
        app.swipeUp()
        pause(2.2)
        mark("end")
        // leaving the app is the one change of the whole screen at the end: the script finds it in the recording and
        // lines the other times up with it (the recording's own clock starts with its first changed picture)
        pause(0.8)
        mark("home")
        XCUIDevice.shared.press(.home)
        pause(2.0)
    }
}
