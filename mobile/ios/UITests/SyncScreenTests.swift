import XCTest

/// The library on disk and the "Sync" screen, tried by hand with the test server: `node
/// mobile/ios/scripts/sync-test-server.mjs --out=<file>`, then TEST_RUNNER_KAIVO_SYNC_UI=<file> and
/// TEST_RUNNER_KAIVO_SHOTS_TO=<folder>. It starts over with the sample library on the device it runs on.
final class SyncScreenTests: XCTestCase {
    @MainActor
    func testLibraryAndSyncScreen() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let file = environment["KAIVO_SYNC_UI"], let folder = environment["KAIVO_SHOTS_TO"] else { throw XCTSkip("only on request") }
        let info = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: file))) as? [String: Any])
        let code = try XCTUnwrap(URL(string: try XCTUnwrap(info["code"] as? String)))
        let passphrase = try XCTUnwrap(info["passphrase"] as? String)
        try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        XCUIDevice.shared.appearance = .light
        let app = XCUIApplication()
        let german = ["-AppleLanguages", "(de)", "-AppleLocale", "de_DE"]
        func start(_ more: [String]) {
            app.terminate()
            app.launchArguments = german + more
            app.launch()
            XCTAssertTrue(app.wait(for: .runningForeground, timeout: 60))
        }
        func shot(_ name: String, after seconds: Double = 1.5) {
            Thread.sleep(forTimeInterval: seconds)
            XCTAssertNoThrow(try XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(folder)/\(name).png")))
        }
        func button(_ label: String) -> XCUIElement { app.buttons[label].firstMatch }
        func press(_ label: String) {
            XCTAssertTrue(button(label).waitForExistence(timeout: 10), "\(label) is missing")
            button(label).tap()
        }
        let article = ["-KaivoStartTab", "library", "-KaivoStartArticle", "sleep-memory"]
        /// The paragraph with the AI's suggestion; its menu offers to keep it as long as it is one.
        func tapSuggestion() -> Bool {
            XCTAssertTrue(app.textViews.firstMatch.waitForExistence(timeout: 20))
            let wanted = app.textViews.allElementsBoundByIndex.first { $0.label.hasPrefix("Ein kurzer Rückblick") }
            guard let frame = wanted?.frame else { return false }
            for inset in [30.0, 90.0] where app.menuItems.count == 0 {
                app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: frame.minX + inset, dy: frame.minY + 12)).tap()
                _ = app.menuItems.firstMatch.waitForExistence(timeout: 2)
            }
            return app.menuItems["Behalten"].exists
        }

        // the samples as a real library: written as the app used to keep it, and taken over
        start(["-KaivoSeed", "YES"] + article)
        shot("1-reader", after: 3)
        XCTAssertTrue(tapSuggestion(), "the suggestion cannot be kept")
        app.menuItems["Behalten"].tap()
        shot("2-kept")
        start(article)
        shot("3-after-restart", after: 3)
        XCTAssertFalse(tapSuggestion(), "what was kept is a suggestion again")

        // a scanned code leads to the screen that asks first
        app.open(code)
        XCTAssertTrue(app.secureTextFields["passphrase"].waitForExistence(timeout: 20))
        shot("4-code")
        press("Abbrechen")
        shot("5-start")
        app.open(code)
        let field = app.secureTextFields["passphrase"]
        XCTAssertTrue(field.waitForExistence(timeout: 20))
        field.tap()
        field.typeText("zoo zoo zoo zoo zoo")
        press("Verbinden")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "passt nicht")).firstMatch.waitForExistence(timeout: 20))
        shot("6-wrong", after: 0.5)
        field.tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 40) + passphrase)
        press("Verbinden")
        shot("7-running", after: 0.6)
        XCTAssertTrue(app.staticTexts["Alles aktuell"].waitForExistence(timeout: 60))
        shot("8-connected", after: 2)
        press("Fertig")
        start(["-KaivoStartTab", "library"])
        shot("9-library", after: 5)

        // the way there from the app, and out again
        start(["-KaivoStartTab", "today"])
        XCTAssertTrue(app.buttons["sync-button"].waitForExistence(timeout: 20), "a joined library shows in the bar")
        shot("9b-today")
        press("Einstellungen")
        // by its identifier: the button in the bar behind the sheet has the same name
        let row = app.buttons["settings-sync"]
        XCTAssertTrue(row.waitForExistence(timeout: 10), "the way to the sync screen is missing")
        shot("10-settings")
        row.tap()
        XCTAssertTrue(app.staticTexts["Alles aktuell"].waitForExistence(timeout: 20))
        shot("11-connected-again", after: 3)
        let leave = button("Verbindung trennen …")
        for _ in 0..<3 where !leave.isHittable { app.swipeUp() }
        leave.tap()
        shot("12-ask")
        press("Verbindung trennen")
        XCTAssertTrue(app.staticTexts["Deine Bibliothek vom Rechner"].waitForExistence(timeout: 20))
        shot("13-left")
    }
}
