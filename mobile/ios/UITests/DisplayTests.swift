import XCTest

/// The reader's "Appearance" sheet, tried by hand: every choice made through it, with a picture of each state.
/// Skipped unless TEST_RUNNER_KAIVO_DISPLAY names a folder; TEST_RUNNER_KAIVO_LANG chooses the language.
final class DisplayTests: XCTestCase {
    @MainActor
    func testAppearance() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let folder = environment["KAIVO_DISPLAY"] else { throw XCTSkip("only on request") }
        let language = environment["KAIVO_LANG"] ?? "en"
        try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        let app = XCUIApplication()
        func start(_ article: String, dark: Bool = false) {
            XCUIDevice.shared.appearance = dark ? .dark : .light
            app.terminate()
            app.launchArguments = ["-KaivoScreenshots", "YES", "-AppleLanguages", "(\(language))",
                                   "-KaivoStartTab", "library", "-KaivoStartArticle", article]
            app.launch()
            XCTAssertTrue(app.textViews.firstMatch.waitForExistence(timeout: 30))
        }
        func shot(_ name: String) {
            Thread.sleep(forTimeInterval: 1.5)
            XCTAssertNoThrow(try XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(folder)/\(name).png")))
        }
        func openSheet() -> XCUIElement {
            // the button's label is translated; it is the one with this symbol's place in the bar
            let ruler = app.descendants(matching: .any)["textSizeRuler"].firstMatch
            let names = ["Appearance", "Darstellung", "المظهر"]
            for name in names where !ruler.exists && app.buttons[name].firstMatch.exists { app.buttons[name].firstMatch.tap() }
            XCTAssertTrue(ruler.waitForExistence(timeout: 10), "the sheet did not open")
            return ruler
        }
        func tap(_ id: String) {
            let button = app.buttons[id].firstMatch
            XCTAssertTrue(button.waitForExistence(timeout: 5), "\(id) is missing")
            // the last typeface waits beyond the edge of its row
            if !button.isHittable {
                let row = app.buttons["face-easy"].firstMatch
                if language == "ar" { row.swipeRight() } else { row.swipeLeft() }
            }
            button.tap()
        }
        func reset() {
            let names = ["Reset", "Zurücksetzen", "إعادة ضبط"]
            for name in names where app.buttons[name].firstMatch.exists && app.buttons[name].firstMatch.isEnabled {
                app.buttons[name].firstMatch.tap()
            }
        }

        start("sleep-memory")
        var ruler = openSheet()
        reset()
        shot("1-sheet")
        XCTAssertEqual(ruler.value as? String, "0")
        let middle = ruler.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: 0.7))
        middle.press(forDuration: 0.05, thenDragTo: middle.withOffset(CGVector(dx: -122, dy: 0)), withVelocity: .slow, thenHoldForDuration: 0.2)
        XCTAssertEqual(ruler.value as? String, "+3")
        tap("face-easy")
        shot("2-larger-easy")
        tap("ground-paper")
        shot("3-paper")
        tap("face-hanken")
        tap("ground-dark")
        shot("4-dark-page-in-light")
        app.buttons[language == "de" ? "Schließen" : language == "ar" ? "إغلاق" : "Close"].firstMatch.tap()
        shot("5-dark-page-closed")
        // and back again: nothing stays dark that was not chosen so
        ruler = openSheet()
        tap("ground-auto")
        shot("5b-auto-after-dark")
        tap("ground-dark")
        let today = app.buttons[language == "de" ? "Heute" : language == "ar" ? "اليوم" : "Today"].firstMatch
        app.buttons[language == "de" ? "Schließen" : language == "ar" ? "إغلاق" : "Close"].firstMatch.tap()
        if UIDevice.current.userInterfaceIdiom == .pad && today.exists {
            today.tap()
            shot("5c-another-tab")
        }

        // the choice holds for the next start; a paper page stays paper in dark appearance
        start("story-woodpecker", dark: true)
        shot("6-kept-after-restart")
        ruler = openSheet()
        XCTAssertEqual(ruler.value as? String, "+3")
        tap("ground-paper")
        shot("7-paper-in-dark")
        tap("ground-auto")
        shot("8-auto-in-dark")
        reset()
        XCTAssertEqual(ruler.value as? String, "0")
        XCUIDevice.shared.appearance = .light
        // and the article as it opens with nothing chosen
        start("sleep-memory")
        shot("9-default")
        start("story-woodpecker")
        shot("10-default-study")

        // an item of a feed has the same sheet and follows the same choice
        app.terminate()
        app.launchArguments = ["-KaivoScreenshots", "YES", "-AppleLanguages", "(\(language))", "-KaivoStartTab", "feeds"]
        app.launch()
        Thread.sleep(forTimeInterval: 5)
        let items = app.cells.allElementsBoundByIndex.filter { $0.frame.height >= 60 }
        let item = try XCTUnwrap(items.min { $0.frame.minY < $1.frame.minY })
        item.tap()
        shot("11-feed-item")
        ruler = openSheet()
        tap("ground-paper")
        tap("face-easy")
        shot("12-feed-item-paper")
        reset()
    }
}
