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
        let topic = app.buttons["Topic science"]
        XCTAssertTrue(topic.waitForExistence(timeout: 30))
        pause(1.0)
        mark("start")
        pause(2.0)
        // a chosen topic opens the net of what it connects to
        mark("topics")
        topic.tap()
        pause(2.8)
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
        pause(1.2)
        mark("keep")
        // a suggestion of the AI offers its actions where it is tapped
        let suggested = app.textViews.matching(NSPredicate(format: "value CONTAINS 'A short review'")).firstMatch
        XCTAssertTrue(suggested.waitForExistence(timeout: 8), "the article holds a suggestion")
        suggested.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.2)).tap()
        let keep = app.menuItems["Keep"].firstMatch.waitForExistence(timeout: 3) ? app.menuItems["Keep"].firstMatch : app.buttons["Keep"].firstMatch
        XCTAssertTrue(keep.waitForExistence(timeout: 8), "the suggestion offers Keep")
        pause(0.9)
        keep.tap()
        pause(1.4)
        mark("summary")
        app.buttons["reader-menu"].firstMatch.tap()
        pause(3.4)
        closeMenu(app)
        pause(0.6)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        pause(0.6)
        mark("today")
        let today = app.tabBars.buttons["Today"].exists ? app.tabBars.buttons["Today"] : app.buttons["Today"].firstMatch
        today.tap()
        pause(2.2)
        app.swipeUp()
        pause(2.0)
        mark("end")
        // leaving the app is the one change of the whole screen at the end: the script finds it in the recording and
        // lines the other times up with it (the recording's own clock starts with its first changed picture)
        pause(0.8)
        mark("home")
        XCUIDevice.shared.press(.home)
        pause(2.0)
    }
}

extension XCTestCase {
    /// The menu is a sheet: pulled down on a phone, left with a tap elsewhere where it stands beside its button.
    @MainActor
    func closeMenu(_ app: XCUIApplication) {
        let pages = app.descendants(matching: .any)["menu-pages"].firstMatch
        let grab = pages.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: -0.4))
        grab.press(forDuration: 0.05, thenDragTo: grab.withOffset(CGVector(dx: 0, dy: 520)), withVelocity: .fast, thenHoldForDuration: 0)
        if !pages.waitForNonExistence(timeout: 2) { app.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.2)).tap() }
        XCTAssertTrue(pages.waitForNonExistence(timeout: 5), "the menu stays open")
    }
}
