import XCTest

/// The App Store preview for the unfolded iPhone Duo: real touches on the app with its sample data, list and article side
/// by side. Recorded by videos/scripts/ios-preview.mjs --duo. Run with the scheme KaivoTour only; KAIVO_MARKS as in
/// `TourTests`.
final class DuoPreviewTests: XCTestCase {
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
        // only when the recording script asks for it: the other tours' devices cannot show these two columns
        try XCTSkipIf(ProcessInfo.processInfo.environment["KAIVO_MARKS"] == nil, "only for the recording")
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-KaivoScreenshots", "YES", "-KaivoTouches", "YES", "-KaivoStartTab", "today", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let library = app.buttons["Library"].firstMatch
        XCTAssertTrue(library.waitForExistence(timeout: 90))
        pause(1.0)
        mark("start")
        pause(2.4)
        mark("library")
        library.tap()
        let sleepStory = app.staticTexts["How sleep consolidates memory"].firstMatch
        XCTAssertTrue(sleepStory.waitForExistence(timeout: 20))
        pause(0.8)
        sleepStory.tap()
        let paragraph = app.textViews.matching(NSPredicate(format: "value CONTAINS 'During deep sleep'")).firstMatch
        XCTAssertTrue(paragraph.waitForExistence(timeout: 20), "the article opens beside the list")
        pause(1.4)
        mark("select")
        paragraph.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.25)).press(forDuration: 0.8)
        let highlight = app.menuItems["Highlight"].firstMatch.exists ? app.menuItems["Highlight"].firstMatch : app.buttons["Highlight"].firstMatch
        XCTAssertTrue(highlight.waitForExistence(timeout: 10), "the selection menu offers Highlight")
        pause(0.9)
        highlight.tap()
        pause(1.2)
        mark("keep")
        let suggested = app.textViews.matching(NSPredicate(format: "value CONTAINS 'A short review'")).firstMatch
        XCTAssertTrue(suggested.waitForExistence(timeout: 8), "the article holds a suggestion")
        suggested.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.25)).tap()
        let keep = app.menuItems["Keep"].firstMatch.waitForExistence(timeout: 3) ? app.menuItems["Keep"].firstMatch : app.buttons["Keep"].firstMatch
        XCTAssertTrue(keep.waitForExistence(timeout: 8), "the suggestion offers Keep")
        pause(0.9)
        keep.tap()
        pause(1.4)
        // a chosen topic opens the net of what it connects to, beside the article
        let topic = app.buttons["Topic science"]
        XCTAssertTrue(topic.waitForExistence(timeout: 10))
        mark("topics")
        topic.tap()
        pause(2.8)
        mark("research")
        let woodpecker = app.staticTexts["Why woodpeckers do not get headaches"].firstMatch
        XCTAssertTrue(woodpecker.waitForExistence(timeout: 10), "the study is in the list")
        woodpecker.tap()
        let summary = app.buttons["summary-jump"].firstMatch
        XCTAssertTrue(summary.waitForExistence(timeout: 10))
        pause(1.8)
        mark("summary")
        summary.tap()
        pause(3.6)
        mark("today")
        app.buttons["Today"].firstMatch.tap()
        pause(2.6)
        mark("end")
        pause(0.8)
        mark("home")
        XCUIDevice.shared.press(.home)
        pause(2.0)
    }
}
