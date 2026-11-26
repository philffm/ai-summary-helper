import XCTest

/// The unfolded iPhone Duo: Today in two parts, the library beside the article, words get marked, a longer story, a
/// podcast episode, and the wake screen. Needs the demo data (`-KaivoSeed YES`).
/// Recorded by videos/scripts/ios-duo.mjs.
final class DuoTourTests: XCTestCase {
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
        app.launchArguments = ["-KaivoStartTab", "today"]
        app.launch()
        XCTAssertTrue(app.buttons["Library"].firstMatch.waitForExistence(timeout: 90))
        pause(1.5)
        mark("start")
        pause(2.6)

        mark("library")
        app.buttons["Library"].firstMatch.tap()
        let sleepStory = app.staticTexts["How sleep consolidates memory"].firstMatch
        XCTAssertTrue(sleepStory.waitForExistence(timeout: 20))
        pause(1.4)
        sleepStory.tap()
        let paragraph = app.textViews.matching(NSPredicate(format: "value CONTAINS 'During deep sleep'")).firstMatch
        XCTAssertTrue(paragraph.waitForExistence(timeout: 20), "the article opens beside the list")
        pause(1.4)
        mark("select")
        paragraph.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.25)).press(forDuration: 0.8)
        let highlight = app.menuItems["Highlight"].firstMatch.exists ? app.menuItems["Highlight"].firstMatch : app.buttons["Highlight"].firstMatch
        XCTAssertTrue(highlight.waitForExistence(timeout: 10), "the selection menu offers Highlight")
        pause(0.8)
        highlight.tap()
        pause(1.2)
        mark("keep")
        // a suggestion of the AI offers its actions where it is tapped
        let suggested = app.textViews.matching(NSPredicate(format: "value CONTAINS 'A short review'")).firstMatch
        if suggested.waitForExistence(timeout: 5) { suggested.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.2)).tap() }
        let keep = app.menuItems["Keep"].firstMatch.waitForExistence(timeout: 3) ? app.menuItems["Keep"].firstMatch : app.buttons["Keep"].firstMatch
        if keep.waitForExistence(timeout: 5) { keep.tap() }
        pause(1.6)

        // a topic narrows the list; one of the longer stories is in it
        let topic = app.buttons["Topic software"]
        XCTAssertTrue(topic.waitForExistence(timeout: 10))
        mark("topics")
        topic.tap()
        let toaster = app.staticTexts["My toaster has opinions about newsletters"].firstMatch
        XCTAssertTrue(toaster.waitForExistence(timeout: 10), "the longer story is in the list")
        pause(1.2)
        mark("story")
        toaster.tap()
        pause(2.8)

        mark("feeds")
        app.buttons["Feeds"].firstMatch.tap()
        let episode = app.staticTexts["Digital Sovereignty as a Designer"].firstMatch
        XCTAssertTrue(episode.waitForExistence(timeout: 20), "the podcast is in the feeds")
        pause(1.0)
        episode.tap()
        let play = app.buttons["Play"].firstMatch
        XCTAssertTrue(play.waitForExistence(timeout: 20), "an episode has a play button")
        pause(0.8)
        mark("play")
        play.tap()
        pause(4.0)
        if app.buttons["Pause"].firstMatch.exists { app.buttons["Pause"].firstMatch.tap() }

        app.buttons["Today"].firstMatch.tap()
        let wake = app.buttons["Wake"].firstMatch
        XCTAssertTrue(wake.waitForExistence(timeout: 20))
        pause(0.8)
        mark("wake")
        wake.tap()
        let preview = app.buttons["Preview"].firstMatch
        XCTAssertTrue(app.navigationBars["Wake"].waitForExistence(timeout: 20))
        pause(1.4)
        // The preview button is at the end of the sheet's list. If the test cannot reach it, the same screen is asked
        // for by address (debug builds), so that the take is not lost; the log then says which way it went.
        for _ in 0..<5 where !(preview.exists && preview.isHittable) {
            app.collectionViews.element(boundBy: max(0, app.collectionViews.count - 1)).swipeUp()
            pause(0.8)
        }
        let morning = app.buttons["Keep for later"].firstMatch
        if preview.exists && preview.isHittable { preview.tap() }
        if morning.waitForExistence(timeout: 12) {
            print("DUO wake screen opened from the Preview button")
        } else {
            print("DUO the Preview button did not lead to the wake screen (found: \(preview.exists))")
            let done = app.buttons["Done"].firstMatch
            if done.exists && done.isHittable { done.tap(); pause(0.8) }
            app.open(URL(string: "kaivo://wake-preview")!)
        }
        XCTAssertTrue(app.buttons["Keep for later"].firstMatch.waitForExistence(timeout: 30), "the wake screen opens from the preview")
        mark("morning")
        pause(6.0)
        mark("end")
    }
}
